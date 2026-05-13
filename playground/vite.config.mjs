import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  root: __dirname,
  base,
  build: {
    outDir: path.resolve(packageRoot, "dist/playground"),
    emptyOutDir: false,
  },
  server: {
    port: 5917,
    fs: {
      allow: [packageRoot],
    },
  },
});
