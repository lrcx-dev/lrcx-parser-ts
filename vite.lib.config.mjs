import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  build: {
    target: "esnext",
    outDir: path.resolve(__dirname, "builds/packages"),
    emptyOutDir: false,
    sourcemap: false,
    minify: "oxc",
    lib: {
      entry: path.resolve(__dirname, "packages/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      output: {
        preserveModules: true,
        preserveModulesRoot: path.resolve(__dirname, "packages"),
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        exports: "named",
        minify: {
          compress: true,
          mangle: true,
          codegen: {
            removeWhitespace: true,
          },
        },
      },
    },
  },
});
