/**
 * Package the Chrome extension into dist/ for Load unpacked.
 *
 * Note: Vite's website build previously wrote to dist/ and does NOT include
 * any extension files. This script is the extension production output.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist");

/** Files that must appear in the packaged extension (relative to package root). */
const REQUIRED_FILES = [
  "manifest.json",
  "service-worker.js",
  "popup.html",
  "popup.js",
  "popup-auth.js",
  "style.css",
  "overlay.js",
  "logo.PNG",
  "sleepbunny.png",
  "angrybunny.png",
  "secrets.local.js",
];

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(srcRel, destRel = srcRel) {
  const src = path.join(root, srcRel);
  const dest = path.join(outDir, destRel);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source file for extension package: ${srcRel}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// 1) Build inlined service worker (auth + background)
execSync("node scripts/build-service-worker.mjs", {
  cwd: root,
  stdio: "inherit",
});

// 2) Fresh dist/ for the extension only
rimraf(outDir);
fs.mkdirSync(outDir, { recursive: true });

const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8")
);
if (manifest?.background?.service_worker !== "service-worker.js") {
  throw new Error(
    `manifest background.service_worker must be service-worker.js (got ${manifest?.background?.service_worker})`
  );
}

copyFile("manifest.json");
copyFile("service-worker.js");
copyFile("popup.html");
copyFile("popup.js");
copyFile("popup-auth.js");
copyFile("style.css");
copyFile("overlay.js");
copyFile("logo.PNG");
copyFile("sleepbunny.png");
copyFile("angrybunny.png");

// secrets: prefer real local secrets; fall back to example so the SW can load
const secretsSrc = path.join(root, "secrets.local.js");
const secretsExample = path.join(root, "secrets.local.example.js");
if (fs.existsSync(secretsSrc)) {
  copyFile("secrets.local.js");
} else if (fs.existsSync(secretsExample)) {
  fs.copyFileSync(secretsExample, path.join(outDir, "secrets.local.js"));
  console.warn(
    "[package-extension] secrets.local.js missing — copied secrets.local.example.js into dist/. Replace with real keys before sign-in."
  );
} else {
  throw new Error("Neither secrets.local.js nor secrets.local.example.js found.");
}

// 3) Verify every required path exists (what Chrome will fetch)
const missing = REQUIRED_FILES.filter(
  (f) => !fs.existsSync(path.join(outDir, f))
);
if (missing.length) {
  throw new Error(`Extension package incomplete. Missing in dist/: ${missing.join(", ")}`);
}

// 4) Verify SW only importScripts secrets from package root (no vendor/ paths)
const sw = fs.readFileSync(path.join(outDir, "service-worker.js"), "utf8");
const importScripts = [...sw.matchAll(/importScripts\(([^)]+)\)/g)].map((m) =>
  m[1].trim()
);
const badImports = importScripts.filter((args) => {
  return !/secrets\.local\.js/.test(args);
});
if (badImports.length) {
  throw new Error(
    `service-worker.js has unexpected importScripts (must only load secrets.local.js): ${badImports.join("; ")}`
  );
}
if (!/importScripts\(\s*["']secrets\.local\.js["']\s*\)/.test(sw)) {
  throw new Error("service-worker.js does not importScripts secrets.local.js");
}

// 5) Verify popup script tags resolve
const popup = fs.readFileSync(path.join(outDir, "popup.html"), "utf8");
for (const src of ["popup-auth.js", "popup.js", "style.css"]) {
  if (!popup.includes(src)) {
    throw new Error(`popup.html does not reference ${src}`);
  }
}

console.log("Packaged Chrome extension → dist/");
console.log("Load unpacked:", outDir);
for (const f of REQUIRED_FILES) {
  const size = fs.statSync(path.join(outDir, f)).size;
  console.log(`  OK  ${f} (${size} bytes)`);
}
