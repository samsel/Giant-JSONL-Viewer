# Forge JSONL

Forge JSONL is a browser-only JSONL viewer built for large files. It uses a Rust/WASM scanner inside a Web Worker to build a byte-offset line index, then lazily slices and parses only the rows the UI needs.

It is designed for logs, evaluation datasets, model traces, and other newline-delimited JSON files that are too large for ordinary JSON viewers.

## Features

- Rust/WASM newline scanner compiled to `wasm32-unknown-unknown`
- Web Worker indexing so the UI stays responsive
- Virtualized row list for large files
- Lazy row parsing: JSON is parsed when a row is visible or selected
- Summary, tree, and raw views
- Streaming text search with cancel support
- Empty file, invalid row, blocked worker, and no-match states
- No backend and no upload: files stay in your browser

## Demo Dataset Shape

The included sample mirrors evaluation-style JSONL records with this shape:

```json
{
  "example_tags": ["theme:communication"],
  "ideal_completions_data": {
    "ideal_completion": "...",
    "ideal_completions_group": "Group 1",
    "ideal_completions_ref_completions": ["..."]
  },
  "prompt": [{ "role": "user", "content": "..." }],
  "prompt_id": "sample-0001",
  "rubrics": [{ "criterion": "...", "points": 10, "tags": ["axis:accuracy"] }],
  "canary": "synthetic-healthbench:sample-0001"
}
```

## Requirements

- Rust with the `wasm32-unknown-unknown` target
- A local HTTP server
- A modern browser with Web Worker and WebAssembly support
- Node.js only if you want to use the helper scripts

Install the Rust WASM target:

```sh
rustup target add wasm32-unknown-unknown
```

## Run Locally

Build the WASM module:

```sh
cargo build --release --target wasm32-unknown-unknown
```

Serve the project directory:

```sh
python3 -m http.server 8765
```

Open:

```text
http://localhost:8765/index.html
```

Do not open `index.html` directly with a `file://` URL. Browsers block module Workers and WASM fetches from local file URLs.

## npm Convenience Scripts

This project has no npm runtime dependencies, but `package.json` includes convenience scripts:

```sh
npm run build:wasm
npm run check:wasm
npm run serve
npm run dev
```

The npm Rust scripts use `scripts/cargo.mjs`, which looks for `cargo` on your PATH, in `~/.cargo/bin`, and in the Homebrew rustup location on macOS.

## Generate a 1 Million Row Test File

Large JSONL files are intentionally ignored by git. Generate one locally:

```sh
npm run generate:1m
```

Or choose a custom size and path:

```sh
npm run generate -- 1000000 1m_test.jsonl
```

The generated `1m_test.jsonl` is several GB. It is meant for local stress testing, not for committing to GitHub.

## Project Layout

```text
.
├── Cargo.toml
├── index.html
├── styles.css
├── examples/
│   └── sample.jsonl
├── scripts/
│   └── generate-synthetic-jsonl.mjs
└── src/
    ├── app.js
    ├── lib.rs
    └── worker.js
```

## How It Works

1. The browser passes a `File` object to a module Worker.
2. The Worker reads the file in chunks.
3. Rust/WASM scans each chunk for newline byte positions.
4. The Worker stores line-start byte offsets.
5. The UI uses virtual scrolling to request visible rows.
6. The Worker uses `Blob.slice(start, end)` to read only needed rows.
7. Selected rows are parsed into summary, tree, or raw views.

This keeps memory usage much lower than loading and parsing the whole JSONL file into JavaScript objects.

## Publishing to GitHub

Recommended first commit:

```sh
git init
git add .gitignore Cargo.lock Cargo.toml LICENSE README.md index.html package.json styles.css examples scripts src
git commit -m "Initial Forge JSONL viewer"
```

Then create an empty repository on GitHub and push:

```sh
git branch -M main
git remote add origin git@github.com:YOUR_USERNAME/forge-jsonl.git
git push -u origin main
```

## GitHub Pages Demo

This repo includes a GitHub Actions workflow at `.github/workflows/pages.yml`.
After pushing to GitHub, enable Pages with **Settings → Pages → Build and deployment → GitHub Actions**.

The workflow builds the Rust/WASM artifact and deploys the static app.

## Notes

- `target/` is ignored because it is a Rust build artifact.
- `*.jsonl` is ignored by default so large local datasets are not accidentally committed.
- `examples/*.jsonl` is explicitly allowed so small demo data can be versioned.

## License

MIT
