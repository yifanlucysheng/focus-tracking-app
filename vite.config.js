import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

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
    outDir: resolve(rootDir, "dist"),
    emptyOutDir: true,
  },
});
