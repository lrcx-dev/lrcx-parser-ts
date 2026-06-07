# lrcx-parser

TypeScript parser and serializer for the LRCX v1.0 lyric format, with strictness-aware recovery modes and a preview playground.

## Project Architecture

- `packages/`: library source for parser, serializer, exported types, and shared utilities.
- `scripts/`: local build wrappers and preview/build orchestration for TypeScript and Vite.
- `tests/`: Jest coverage for parser diagnostics, serialization, and showcase compliance.
- `playground/`: Vite-based preview UI for inspecting parsed output and timing behavior.
- `builds/packages/`: compiled library output published to npm.
- `dist/playground/`: static playground bundle for GitHub Pages.

## Playground

Online preview: [http://lrcx-dev.github.io/lrcx-parser-ts/](http://lrcx-dev.github.io/lrcx-parser-ts/)

Local preview:

```bash
npm install
npm run dev
```

`npm run dev` does three things in order:

1. Removes stale sourcemaps from the previous library build.
2. Runs one TypeScript build into `builds/packages/`.
3. Starts `tsc --watch` and the Vite dev server for `playground/`.

`scripts/run-tsc.mjs` is only a thin wrapper around the locally installed TypeScript CLI. It resolves `typescript` from `node_modules` and forwards the arguments unchanged.

For npm publishing, `npm run build` uses a different pipeline:

1. `tsc --emitDeclarationOnly` writes `.d.ts` files into `builds/packages/`.
2. Vite lib mode rebuilds `packages/index.ts` into minified ESM JavaScript in the same output directory.

## Get Started

Install:

```bash
npm install lrcx-parser
```

Parse with the default `Standard` mode:

```ts
import { LyricResolveMode, parseLRCX } from "lrcx-parser";

const result = parseLRCX(sourceText, LyricResolveMode.Standard);
```

Collect diagnostics from an explicit parser instance:

```ts
import { LRCXLooseParser } from "lrcx-parser";

const parser = new LRCXLooseParser(sourceText);
const document = parser.parse();
const errors = parser.getErrors();
const warnings = parser.getWarnings();
```

The library supports three parsing modes:

| Mode | Typical behavior | Result status on recoverable issues |
| --- | --- | --- |
| `Strict` | Fails fast on invalid or conflicting content. | `Abort` |
| `Standard` | Keeps useful output but stops at the point where correctness is no longer guaranteed. | `Partial` |
| `Loose` | Preserves as much observable content as possible for preview, migration, or repair workflows. | `Fragment` |

## Development

Install dependencies:

```bash
npm install
```

Common commands:

| Command | Description |
| --- | --- |
| `npm run clean` | Remove stale library sourcemaps and delete the generated playground bundle. |
| `npm run build` | Build the publishable library artifact: `.d.ts` via `tsc`, minified `.js` via Vite lib mode. |
| `npm run build:watch` | Keep the local TypeScript compiler in watch mode for playground-oriented iteration. |
| `npm run build:playground` | Rebuild the library and emit the static playground bundle to `dist/playground/`. |
| `npm run dev` | Build once, then run the library watcher and the playground dev server together. |
| `npm test` | Rebuild the publish artifact and run the Jest suite in-band. |

Test coverage is organized around the public library surface:

- `tests/lrcx-parser.mode-diagnostics.test.mjs`: strict/standard/loose recovery semantics.
- `tests/lrcx-parser.serialize.test.mjs`: serialization behavior.
- `tests/lrcx-parser.baseline-errors.test.mjs`: baseline syntax and tag validation.
- `tests/lrcx-parser.showcase.test.mjs`: end-to-end compliance against the showcase draft.

For packaging, `npm pack` and `npm publish` trigger `prepack`, which rebuilds the minified publish artifact before files are collected.

## License

[MIT](./LICENSE)
