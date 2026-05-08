import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

export default defineConfig({
  root: __dirname,
  server: {
    port: 5917,
    fs: {
      allow: [repoRoot],
    },
  },
});
