import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkVersions,
  readVersions,
  updateVersion,
} from "../scripts/version.mjs";

const fixtures: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "voiceapp-version-test-"));
  fixtures.push(root);
  for (const file of [
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "README.md",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(
      new URL(`../${file}`, import.meta.url),
      path.join(root, file),
    );
  }
  return root;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true });
});

test("the checked-out release versions agree", () => {
  expect(checkVersions()).toMatch(/^\d+\.\d+\.\d+$/);
});

test("detects Cargo.lock drift", () => {
  const root = fixture();
  const lock = path.join(root, "src-tauri/Cargo.lock");
  fs.writeFileSync(
    lock,
    fs
      .readFileSync(lock, "utf8")
      .replace(/(name = "voiceapp"\nversion = ")[^"]+/, "$19.9.9"),
  );
  expect(() => checkVersions(root)).toThrow("src-tauri/Cargo.lock: 9.9.9");
});

test("bumping synchronizes all files without altering dependency versions", () => {
  const root = fixture();
  const lock = path.join(root, "src-tauri/Cargo.lock");
  const originalLock = fs.readFileSync(lock, "utf8");
  const previous = checkVersions(root);
  updateVersion("9.8.7", root);
  expect(Object.values(readVersions(root))).toEqual(Array(5).fill("9.8.7"));
  expect(fs.readFileSync(lock, "utf8")).toBe(
    originalLock.replace(
      `name = "voiceapp"\nversion = "${previous}"`,
      'name = "voiceapp"\nversion = "9.8.7"',
    ),
  );
});

test("invalid versions do not change files", () => {
  const root = fixture();
  const before = readVersions(root);
  expect(() => updateVersion("bad-version", root)).toThrow("semver");
  expect(readVersions(root)).toEqual(before);
});

test("reapplying the current version repairs README drift", () => {
  const root = fixture();
  const version = checkVersions(root);
  const readme = path.join(root, "README.md");
  fs.writeFileSync(
    readme,
    fs
      .readFileSync(readme, "utf8")
      .replace(`| **Version** | ${version} |`, "| **Version** | 0.0.1 |"),
  );
  expect(() => checkVersions(root)).toThrow("README.md: 0.0.1");
  expect(updateVersion(version, root)).toBe(version);
});
