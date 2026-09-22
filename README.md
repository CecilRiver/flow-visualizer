# Flow Visualizer

Standalone Vue frontend for browsing Schema-compatible L0-L2 flow-model YAML files. ArduCopter is the first verified
data source, but it is not part of the viewer's project name or runtime directory contract.

The application is designed to run independently from the model-generation project. At runtime, the user selects a
local folder containing previously extracted flow files. The browser reads those files locally in read-only mode,
validates them against an embedded supported Schema version, and renders the selected scenario.

No business scenario YAML is bundled into the production application, and selected file contents are not uploaded.

The implementation follows an internal design specification that is deliberately not part of this repository. Section
citations in this README and in the code comments — for example "6.3" or "12.2" — refer to that document. They are
traceability markers for readers who hold it, not links to anything you can open from here.

## What it is not

These are load-bearing distinctions, not disclaimers:

- **Not a timeline.** The graph is a business data-dependency graph. It does not claim a strict within-loop execution
  order, and the canvas says so permanently.
- **Not a C++ call graph.** A `from → to` edge means one business component supplies data another consumes. Control
  flow, function-level L3 nodes and statement-level calls are out of scope by design.
- **Not an editor.** Nothing is written back. The viewer never calls a create, write or delete API on the chosen
  folder, and there is no export, share-a-link or "apply changes" control.
- **Not a server-backed tool.** There is no backend, no upload, no persistence and no telemetry. Parsing, validation,
  projection and layout all happen in the browser tab.

## Requirements

- Node.js 20+ — `@playwright/test` declares `engines: node >= 20`, and `pnpm test:e2e` is part of the gate. Everything
  else (dev server, build, unit tests) runs on 18, so on an 18-only machine the workaround is
  `npx -y node@20 ./node_modules/@playwright/test/cli.js test`.
- pnpm

## Running it

```powershell
pnpm install
pnpm dev            # dev server
pnpm build          # typecheck + production build into dist/
pnpm preview        # serve the built output
```

The build is a static site: `dist/` can be served by anything, from any path.

## The folder contract

The viewer is only as good as the folder you point it at. What it accepts:

- YAML files (`.yaml` / `.yml`) **directly inside the chosen folder**, under `scenarios/`, or named `*.flow.yaml`.
- Each must declare a `schema_version` the viewer supports — currently `0.1`.
- Hidden directories, `.git`, `node_modules` and `dist` are not descended into.

Point it at an extraction-result directory, not at an ArduPilot source checkout. Selecting the repository root hits the
resource limits below and is refused with that suggestion.

Resource limits, enforced before anything is parsed:

| Limit | Value |
| --- | --- |
| Path depth | 8 segments |
| Files scanned | 500 |
| Single YAML file | 5 MiB |
| Total YAML | 50 MiB |
| Concurrent file reads | 4 |

A folder that exceeds a hard limit is refused outright: the viewer will not draw a graph from a truncated scan, because
a partial picture presented as a complete one is worse than no picture.

### Schema

The Schema registry is **embedded and versioned in the bundle** (`src/schemas/`). A folder may declare which supported
version its files use; it can never supply a replacement schema. A config directory does not get to change the rules it
is judged by.

The committed snapshot is digest-checked by `pnpm schema:check`, and the TypeScript types generated from it are checked
for drift by the same command.

### Validity, evidence and review are three different things

- `schema_version` + successful validation → the file is **configuration-valid**.
- Per-item `verification` → whether a specific claim's **evidence** was confirmed against source and documentation.
- `model.review_status` → whether the model as a whole was **human-reviewed**.

The UI keeps them visibly apart. A schema-validated model is not a reviewed one, and the status bar says so.

## Browser support

`showDirectoryPicker` (File System Access API) is used when available, and the folder handle is kept so **刷新** can
re-read it. Where it is absent — Firefox, Safari — the viewer falls back to a one-shot `<input webkitdirectory>`
snapshot, says so on the welcome page, and offers **更换目录** instead of refresh, because a `FileList` cannot be
re-read.

Either way the directory is opened with `mode: 'read'`.

## Configuration

One build-time constant is configurable:

```powershell
$env:VITE_GITHUB_BASE = "https://github.com/<owner>/<repo>"
pnpm build
```

It is the base for source-code links, which are always built as `{base}/blob/{pinned-sha}/{relative-path}#L{start}-L{end}`.
Nothing in a configuration file can influence the host a link points at, and evidence URLs are only ever rendered as
links when they parse as `https:`.

## URL parameters

The query string carries **view state only** — never a folder name, a path or a handle. It cannot grant file access:
after a reload the viewer returns to the welcome page, and `bundle`/`scenario` are honoured only if the folder you then
pick actually contains those ids.

| Parameter | Meaning |
| --- | --- |
| `bundle` | `model.id` to activate |
| `scenario` | Scenario id to activate |
| `level` | `0`, `1` or `2` (default `2`) |
| `flow` | Comma-separated flow kinds to keep |
| `verification` | Comma-separated verification states to keep |

Defaults are omitted, and unrecognised values are ignored with a visible notice rather than failing the boot.

## Development

```
src/
  adapters/     the only framework adaptation (domain model -> Vue Flow elements)
  app/          build-time constants and URL state
  catalog/      folder scan -> validated bundles
  domain/       pure model, labels, indexes, validation, source links
  filesystem/   the two folder adapters and the path policy
  layout/       ELK layout, with a deterministic column fallback
  projection/   scenario slicing, level folding, edge aggregation
  schemas/      the embedded Schema registry
  stores/       Pinia: catalog, explorer UI state, folder authorisation
```

Dependencies flow one way: components read stores, stores call `catalog`/`projection`/`layout`, and `domain` depends
on nothing but itself. The single framework-facing module is `adapters/vueFlow/`.

### Tests

```powershell
pnpm test:run       # unit + component (Vitest, jsdom)
pnpm test:e2e       # Playwright against the built output
```

The E2E suite covers five acceptance paths — a folder picked through the fallback input, a folder mixing valid and
invalid files, level switching with URL synchronisation, Inspector source and evidence links, and a refused folder —
and takes layout screenshots at 1440x900 and 1024x768. It serves `dist/`, so **run `pnpm build` first**.

`showDirectoryPicker` is mocked — the browser capability is the seam, not the application. Everything above it (the
handle walk, limits, path normalisation, parsing, validation, projection, layout) is the real code. The fixtures are
committed as ordinary YAML under `tests/fixtures/folders/`, so a failure can be reproduced by opening the same folder in
a browser by hand.

## Quality gate

```powershell
pnpm check          # schema:check -> lint -> test:run -> build (build includes typecheck)
```

`pnpm typecheck` runs `vue-tsc --build --force`; plain `--noEmit` checks nothing here, because the root `tsconfig.json`
is a solution file with `files: []` and project references.
