const CHUNK_SIZE = 8 * 1024 * 1024;
const WASM_URL =
  "../target/wasm32-unknown-unknown/release/giant_jsonl_viewer.wasm?v=20260619-clear";

let wasm = null;
let wasmReady = false;
let file = null;
let offsets = [0];
let rowCount = 0;
let searchCancelled = false;
let wasmInit = null;

async function initWasm() {
  try {
    const module = await WebAssembly.instantiateStreaming(fetch(WASM_URL), {});
    wasm = module.instance;
    wasmReady = true;
    postMessage({ type: "ready", wasm: true });
  } catch (error) {
    wasmReady = false;
    postMessage({ type: "ready", wasm: false, error: error.message });
  }
}

function formatError(error) {
  return error && error.message ? error.message : String(error);
}

function scanNewlinesJs(bytes) {
  const positions = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 10) positions.push(i);
  }
  return positions;
}

function scanNewlinesWasm(bytes) {
  const exports = wasm.exports;
  const inputPtr = exports.alloc_u8(bytes.length);
  const outputPtr = exports.alloc_u32(bytes.length);
  const memory = new Uint8Array(exports.memory.buffer);
  memory.set(bytes, inputPtr);
  const count = exports.scan_newlines(inputPtr, bytes.length, outputPtr, bytes.length);
  const positions = new Uint32Array(
    exports.memory.buffer,
    outputPtr,
    Math.min(count, bytes.length)
  ).slice();
  exports.dealloc_u8(inputPtr, bytes.length);
  exports.dealloc_u32(outputPtr, bytes.length);
  return positions;
}

async function openFile(nextFile) {
  if (wasmInit) await wasmInit;
  file = nextFile;
  offsets = [0];
  rowCount = 0;
  const started = performance.now();
  let cursor = 0;

  while (cursor < file.size) {
    const end = Math.min(file.size, cursor + CHUNK_SIZE);
    const bytes = new Uint8Array(await file.slice(cursor, end).arrayBuffer());
    const positions = wasmReady ? scanNewlinesWasm(bytes) : scanNewlinesJs(bytes);

    for (const position of positions) {
      const nextStart = cursor + Number(position) + 1;
      if (nextStart < file.size) offsets.push(nextStart);
    }

    rowCount = offsets.length;
    cursor = end;
    postMessage({ type: "progress", lines: rowCount, bytes: cursor });
  }

  if (file.size === 0) {
    rowCount = 0;
    offsets = [];
  } else {
    rowCount = offsets.length;
  }

  return {
    rowCount,
    elapsed: performance.now() - started,
    engine: wasmReady ? "Rust/WASM" : "JS fallback",
  };
}

function clearFile() {
  searchCancelled = true;
  file = null;
  offsets = [0];
  rowCount = 0;
  return { rowCount };
}

function lineBounds(line) {
  const start = offsets[line];
  let end = line + 1 < offsets.length ? offsets[line + 1] - 1 : file.size;
  if (end < start) end = start;
  return { start, end };
}

async function readLine(line) {
  const { start, end } = lineBounds(line);
  let raw = await file.slice(start, end).text();
  if (raw.endsWith("\r")) raw = raw.slice(0, -1);
  return { raw, bytes: end - start };
}

function summarize(index, raw, bytes, includeJson = false) {
  try {
    const json = JSON.parse(raw);
    const prompt = Array.isArray(json.prompt)
      ? json.prompt.map((msg) => `${msg.role || "message"}: ${msg.content || ""}`).join(" ")
      : "";
    const tags = [
      ...(Array.isArray(json.example_tags) ? json.example_tags : []),
      ...(Array.isArray(json.rubrics)
        ? json.rubrics.flatMap((rubric) => (Array.isArray(rubric.tags) ? rubric.tags : []))
        : []),
    ];
    const group = json.ideal_completions_data?.ideal_completions_group;
    const title = prompt || raw;
    const row = {
      index,
      bytes,
      title: shortText(title, 210),
      chips: [...new Set([group, ...tags].filter(Boolean))].slice(0, 8),
    };
    if (includeJson) {
      row.raw = raw;
      row.json = json;
    }
    return row;
  } catch (error) {
    return {
      index,
      bytes,
      title: shortText(raw, 210),
      chips: ["invalid-json"],
      raw: includeJson ? raw : undefined,
      error: includeJson ? formatError(error) : undefined,
    };
  }
}

function shortText(value, max) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

async function getRows(lines) {
  const rows = [];
  for (const line of lines) {
    if (line < 0 || line >= rowCount) continue;
    const { raw, bytes } = await readLine(line);
    rows.push(summarize(line, raw, bytes));
  }
  return rows;
}

async function getRowDetail(line) {
  const { raw, bytes } = await readLine(line);
  return summarize(line, raw, bytes, true);
}

async function searchRows(query, limit) {
  searchCancelled = false;
  const needle = query.toLowerCase();
  const matches = [];

  for (let line = 0; line < rowCount; line++) {
    if (searchCancelled) throw new Error("Search cancelled");
    const { raw } = await readLine(line);
    if (raw.toLowerCase().includes(needle)) {
      matches.push(line);
      if (matches.length >= limit) {
        return { matches, truncated: true };
      }
    }
    if (line % 250 === 0) {
      postMessage({ type: "search-progress", line: line + 1, matches: matches.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return { matches, truncated: false };
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "cancel-search") {
    searchCancelled = true;
    return;
  }

  try {
    if (message.type === "open-file") {
      const result = await openFile(message.file);
      postMessage({ id: message.id, ...result });
    } else if (message.type === "clear-file") {
      postMessage({ id: message.id, ...clearFile() });
    } else if (message.type === "rows") {
      postMessage({ id: message.id, rows: await getRows(message.lines) });
    } else if (message.type === "row-detail") {
      postMessage({ id: message.id, row: await getRowDetail(message.line) });
    } else if (message.type === "search") {
      postMessage({ id: message.id, ...(await searchRows(message.query, message.limit || 5000)) });
    }
  } catch (error) {
    postMessage({ id: message.id, error: formatError(error) });
  }
};

wasmInit = initWasm();
