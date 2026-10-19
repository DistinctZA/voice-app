import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cargoVersion = /(^\[package\][\s\S]*?^version = ")([^"]+)(")/m;
const lockVersion =
  /(^\[\[package\]\]\nname = "voiceapp"\nversion = ")([^"]+)(")/m;
const readmeVersion = /(^\| \*\*Version\*\* \| )([^ |]+)( \|)/m;
const readmeDevVersion = /(VoiceApp v)(\d+\.\d+\.\d+)( \(Dev\))/;

function matchedVersion(contents, pattern, file) {
  const match = contents.match(pattern);
  if (!match) throw new Error(`Cannot find VoiceApp version in ${file}`);
  return match[2];
}

export function readVersions(root = repoRoot) {
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  return {
    "package.json": JSON.parse(read("package.json")).version,
    "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json"))
      .version,
    "src-tauri/Cargo.toml": matchedVersion(
      read("src-tauri/Cargo.toml"),
      cargoVersion,
      "Cargo.toml",
    ),
    "src-tauri/Cargo.lock": matchedVersion(
      read("src-tauri/Cargo.lock"),
      lockVersion,
      "Cargo.lock",
    ),
    "README.md": matchedVersion(read("README.md"), readmeVersion, "README.md"),
    "README.md (dev build)": matchedVersion(
      read("README.md"),
      readmeDevVersion,
      "README.md",
    ),
  };
}

export function checkVersions(root = repoRoot) {
  const versions = readVersions(root);
  const expected = versions["package.json"];
  if (!/^\d+\.\d+\.\d+$/.test(expected))
    throw new Error(`Invalid release version: ${expected}`);
  const mismatches = Object.entries(versions).filter(
    ([, version]) => version !== expected,
  );
  if (mismatches.length) {
    throw new Error(
      `Version mismatch (expected ${expected}):\n${mismatches.map(([file, version]) => `${file}: ${version}`).join("\n")}`,
    );
  }
  return expected;
}

export function updateVersion(version, root = repoRoot) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Version must be semver like 1.4.1");
  // Validate every source before writing, including when repairing the current version.
  readVersions(root);
  for (const file of ["package.json", "src-tauri/tauri.conf.json"]) {
    const filename = path.join(root, file);
    const data = JSON.parse(fs.readFileSync(filename, "utf8"));
    data.version = version;
    fs.writeFileSync(filename, JSON.stringify(data, null, 2) + "\n");
  }
  for (const [file, pattern] of [
    ["src-tauri/Cargo.toml", cargoVersion],
    ["src-tauri/Cargo.lock", lockVersion],
    ["README.md", readmeVersion],
    ["README.md", readmeDevVersion],
  ]) {
    const filename = path.join(root, file);
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, "utf8")
        .replace(
          pattern,
          (_, before, _old, after) => `${before}${version}${after}`,
        ),
    );
  }
  return checkVersions(root);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const argument = process.argv[2];
    if (!argument)
      throw new Error("Usage: node scripts/version.mjs <--check|version>");
    const version =
      argument === "--check" ? checkVersions() : updateVersion(argument);
    console.log(`VoiceApp version ${version}: all version sources agree.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
