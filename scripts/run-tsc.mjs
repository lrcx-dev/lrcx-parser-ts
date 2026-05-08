import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);

const candidateSpecifiers = [
  "typescript/bin/tsc",
  "typescript/lib/tsc.js",
];

let resolvedEntry = null;
for (const specifier of candidateSpecifiers) {
  try {
    resolvedEntry = require.resolve(specifier);
    break;
  } catch {
    // Try the next candidate.
  }
}

if (!resolvedEntry) {
  console.error(
    "TypeScript compiler not found. Install 'typescript' locally or ensure it is resolvable from this environment.",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [resolvedEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
