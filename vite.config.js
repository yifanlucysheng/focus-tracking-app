import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const webDir = resolve(rootDir, "web");

export default defineConfig({
  root: "web",
  envDir: rootDir,
  // Serve project assets/ at the site root (e.g. /sleepbunny.png, /fonts/...)
  publicDir: resolve(rootDir, "assets"),
  server: {
    fs: {
      allow: [rootDir],
    },
  },
  build: {
    // Website output (separate from the Chrome extension package in dist/)
    outDir: resolve(rootDir, "dist-web"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(webDir, "index.html"),
        session: resolve(webDir, "session.html"),
        stats: resolve(webDir, "stats.html"),
        friends: resolve(webDir, "friends.html"),
        activity: resolve(webDir, "activity.html"),
        settings: resolve(webDir, "settings.html"),
      },
    },
  },
});
