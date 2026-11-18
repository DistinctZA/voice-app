use crate::settings::ClipboardHandling;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString, NSPasteboardWriting};
use objc2_foundation::{NSArray, NSString};

type Items = NSArray<ProtocolObject<dyn NSPasteboardWriting>>;

fn snapshot(board: &NSPasteboard) -> Result<Retained<Items>, String> {
    let items = board
        .pasteboardItems()
        .ok_or("Could not read the clipboard")?;
    let mut copies = Vec::with_capacity(items.len());
    for item in items {
        // Materialize every representation before replacing the pasteboard.
        // Retaining an original NSPasteboardItem does not preserve its data.
        let copy = NSPasteboardItem::new();
        for ty in item.types() {
            let data = item
                .dataForType(&ty)
                .ok_or_else(|| format!("Could not read clipboard format {ty}"))?;
            if !copy.setData_forType(&data, &ty) {
                return Err(format!("Could not preserve clipboard format {ty}"));
            }
        }
        copies.push(ProtocolObject::from_retained(copy));
    }
    Ok(NSArray::from_retained_slice(&copies))
}

pub(super) fn with_transcript(
    board: &NSPasteboard,
    text: &str,
    handling: ClipboardHandling,
    paste: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let previous_owner = board.changeCount();
    let original = if handling == ClipboardHandling::DontModify {
        Some(snapshot(board)?)
    } else {
        None
    };
    if board.changeCount() != previous_owner {
        return Err("Clipboard changed while preparing to paste".into());
    }

    let owner = board.clearContents();
    // SAFETY: AppKit's exported immutable pasteboard type is valid on macOS.
    let written =
        board.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString });
    let result = if written {
        paste()
    } else {
        Err("Could not write the transcript to the clipboard".into())
    };
    if let Some(items) = original {
        // A copy made by the user while the target was pasting takes priority.
        if board.changeCount() == owner {
            board.clearContents();
            if !items.is_empty() && !board.writeObjects(&items) {
                return Err("Could not restore the clipboard after pasting".into());
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2_foundation::NSData;

    #[test]
    fn restores_all_items_and_formats_even_if_paste_fails() {
        let board = NSPasteboard::pasteboardWithUniqueName();
        let first = NSPasteboardItem::new();
        let second = NSPasteboardItem::new();
        let png = NSString::from_str("public.png");
        let url = NSString::from_str("public.file-url");
        let text = unsafe { NSPasteboardTypeString };
        let image = NSData::with_bytes(b"test image data");
        first.setData_forType(&image, &png);
        first.setString_forType(&NSString::from_str("image description"), text);
        second.setString_forType(&NSString::from_str("file:///example"), &url);
        let items = NSArray::from_retained_slice(&[
            ProtocolObject::from_retained(first),
            ProtocolObject::from_retained(second),
        ]);
        assert!(board.writeObjects(&items));
        let result = with_transcript(&board, "dictation", ClipboardHandling::DontModify, || {
            assert_eq!(board.stringForType(text).unwrap().to_string(), "dictation");
            Err("Shortcut failed".into())
        });
        assert_eq!(result.unwrap_err(), "Shortcut failed");
        let restored = board.pasteboardItems().unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored.objectAtIndex(0).dataForType(&png).unwrap(), image);
        assert_eq!(
            restored
                .objectAtIndex(0)
                .stringForType(text)
                .unwrap()
                .to_string(),
            "image description"
        );
        assert_eq!(
            restored
                .objectAtIndex(1)
                .stringForType(&url)
                .unwrap()
                .to_string(),
            "file:///example"
        );
    }

    #[test]
    fn restores_an_empty_clipboard_and_keeps_the_transcript_in_copy_mode() {
        let board = NSPasteboard::pasteboardWithUniqueName();
        let text = unsafe { NSPasteboardTypeString };
        board.clearContents();
        with_transcript(
            &board,
            "dictation",
            ClipboardHandling::DontModify,
            || Ok(()),
        )
        .unwrap();
        assert!(board.pasteboardItems().unwrap().is_empty());

        with_transcript(
            &board,
            "dictation",
            ClipboardHandling::CopyToClipboard,
            || Ok(()),
        )
        .unwrap();
        assert_eq!(board.stringForType(text).unwrap().to_string(), "dictation");
    }

    #[test]
    fn leaves_a_newer_copy_intact() {
        let board = NSPasteboard::pasteboardWithUniqueName();
        let text = unsafe { NSPasteboardTypeString };
        board.setString_forType(&NSString::from_str("original"), text);
        with_transcript(&board, "transcript", ClipboardHandling::DontModify, || {
            board.clearContents();
            board.setString_forType(&NSString::from_str("new copy"), text);
            Ok(())
        })
        .unwrap();
        assert_eq!(board.stringForType(text).unwrap().to_string(), "new copy");
    }
}
