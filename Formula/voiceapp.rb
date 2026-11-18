class Voiceapp < Formula
  desc "Menu bar dictation with on-device speech recognition"
  homepage "https://voice-app.xyz/"
  url "https://github.com/DistinctZA/voice-app.git",
      tag:      "v1.4.2",
      revision: "03633240fb823719096e98e0fb43f31f7bf50f2f"
  license "MIT"

  depends_on "bun" => :build
  depends_on "cmake" => :build
  depends_on "rust" => :build
  depends_on arch: :arm64
  depends_on :macos

  # Bun and Cargo fetch the dependencies pinned in the source lockfiles.
  allow_network_access! :build

  def install
    ENV["CARGO_TARGET_DIR"] = buildpath/"target"
    system "bun", "run", "build:mac"
    libexec.install "target/local/release/bundle/macos/VoiceApp.app"
    bin.install_symlink libexec/"VoiceApp.app/Contents/MacOS/voiceapp"
  end

  def caveats
    <<~EOS
      Open the app with:
        open "#{opt_libexec}/VoiceApp.app"
      Upgrade it with:
        brew upgrade distinctza/voice-app/voiceapp
    EOS
  end

  test do
    assert_match "VoiceApp - Speech to Text", shell_output("#{bin}/voiceapp --help")
    system "/usr/bin/codesign", "--verify", "--deep", "--strict", libexec/"VoiceApp.app"
  end
end
