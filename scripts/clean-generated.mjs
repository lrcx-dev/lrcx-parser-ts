import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

const defaultTargets = [
  "builds/packages",
  "dist/playground",
];

export async function cleanGenerated(targets = defaultTargets) {
  await Promise.all(
    targets.map(async (target) => {
      const absoluteTarget = path.resolve(packageRoot, target);

      if (target === "builds/packages") {
        await removeMatchingFiles(absoluteTarget, (entry) => entry.name.endsWith(".map"));
        return;
      }

      try {
        await rm(absoluteTarget, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      } catch (error) {
        throw error;
      }
    }),
  );
}

async function removeMatchingFiles(directory, predicate) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  }).catch(() => []);

  await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await removeMatchingFiles(absolutePath, predicate);
        return;
      }
      if (!entry.isFile() || !predicate(entry)) {
        return;
      }
      await rm(absolutePath, {
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }).catch((error) => {
        if (
          error &&
          typeof error === "object" &&
          ("code" in error) &&
          (error.code === "EPERM" || error.code === "EBUSY")
        ) {
          return;
        }
        throw error;
      });
    }),
  );
}

if (process.argv[1] === __filename) {
  const targets = process.argv.slice(2);
  cleanGenerated(targets.length > 0 ? targets : defaultTargets).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
