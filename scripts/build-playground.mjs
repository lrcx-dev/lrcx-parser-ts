import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { cleanGenerated } from "./clean-generated.mjs";
import { buildLibrary } from "./build-lib.mjs";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

function resolveRequiredEntry(specifiers, message) {
  for (const specifier of specifiers) {
    try {
      return require.resolve(specifier);
    } catch {
      // Try the next candidate.
    }
  }

  console.error(message);
  process.exit(1);
}

function resolveViteCli() {
  const vitePackageJson = resolveRequiredEntry(
    ["vite/package.json"],
    "Vite package not found. Install 'vite' locally before building the playground.",
  );
  const viteRoot = path.dirname(vitePackageJson);
  return path.join(viteRoot, "bin", "vite.js");
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      reject(new Error(`[${label}] ${error instanceof Error ? error.message : String(error)}`));
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`[${label}] exited with signal ${signal}`));
        return;
      }
      if ((code ?? 0) !== 0) {
        reject(new Error(`[${label}] exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const viteEntry = resolveRequiredEntry(
    [resolveViteCli()],
    "Vite CLI not found. Install 'vite' locally before building the playground.",
  );

  await cleanGenerated(["dist/playground"]);
  await buildLibrary();
  await run(
    process.execPath,
    [
      viteEntry,
      "build",
      "--config",
      "playground/vite.config.mjs",
      "--configLoader",
      "native",
    ],
    "vite-build",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
