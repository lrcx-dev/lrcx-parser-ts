import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
export const SHOWCASE_PATH = path.resolve(
  PACKAGE_ROOT,
  "playground/showcase/lrcx-example.lrcx",
);
export const MODES = ["Strict", "Standard", "Loose"];

const buildIndexUrl = pathToFileURL(
  path.resolve(PACKAGE_ROOT, "builds/packages/index.js"),
).href;

let parserModulePromise;
let showcaseTextPromise;

export async function loadParserModule() {
  if (!parserModulePromise) {
    parserModulePromise = import(buildIndexUrl);
  }
  return parserModulePromise;
}

export async function getShowcaseText() {
  if (!showcaseTextPromise) {
    showcaseTextPromise = readFile(SHOWCASE_PATH, "utf8");
  }
  return showcaseTextPromise;
}

export async function parseWith(mode, text) {
  const mod = await loadParserModule();
  const Parser = mod[`LRCX${mode}Parser`];
  const parser = new Parser(text);
  const result = parser.parse();

  return {
    mod,
    parser,
    result,
    errors: parser.getErrors(),
    warnings: parser.getWarnings(),
  };
}

export async function parseShowcase(mode = "Standard") {
  return parseWith(mode, await getShowcaseText());
}

export function joinLines(lines) {
  return lines.join("\n");
}
