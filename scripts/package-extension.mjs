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
  "site-bridge.js",
  "logo.PNG",
  "fonts/PPMondwest-Regular.otf",
  "fonts/LXGWMarkerGothic.ttf",
  "moon1.png",
  "moon2.png",
  "moon3.png",
  "moon4.png",
  "moon5.png",
  "moonbuddysprites/stage1moon/yaybunny.png",
  "moonbuddysprites/stage2moon/sleepbunny.png",
  "moonbuddysprites/stage3moon/stage3.png",
  "moonbuddysprites/stage4moon/stage4bunny.png",
  "moonbuddysprites/stage5moon/gravestone.png",
  "cat.png",
  "cat2.png",
  "cat3.png",
  "cat4.png",
  "cat5.png",
  "cat6.png",
  "cat7.png",
  "secrets.public.js",
  "web/index.html",
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
// Packaged extension always runs the inlined service-worker.js build.
manifest.background = { service_worker: "service-worker.js" };
fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);

copyFile("service-worker.js");
copyFile("popup.html");
copyFile("popup.js");
copyFile("popup-auth.js");
copyFile("style.css");
copyFile("overlay.js");
copyFile("site-bridge.js");
copyFile("logo.PNG");
copyFile("assets/fonts/PPMondwest-Regular.otf", "fonts/PPMondwest-Regular.otf");
copyFile("assets/fonts/LXGWMarkerGothic.ttf", "fonts/LXGWMarkerGothic.ttf");
// Website assets/ are the source of truth for buddy stage sprites.
copyFile("assets/moon1.png", "moon1.png");
copyFile("assets/moon2.png", "moon2.png");
copyFile("assets/moon3.png", "moon3.png");
copyFile("assets/moon4.png", "moon4.png");
copyFile("assets/moon5.png", "moon5.png");
fs.cpSync(path.join(root, "moonbuddysprites"), path.join(outDir, "moonbuddysprites"), {
  recursive: true,
});
copyFile("assets/cat.png", "cat.png");
copyFile("assets/cat2.png", "cat2.png");
copyFile("assets/cat3.png", "cat3.png");
copyFile("assets/cat4.png", "cat4.png");
copyFile("assets/cat5.png", "cat5.png");
copyFile("assets/cat6.png", "cat6.png");
copyFile("assets/cat7.png", "cat7.png");
fs.cpSync(path.join(root, "web"), path.join(outDir, "web"), { recursive: true });
if (fs.existsSync(path.join(root, "couchareasprites"))) {
  fs.cpSync(
    path.join(root, "couchareasprites"),
    path.join(outDir, "couchareasprites"),
    { recursive: true }
  );
}
copyFile("secrets.public.js");
if (fs.existsSync(path.join(root, "assets"))) {
  fs.cpSync(path.join(root, "assets"), path.join(outDir, "assets"), {
    recursive: true,
  });
}

// Popup ES modules import these (Friends activity + cloud sync).
const popupWebModules = [
  "web/cloud.js",
  "web/firebase-config.js",
  "web/session-sync.js",
  "web/vendor/firebase.js",
  "web/profile/calculateStats.js",
  "web/profile/sessionSummary.js",
  "web/profile/focusStreak.js",
  "web/profile/xp.js",
];
for (const rel of popupWebModules) {
  copyFile(rel);
  REQUIRED_FILES.push(rel);
}

// Optional local overrides (Gemini, etc.). Do not copy the placeholder example.
const secretsSrc = path.join(root, "secrets.local.js");
if (fs.existsSync(secretsSrc)) {
  copyFile("secrets.local.js");
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
const allowedSecrets = /secrets\.(public|local)\.js/;
const badImports = importScripts.filter((args) => !allowedSecrets.test(args));
if (badImports.length) {
  throw new Error(
    `service-worker.js has unexpected importScripts (must only load secrets): ${badImports.join("; ")}`
  );
}
if (!/importScripts\(\s*["']secrets\.public\.js["']\s*\)/.test(sw)) {
  throw new Error("service-worker.js does not importScripts secrets.public.js");
}

// 5) Verify popup script tags resolve
const popup = fs.readFileSync(path.join(outDir, "popup.html"), "utf8");
for (const src of ["popup.js", "style.css"]) {
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

const zipPath = path.join(root, "focus-buddy-extension.zip");
if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
execSync(`zip -r "${zipPath}" . -x "*.DS_Store"`, {
  cwd: outDir,
  stdio: "inherit",
});
console.log("Shareable zip:", zipPath);
