import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

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
    "Vite package not found. Install 'vite' locally before running the preview.",
  );
  const viteRoot = path.dirname(vitePackageJson);
  return path.join(viteRoot, "bin", "vite.js");
}

function spawnProcess(command, args, label) {
  const child = spawn(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`[${label}] ${error instanceof Error ? error.message : String(error)}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (isShuttingDown) {
      return;
    }
    if (signal) {
      console.error(`[${label}] exited with signal ${signal}`);
    } else if ((code ?? 0) !== 0) {
      console.error(`[${label}] exited with code ${code}`);
    }
    shutdown(code ?? 1);
  });

  children.add(child);
  return child;
}

function runOnce(command, args, label) {
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

let isShuttingDown = false;
const children = new Set();

function shutdown(code = 0) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(code);
  }, 250).unref();
}

async function main() {
  const tscEntry = resolveRequiredEntry(
    ["typescript/bin/tsc", "typescript/lib/tsc.js"],
    "TypeScript compiler not found. Install 'typescript' locally or ensure it is resolvable from this environment.",
  );
  const viteEntry = resolveRequiredEntry(
    [resolveViteCli()],
    "Vite CLI not found. Install 'vite' locally before running the preview.",
  );

  await runOnce(
    process.execPath,
    [tscEntry, "-p", "tsconfig.json"],
    "tsc",
  );

  spawnProcess(
    process.execPath,
    [tscEntry, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"],
    "tsc-watch",
  );

  spawnProcess(
    process.execPath,
    [
      viteEntry,
      "--config",
      "playground/vite.config.mjs",
      "--configLoader",
      "native",
      "--host",
    ],
    "vite",
  );
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
});
