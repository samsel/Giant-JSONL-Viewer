const ROW_HEIGHT = 84;
const OVERSCAN = 8;
const SAMPLE_FILE = "./examples/sample.jsonl";
const SAMPLE_NAME = "sample.jsonl";

const state = {
  ready: false,
  rowCount: 0,
  selected: -1,
  rows: new Map(),
  tab: "summary",
  searchResults: null,
  fileName: "",
};

let worker = null;
const pending = new Map();
let requestId = 0;
let renderScheduled = false;

const els = {
  engine: document.getElementById("engine"),
  fileInput: document.getElementById("fileInput"),
  loadSample: document.getElementById("loadSample"),
  cancelSearch: document.getElementById("cancelSearch"),
  headline: document.getElementById("headline"),
  fileSize: document.getElementById("fileSize"),
  rowCount: document.getElementById("rowCount"),
  indexTime: document.getElementById("indexTime"),
  searchInput: document.getElementById("searchInput"),
  searchButton: document.getElementById("searchButton"),
  status: document.getElementById("status"),
  jumpInput: document.getElementById("jumpInput"),
  list: document.getElementById("list"),
  spacer: document.getElementById("spacer"),
  rows: document.getElementById("rows"),
  lineLabel: document.getElementById("lineLabel"),
  rowTitle: document.getElementById("rowTitle"),
  detail: document.getElementById("detail"),
  tabs: document.querySelector(".tabs"),
};

try {
  worker = new Worker("./src/worker.js", { type: "module" });
} catch (_error) {
  showFatal(
    "This browser blocked the worker. Serve the app from http://localhost:8765/index.html instead of opening index.html directly."
  );
}

function callWorker(type, payload = {}, transfer) {
  if (!worker) {
    return Promise.reject(new Error("Worker unavailable. Open http://localhost:8765/index.html."));
  }
  const id = ++requestId;
  worker.postMessage({ id, type, ...payload }, transfer || []);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

if (worker)
  worker.onmessage = (event) => {
    const message = event.data;
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error));
      else resolve(message);
      return;
    }

    if (message.type === "ready") {
      state.ready = true;
      els.engine.textContent = message.wasm
        ? "Rust/WASM scanner active"
        : "JS scanner fallback active";
    }

    if (message.type === "progress") {
      els.status.textContent = `Indexing ${formatNumber(message.lines)} rows · ${formatBytes(message.bytes)} scanned`;
      els.rowCount.textContent = formatNumber(message.lines);
    }

    if (message.type === "search-progress") {
      els.status.textContent = `Searching line ${formatNumber(message.line)} · ${formatNumber(message.matches)} matches`;
    }
  };

if (worker)
  worker.onerror = (event) => {
    const message = event.message || "The worker crashed while processing the file.";
    rejectPending(message);
    showFatal(message);
  };

if (worker)
  worker.onmessageerror = () => {
    const message = "The browser could not pass data to the worker.";
    rejectPending(message);
    showFatal(message);
  };

function showFatal(message) {
  els.engine.textContent = "Worker blocked";
  els.status.textContent = message;
  els.rowTitle.textContent = "Cannot start worker";
  els.detail.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
  els.loadSample.disabled = true;
  els.searchButton.disabled = true;
}

function rejectPending(message) {
  for (const { reject } of pending.values()) {
    reject(new Error(message));
  }
  pending.clear();
}

function setBusy(isBusy, message) {
  els.fileInput.disabled = isBusy;
  els.loadSample.disabled = isBusy;
  els.searchButton.disabled = isBusy || !state.rowCount;
  if (message) els.status.textContent = message;
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function openFile(file) {
  setBusy(true, "Starting byte-offset index");
  state.rows.clear();
  state.rowCount = 0;
  state.selected = -1;
  state.searchResults = null;
  state.fileName = file.name;
  els.headline.textContent = file.name;
  els.fileSize.textContent = formatBytes(file.size);
  els.rowCount.textContent = "0";
  els.indexTime.textContent = "0 ms";
  els.detail.innerHTML = '<div class="empty">Indexing line starts in a worker.</div>';
  els.rowTitle.textContent = "Indexing";
  els.lineLabel.textContent = "No row selected";
  els.spacer.style.height = "0px";
  els.rows.innerHTML = "";

  try {
    const result = await callWorker("open-file", { file });
    state.rowCount = result.rowCount;
    els.rowCount.textContent = formatNumber(result.rowCount);
    els.indexTime.textContent = `${Math.round(result.elapsed)} ms`;
    els.status.textContent = `Indexed ${formatNumber(result.rowCount)} rows using ${result.engine}.`;
    els.spacer.style.height = `${result.rowCount * ROW_HEIGHT}px`;
    els.jumpInput.max = String(result.rowCount || 1);

    if (result.rowCount) {
      await selectLine(0, true);
    } else {
      showEmptyFile();
    }
    scheduleRenderRows();
  } finally {
    setBusy(false);
  }
}

async function loadSample() {
  const response = await fetch(SAMPLE_FILE, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not fetch sample: ${response.status}`);
  const blob = await response.blob();
  const file = new File([blob], SAMPLE_NAME, { type: "application/jsonl" });
  await openFile(file);
}

function visibleRange() {
  const total = state.searchResults ? state.searchResults.length : state.rowCount;
  const start = Math.max(0, Math.floor(els.list.scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visible = Math.ceil(els.list.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
  return { start, count: Math.min(visible, Math.max(0, total - start)), total };
}

function sourceLineAt(displayIndex) {
  return state.searchResults ? state.searchResults[displayIndex] : displayIndex;
}

async function renderRows() {
  renderScheduled = false;
  const { start, count, total } = visibleRange();
  els.spacer.style.height = `${total * ROW_HEIGHT}px`;

  if (!count) {
    els.rows.innerHTML = '<div class="empty">No rows</div>';
    return;
  }

  const displayIndexes = Array.from({ length: count }, (_, i) => start + i);
  const missing = displayIndexes
    .map((displayIndex) => sourceLineAt(displayIndex))
    .filter((line) => line != null && !state.rows.has(line));

  if (missing.length) {
    try {
      const fetched = await callWorker("rows", { lines: missing });
      for (const row of fetched.rows) {
        state.rows.set(row.index, { ...(state.rows.get(row.index) || {}), ...row });
      }
    } catch (error) {
      els.status.textContent = `Could not load visible rows: ${error.message}`;
      els.rows.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
      return;
    }
  }

  els.rows.style.transform = `translateY(${start * ROW_HEIGHT}px)`;
  els.rows.innerHTML = displayIndexes
    .map((displayIndex) => {
      const line = sourceLineAt(displayIndex);
      const row = state.rows.get(line);
      const active = line === state.selected ? " active" : "";
      const chips = row?.chips || [];
      return `
      <button class="row${active}" style="top:${(displayIndex - start) * ROW_HEIGHT}px" data-line="${line}">
        <span class="row-index">#${line + 1}</span>
        <span>
          <span class="row-title">${escapeHtml(row?.title || "Loading row")}</span>
          <span class="chips">${chips
            .slice(0, 5)
            .map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`)
            .join("")}</span>
        </span>
      </button>
    `;
    })
    .join("");
}

function scheduleRenderRows() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(renderRows);
}

async function selectLine(line, scrollIntoView = false) {
  if (line < 0 || line >= state.rowCount) return;
  state.selected = line;
  els.jumpInput.value = String(line + 1);

  if (scrollIntoView) {
    const displayIndex = state.searchResults ? state.searchResults.indexOf(line) : line;
    if (displayIndex >= 0) {
      els.list.scrollTop = Math.max(0, displayIndex * ROW_HEIGHT - ROW_HEIGHT);
    }
  }

  try {
    let row = state.rows.get(line);
    if (!row?.raw) {
      els.lineLabel.textContent = `Line ${formatNumber(line + 1)}`;
      els.rowTitle.textContent = "Loading row";
      els.detail.innerHTML = '<div class="empty">Loading selected row.</div>';
      const fetched = await callWorker("row-detail", { line });
      row = fetched.row;
      state.rows.set(line, { ...(state.rows.get(line) || {}), ...row });
    }

    renderDetail(row);
    scheduleRenderRows();
  } catch (error) {
    els.status.textContent = `Could not load line ${formatNumber(line + 1)}: ${error.message}`;
    els.detail.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function showEmptyFile() {
  state.selected = -1;
  els.lineLabel.textContent = "No rows";
  els.rowTitle.textContent = "Empty file";
  els.detail.innerHTML = '<div class="empty">This file has no JSONL rows.</div>';
  els.rows.innerHTML = '<div class="empty">No rows</div>';
}

function renderDetail(row) {
  els.lineLabel.textContent = `Line ${formatNumber(row.index + 1)} · ${formatBytes(row.bytes)}`;
  els.rowTitle.textContent = row.title;

  if (row.error) {
    els.detail.innerHTML = `<div class="error">${escapeHtml(row.error)}</div><div class="section"><h3>Raw</h3><pre>${escapeHtml(row.raw)}</pre></div>`;
    return;
  }

  if (state.tab === "raw") {
    els.detail.innerHTML = `<pre>${escapeHtml(JSON.stringify(row.json, null, 2))}</pre>`;
    return;
  }

  if (state.tab === "tree") {
    els.detail.innerHTML = `<div class="section"><h3>Tree</h3>${renderTree(row.json)}</div>`;
    return;
  }

  els.detail.innerHTML = renderSummary(row);
}

function renderSummary(row) {
  const json = row.json || {};
  const prompt = Array.isArray(json.prompt) ? json.prompt : [];
  const promptHtml = prompt
    .map(
      (msg) => `
    <div class="card">
      <div class="role">${escapeHtml(msg.role || "message")}</div>
      <div class="text">${escapeHtml(msg.content || "")}</div>
    </div>
  `
    )
    .join("");
  const ideal = json.ideal_completions_data?.ideal_completion || "";
  const rubrics = Array.isArray(json.rubrics) ? json.rubrics : [];

  return `
    <div class="section">
      <h3>Prompt</h3>
      ${promptHtml || '<div class="empty">No prompt field found.</div>'}
    </div>
    <div class="section">
      <h3>Ideal completion</h3>
      <div class="card text">${escapeHtml(ideal || "No ideal completion field found.")}</div>
    </div>
    <div class="section">
      <h3>Rubrics</h3>
      ${renderRubrics(rubrics)}
    </div>
  `;
}

function renderRubrics(rubrics) {
  if (!rubrics.length) return '<div class="empty">No rubrics.</div>';
  return `
    <table>
      <thead><tr><th>Points</th><th>Criterion</th><th>Tags</th></tr></thead>
      <tbody>
        ${rubrics
          .map(
            (rubric) => `
          <tr>
            <td>${escapeHtml(rubric.points ?? "")}</td>
            <td>${escapeHtml(rubric.criterion || "")}</td>
            <td>${escapeHtml((rubric.tags || []).join(", "))}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderTree(value, key = "root", depth = 0) {
  if (value === null || typeof value !== "object") {
    return `<div><span class="key">${escapeHtml(key)}</span>: <span class="value">${escapeHtml(JSON.stringify(value))}</span></div>`;
  }

  const isArray = Array.isArray(value);
  const entries = Object.entries(value);
  const label = `${key} ${isArray ? `[${value.length}]` : `{${entries.length}}`}`;
  const open = depth < 2 ? " open" : "";
  return `
    <details${open}>
      <summary><span class="key">${escapeHtml(label)}</span> <span class="type">${isArray ? "array" : "object"}</span></summary>
      ${entries.map(([childKey, childValue]) => renderTree(childValue, childKey, depth + 1)).join("")}
    </details>
  `;
}

async function runSearch() {
  if (!state.rowCount) {
    els.status.textContent = "Open a JSONL file before searching.";
    els.detail.innerHTML = '<div class="empty">Open a file to search rows.</div>';
    return;
  }

  const query = els.searchInput.value.trim();
  state.searchResults = null;
  state.rows.clear();
  if (!query) {
    els.status.textContent = `Showing all ${formatNumber(state.rowCount)} rows.`;
    scheduleRenderRows();
    return;
  }

  els.searchButton.disabled = true;
  els.cancelSearch.hidden = false;
  els.status.textContent = "Streaming search through file";
  try {
    const result = await callWorker("search", { query, limit: 5000 });
    state.searchResults = result.matches;
    els.status.textContent = `Found ${formatNumber(result.matches.length)} matches for "${query}"${result.truncated ? " (limited)" : ""}.`;
    els.list.scrollTop = 0;
    scheduleRenderRows();
    if (result.matches.length) {
      await selectLine(result.matches[0], false);
    } else {
      state.selected = -1;
      els.lineLabel.textContent = "No match selected";
      els.rowTitle.textContent = "No matches";
      els.detail.innerHTML = `<div class="empty">No rows matched "${escapeHtml(query)}".</div>`;
    }
  } catch (error) {
    els.status.textContent = error.message;
  } finally {
    els.searchButton.disabled = false;
    els.cancelSearch.hidden = true;
  }
}

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    await openFile(file);
  } catch (error) {
    els.status.textContent = error.message;
    els.detail.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
});

els.loadSample.addEventListener("click", async () => {
  try {
    await loadSample();
  } catch (error) {
    els.status.textContent = error.message;
    els.detail.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
});

els.list.addEventListener("scroll", scheduleRenderRows);
els.rows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-line]");
  if (button) selectLine(Number(button.dataset.line));
});

els.tabs.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  state.tab = button.dataset.tab;
  for (const tab of els.tabs.querySelectorAll("button")) {
    tab.classList.toggle("active", tab === button);
  }
  let row = state.rows.get(state.selected);
  if (row && !row.raw) {
    try {
      const fetched = await callWorker("row-detail", { line: state.selected });
      row = fetched.row;
      state.rows.set(state.selected, { ...(state.rows.get(state.selected) || {}), ...row });
    } catch (error) {
      els.detail.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
      return;
    }
  }
  if (row) renderDetail(row);
});

els.jumpInput.addEventListener("change", () => {
  const line = Math.max(1, Number(els.jumpInput.value || 1)) - 1;
  selectLine(line, true);
});

els.searchButton.addEventListener("click", runSearch);
els.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});
els.cancelSearch.addEventListener("click", () => {
  if (worker) worker.postMessage({ type: "cancel-search" });
});

if (worker) {
  loadSample().catch(() => {
    els.status.textContent = "Open a JSONL file or load the local sample.";
  });
}
