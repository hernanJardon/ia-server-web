"use strict";

/* ================================================================ utilidades */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** replaceChildren que ignora null y false (el nativo los convierte en texto). */
function fill(el, ...kids) { el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false)); }

const GB = 1e9, GIB = 1024 ** 3;
const fmtGB = (n) => n == null ? "?" : (n / GB >= 100 ? (n / GB).toFixed(0) : (n / GB).toFixed(1)) + " GB";
const fmtGiB = (n) => n == null ? "?" : (n / GIB).toFixed(1);
function fmtSize(n) {
  if (n == null) return "?";
  if (n < 1e3) return n + " B";
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + " kB";
  if (n < 1e9) return (n / 1e6).toFixed(1) + " MB";
  return fmtGB(n);
}
function fmtCtx(n) {
  if (!n) return "";
  if (n < 1000) return String(n);
  // 32768 → 32K (potencias de 2), 128000 → 128K (redondos en miles)
  return (n % 1024 === 0 ? n / 1024 : Math.round(n / 1000)) + "K";
}
const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
function fmtRelative(date) {
  const s = (new Date(date).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return rtf.format(Math.round(s), "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}
function fmtDuration(sec) {
  if (sec < 60) return Math.max(1, Math.round(sec)) + " s";
  if (sec < 3600) return Math.round(sec / 60) + " min";
  return Math.floor(sec / 3600) + " h " + Math.round((sec % 3600) / 60) + " min";
}
const fmtDate = (d) => new Date(d).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });

function parseParams(str) {
  const m = /^([\d.]+)\s*([KMBT])?/i.exec(str || "");
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] || "").toUpperCase()] || 1;
  return parseFloat(m[1]) * mult;
}

function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }

/* ================================================================ red */

async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers: {} };
  if (opts.body !== undefined) {
    if (opts.raw) init.body = opts.body;
    else { init.body = JSON.stringify(opts.body); init.headers["Content-Type"] = "application/json"; }
  }
  if (opts.signal) init.signal = opts.signal;
  let res;
  try { res = await fetch(path, init); }
  catch (e) { if (e.name === "AbortError") throw e; throw new Error("El panel no responde. ¿Sigue en marcha el servicio?"); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { /* respuesta no JSON */ }
  if (!res.ok) throw new Error((data && data.error) || text.slice(0, 300) || "Error " + res.status);
  return data;
}

/** POST con respuesta NDJSON: llama a onLine por cada objeto; lanza si alguno trae "error". */
async function stream(path, body, onLine, signal) {
  let res;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) { if (e.name === "AbortError") throw e; throw new Error("El panel no responde."); }
  if (!res.ok && !(res.headers.get("Content-Type") || "").includes("ndjson")) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch (e) { /* texto plano */ }
    throw new Error(msg.slice(0, 400) || "Error " + res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const feed = (line) => {
    if (!line.trim()) return;
    const obj = JSON.parse(line);
    if (obj.error) throw new Error(obj.error);
    onLine(obj);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { feed(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  feed(buf);
}

/* ================================================================ avisos */

function notify(message, kind = "info") {
  const box = $("#notice");
  box.replaceChildren(h("p", { class: kind === "error" ? "error" : "", role: kind === "error" ? "alert" : "status" },
    h("span", {}, message), h("button", { type: "button", class: "quiet", onclick: () => box.replaceChildren() }, "Cerrar")));
  if (kind !== "error") setTimeout(() => { if (box.textContent.includes(message)) box.replaceChildren(); }, 6000);
}

function confirmAction(title, text, okLabel) {
  const dlg = $("#confirm");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-ok").textContent = okLabel;
  dlg.returnValue = "";
  dlg.showModal();
  $("button[value=cancel]", dlg).focus(); // en una acción destructiva, Enter no debe confirmar por accidente
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}

/* ================================================================ operaciones largas */

const ops = [];
let opSeq = 0;
let opsRenderQueued = false;

function renderOps() {
  if (opsRenderQueued) return;
  opsRenderQueued = true;
  requestAnimationFrame(() => {
    opsRenderQueued = false;
    $("#ops").hidden = ops.length === 0;
    $("#ops-list").replaceChildren(...ops.map((op) => {
      const pct = op.total ? Math.min(100, (op.completed / op.total) * 100) : null;
      const running = op.state === "running";
      return h("div", { class: "op " + op.state },
        h("div", { class: "title" }, op.title),
        running ? h("div", { class: "meter" + (pct == null ? " busy" : ""), role: "progressbar", "aria-label": op.title,
          "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": pct == null ? null : pct.toFixed(0) },
          h("i", { style: pct == null ? null : "width:" + pct.toFixed(1) + "%" })) : null,
        h("div", { class: "status" }, op.status + (running && op.total ? " · " + fmtSize(op.completed) + " de " + fmtSize(op.total) + " (" + pct.toFixed(0) + " %)" : "")),
        running
          ? (op.cancel ? h("button", { type: "button", onclick: () => op.cancel() }, "Cancelar") : null)
          : h("button", { type: "button", class: "quiet", onclick: () => { ops.splice(ops.indexOf(op), 1); renderOps(); } }, "Quitar"));
    }));
  });
}

/** Ejecuta fn(op, signal) mostrando su progreso. fn actualiza op.status, op.completed y op.total. */
async function runOp(title, fn, { cancellable = true } = {}) {
  const ctrl = new AbortController();
  const op = { id: ++opSeq, title, status: "Empezando…", state: "running", completed: 0, total: 0 };
  if (cancellable) op.cancel = () => { op.cancelled = true; ctrl.abort(); };
  ops.unshift(op);
  renderOps();
  const update = (patch) => { Object.assign(op, patch); renderOps(); };
  try {
    const result = await fn(update, ctrl.signal);
    update({ state: "done", status: (result && result.message) || "Terminado." });
    return true;
  } catch (e) {
    if (op.cancelled) update({ state: "failed", status: "Cancelado." });
    else update({ state: "failed", status: e.message });
    return false;
  } finally {
    refreshModels();
  }
}

const STATUS_ES = [
  [/^pulling manifest/, "Leyendo el manifiesto"],
  [/^pulling ([0-9a-f]{6,})/, (m) => "Descargando capa " + m[1].slice(0, 12)],
  [/^verifying sha256 digest/, "Verificando la integridad"],
  [/^writing manifest/, "Escribiendo el manifiesto"],
  [/^removing any unused layers/, "Limpiando capas sin uso"],
  [/^using existing layer/, "Reutilizando capas existentes"],
  [/^creating new layer/, "Creando capa"],
  [/^parsing GGUF/, "Leyendo el GGUF"],
  [/^quantizing (\S+) model to (\S+)/, (m) => "Cuantizando de " + m[1] + " a " + m[2]],
  [/^success/, "Hecho"],
];
function statusEs(s) {
  for (const [re, out] of STATUS_ES) {
    const m = re.exec(s || "");
    if (m) return typeof out === "function" ? out(m) : out;
  }
  return s || "";
}

/** Sigue un stream de /api/pull o /api/create sumando el progreso de todas las capas. */
function progressTracker(update) {
  const layers = new Map();
  return (msg) => {
    if (msg.digest && msg.total) layers.set(msg.digest, { total: msg.total, completed: msg.completed || 0 });
    let total = 0, completed = 0;
    for (const l of layers.values()) { total += l.total; completed += l.completed; }
    if (!msg.digest && msg.total) { total = msg.total; completed = msg.completed || 0; }
    update({ status: statusEs(msg.status), total, completed: msg.status === "success" ? total : completed });
  };
}

/* ================================================================ estado del servidor */

const state = {
  tags: null, tagsError: null, ps: null, sys: null,
  show: new Map(), blobs: new Map(),
  open: null, sortKey: "name", sortDir: 1, filter: "",
  version: null, engines: [], engineEnv: null,
};
const runningEngines = () => (state.engines || []).filter((e) => e.status === "loading" || e.status === "ready");
let engineDraft = null; // modelo preseleccionado al llegar a Motores desde una ficha

async function getShow(model) {
  if (!state.show.has(model)) {
    const data = await api("/ollama/show", { body: { model } });
    state.show.set(model, data);
    const m = /^FROM\s+\S*sha256[-:]([0-9a-f]{64})/m.exec(data.modelfile || "");
    if (m) state.blobs.set("sha256:" + m[1], model);
  }
  return state.show.get(model);
}

async function refreshModels() {
  try {
    const data = await api("/ollama/tags");
    state.tags = data.models || [];
    state.tagsError = null;
  } catch (e) { state.tagsError = e.message; }
  state.show.clear();
  // La arquitectura de cada modelo (para la caché KV del veredicto) sale de /api/show.
  if (state.tags) await Promise.allSettled(state.tags.map((m) => getShow(m.name)));
  await refreshStatus();
  fillModelSelects();
  $("#nav-count-models").textContent = state.tags ? state.tags.length : "";
}

async function refreshStatus() {
  const [ps, sys, ver, eng] = await Promise.allSettled([api("/ollama/ps"), api("/panel/system"),
    state.version ? null : api("/ollama/version"), api("/panel/engines")]);
  state.ps = ps.status === "fulfilled" ? ps.value.models || [] : null;
  state.sys = sys.status === "fulfilled" ? sys.value : null;
  if (eng.status === "fulfilled") state.engines = eng.value.instances;
  const live = runningEngines().length;
  $("#nav-count-engines").textContent = live ? String(live) : "";
  if (ver.status === "fulfilled" && ver.value) state.version = ver.value.version;
  if (state.ps) await Promise.allSettled(state.ps.map((m) => getShow(m.name)));
  renderServerLine(ps.status === "rejected" ? ps.reason.message : null);
  if (currentView() === "modelos") renderModelsView();
}

function renderServerLine(err) {
  const line = $("#server-line");
  if (err) {
    line.replaceChildren(h("span", { class: "down" }, "Ollama no responde"), h("br"), h("span", {}, err));
    state.version = null;
    return;
  }
  const url = state.sys ? state.sys.ollama_url.replace(/^https?:\/\//, "") : "";
  line.replaceChildren(h("strong", {}, "Ollama " + (state.version || "")), h("br"), url);
}

/* ================================================================ cabida en VRAM */

/** GPUs con su capacidad aprovechable. Sin datos de nvidia-smi devuelve []. */
function gpuCaps() {
  return state.sys && state.sys.gpus ? state.sys.gpus.map((g) => ({ ...g, usable: g.mem_total - 0.6 * GIB })) : [];
}

/**
 * Bytes de caché KV en f16 para ctx tokens, a partir de la arquitectura de /api/show:
 * capas x cabezas KV x (dim clave + dim valor) x ctx x 2 bytes. Las arquitecturas híbridas
 * declaran cabezas KV por capa (0 en las capas sin atención), por eso se suma la lista.
 * Devuelve null si el modelo no publica esos datos.
 */
function kvBytes(show, ctx) {
  const info = (show && show.model_info) || {};
  const arch = info["general.architecture"];
  if (!arch) return null;
  const g = (k) => info[arch + "." + k];
  const blocks = g("block_count");
  const heads = g("attention.head_count");
  const kvHeads = g("attention.head_count_kv") ?? heads;
  const emb = g("embedding_length");
  if (!blocks || kvHeads == null) return null;
  const headsN = Array.isArray(heads) ? Math.max(...heads) : heads;
  const kDim = g("attention.key_length") || (emb && headsN ? emb / headsN : null);
  const vDim = g("attention.value_length") || kDim;
  if (!kDim) return null;
  // Híbridos atención + SSM (p. ej. qwen35): solo una de cada full_attention_interval capas guarda caché KV.
  const interval = g("full_attention_interval");
  const attnLayers = interval ? Math.ceil(blocks / interval) : blocks;
  const kvSum = Array.isArray(kvHeads) ? kvHeads.reduce((a, b) => a + b, 0) : attnLayers * kvHeads;
  return kvSum * (kDim + vDim) * ctx * 2;
}

/** Estado recurrente por secuencia de las capas SSM de un híbrido (f32), o 0. */
function ssmBytes(show) {
  const info = (show && show.model_info) || {};
  const arch = info["general.architecture"];
  const g = (k) => info[arch + "." + k];
  const inner = g("ssm.inner_size"), st = g("ssm.state_size"), conv = g("ssm.conv_kernel") || 0;
  if (!arch || !inner || !st) return 0;
  const blocks = g("block_count") || 0;
  const interval = g("full_attention_interval");
  const ssmLayers = interval ? blocks - Math.ceil(blocks / interval) : blocks;
  return ssmLayers * inner * (st + conv) * 4;
}

const isHybrid = (show) => ssmBytes(show) > 0;
const KV_TYPE_FACTOR = { f16: 1, q8_0: 0.5, q4_0: 0.25 };

/**
 * Peticiones en paralelo que atiende Ollama, porque cada una tiene su caché KV:
 * OLLAMA_NUM_PARALLEL del servicio si el panel puede leerlo; si no, lo que se deduce de un modelo denso
 * ya cargado (VRAM medida frente a la teórica); si no, 1.
 */
function serverParallel() {
  const env = state.sys && state.sys.ollama_env;
  const n = env && parseInt(env.OLLAMA_NUM_PARALLEL, 10);
  if (n > 0) return { n, source: "OLLAMA_NUM_PARALLEL" };
  const ratios = [];
  for (const p of state.ps || []) {
    const t = (state.tags || []).find((x) => x.name === p.name);
    const show = state.show.get(p.name);
    const kv = t && p.context_length && !isHybrid(show) && kvBytes(show, p.context_length);
    if (kv && p.size_vram > t.size) ratios.push((p.size_vram - t.size - 0.4 * GIB) / kv);
  }
  if (ratios.length) {
    ratios.sort((a, b) => a - b);
    return { n: Math.min(8, Math.max(1, Math.round(ratios[Math.floor(ratios.length / 2)]))), source: "deducido de los modelos cargados" };
  }
  return { n: 1, source: null };
}

function serverKvType() {
  const env = state.sys && state.sys.ollama_env;
  const t = env && (env.OLLAMA_KV_CACHE_TYPE || "").toLowerCase();
  return KV_TYPE_FACTOR[t] ? t : "f16";
}

/** Contexto que usaría Ollama al cargar el modelo sin indicarlo. */
function serverDefaultCtx() {
  const env = state.sys && state.sys.ollama_env;
  const fromEnv = env && parseInt(env.OLLAMA_CONTEXT_LENGTH, 10);
  if (fromEnv > 0) return { ctx: fromEnv, source: "OLLAMA_CONTEXT_LENGTH" };
  const seen = (state.ps || []).map((m) => m.context_length).filter(Boolean);
  return seen.length ? { ctx: Math.max(...seen), source: "el de los modelos cargados" } : { ctx: 4096, source: "por defecto de Ollama" };
}

/**
 * El único estimador de VRAM del panel (Modelos y Motores):
 * pesos + caché KV × peticiones en paralelo × tipo de caché + estado SSM × peticiones + 0,4 GiB de búferes.
 * Devuelve { total, kv, kvKnown }.
 */
function estimateVram(m, ctx, parallel, kvType) {
  const show = state.show.get(m.name);
  const kvOne = kvBytes(show, ctx);
  const kv = kvOne == null ? null : kvOne * parallel * (KV_TYPE_FACTOR[kvType] || 1);
  const ssm = ssmBytes(show) * parallel;
  return { total: m.size + (kv || 0) + ssm + 0.4 * GIB, kv, kvKnown: kvOne != null };
}

/**
 * Estimación de VRAM para un modelo instalado: pesos + caché KV del contexto + 0,4 GiB de búferes de cálculo,
 * repartida entre GPU con 0,6 GiB fijos por tarjeta. Si el modelo ya está cargado se usa lo que mide Ollama.
 * m puede llevar un size distinto (estimación de una cuantización). ctx opcional.
 */
function fitFor(m, ctxOverride) {
  const gpus = gpuCaps();
  if (!gpus.length || !m || !m.size) return null;
  const loaded = !ctxOverride && !m.estimate ? loadedEntry(m.name) : null;
  const maxCtx = m.details && m.details.context_length;
  const def = serverDefaultCtx();
  let ctx = ctxOverride || (loaded && loaded.context_length) || def.ctx;
  if (maxCtx && ctx > maxCtx) ctx = maxCtx;
  const par = serverParallel();
  const kvType = serverKvType();
  const est = estimateVram(m, ctx, par.n, kvType);
  const need = loaded ? loaded.size_vram : est.total;
  const usable = Math.min(...gpus.map((g) => g.usable));
  const n = Math.max(1, Math.ceil(need / usable));
  return { need, n, total: gpus.length, fits: n <= gpus.length, ctx, measured: !!loaded, kvKnown: est.kvKnown,
    parallel: par, kvType, ctxSource: ctxOverride ? "elegido" : loaded ? "cargado" : def.source };
}

function fitText(f) {
  return !f.fits ? "No cabe, usará RAM" : f.n === 1 ? "Cabe en 1 GPU" : "Repartido en " + f.n + " GPU";
}

function fitCell(m, ctx) {
  const f = fitFor(m, ctx);
  if (!f) return h("span", { class: "note" }, "Sin datos de GPU");
  const cls = !f.fits ? "bad" : f.n === 1 ? "ok" : "warn";
  const cells = Array.from({ length: f.total }, (_, i) => h("i", { class: i < f.n ? "on" : "" }));
  const how = f.measured ? "medido por Ollama" : "estimado con " + fmtCtx(f.ctx) + " de contexto" + (f.kvKnown ? "" : ", sin datos de la caché KV");
  return h("span", { class: "fit " + cls, title: fmtGiB(f.need) + " GiB de VRAM, " + how },
    h("span", { class: "cells", "aria-hidden": "true" }, cells), fitText(f));
}

/** "4.7 GB" → 4.7 con la unidad en pequeño. */
function qty(text) {
  const m = /^([\d.,~]+)\s*(.*)$/.exec(text || "");
  // Un solo elemento: en la tabla apilada de móvil la cifra y su unidad no deben separarse.
  return m ? h("span", { class: "qty" }, m[1], h("span", { class: "u" }, m[2])) : text;
}

/* ================================================================ vista: modelos */

function loadedEntry(name) { return (state.ps || []).find((m) => m.name === name || m.model === name); }

function gpusForModel(name) {
  const out = [];
  for (const g of (state.sys && state.sys.gpus) || []) {
    if (g.procs.some((p) => p.blob && state.blobs.get(p.blob) === name)) out.push("GPU " + g.index);
  }
  return out;
}

/** Quién ocupa una GPU: modelos de Ollama (por el GGUF del runner) e instancias de los motores del panel. */
function gpuOwners(g) {
  const owners = new Set();
  const claimed = new Set();
  for (const inst of runningEngines()) {
    const onThis = inst.gpus.length ? inst.gpus.includes(Number(g.index)) : g.procs.some((p) => Number(p.pid) === inst.pid);
    if (onThis) owners.add(inst.alias + " · " + inst.engine);
    claimed.add(inst.pid);
  }
  let otherMem = 0;
  for (const p of g.procs) {
    const model = p.blob && state.blobs.get(p.blob);
    if (model) owners.add(model);
    else if (!claimed.has(Number(p.pid)) && p.mem > 0) otherMem += p.mem;
  }
  return { names: [...owners], otherMem };
}

function renderGpus() {
  const box = $("#gpus");
  const sys = state.sys;
  if (!sys) { box.replaceChildren(h("p", { class: "error-text" }, "No se pudo leer el estado del servidor.")); return; }
  if (!sys.gpus.length) {
    box.replaceChildren(h("p", { class: "empty" }, "No se encontró nvidia-smi en la máquina del panel. Instala el panel en el servidor de Ollama para ver la memoria de cada GPU."));
  } else {
    box.replaceChildren(h("div", { class: "gpus" }, sys.gpus.map((g) => {
      const pct = g.mem_total ? (g.mem_used / g.mem_total) * 100 : 0;
      const own = gpuOwners(g);
      const ownerText = own.names.length ? own.names.join(", ")
        : g.mem_used > 0.3 * GIB ? "Sin modelos del panel" : "Libre";
      return h("div", { class: "gpu" },
        h("div", { class: "name" }, h("span", {}, "GPU " + g.index), h("span", {}, g.temp != null ? g.temp.toFixed(0) + " °C" : "")),
        h("div", { class: "figure" }, fmtGiB(g.mem_used), h("small", {}, "/ " + fmtGiB(g.mem_total) + " GiB")),
        h("div", { class: "meter" + (pct > 90 ? " high" : ""), role: "meter", "aria-label": "Memoria GPU " + g.index,
          "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": pct.toFixed(0) }, h("i", { style: "width:" + pct.toFixed(1) + "%" })),
        h("div", { class: "owner" + (own.names.length ? "" : " idle") }, ownerText),
        h("div", { class: "note", style: "margin:0" }, (own.otherMem ? "Otros procesos " + fmtGiB(own.otherMem) + " GiB · " : "") +
          (g.util != null ? "uso " + g.util.toFixed(0) + " % · " : "") + g.name));
    })));
  }
  const kv = [];
  if (sys.mem_total) kv.push(["RAM libre", fmtGiB(sys.mem_available) + " de " + fmtGiB(sys.mem_total) + " GiB"]);
  if (sys.disk) kv.push(["Disco libre (modelos)", fmtGB(sys.disk.free) + " de " + fmtGB(sys.disk.total)]);
  if (sys.load) kv.push(["Carga CPU (1, 5, 15 min)", sys.load.map((x) => x.toFixed(2)).join("  ") + " / " + sys.cpu_count + " núcleos"]);
  $("#host").replaceChildren(...kv.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v))));
}

function renderLoaded() {
  const box = $("#loaded");
  $("#unload-all").hidden = !(state.ps && state.ps.length > 1);
  if (state.ps == null) { box.replaceChildren(h("p", { class: "error-text" }, "No se pudo consultar qué modelos están en memoria.")); return; }
  if (!state.ps.length) {
    box.replaceChildren(h("p", { class: "empty" }, "Ningún modelo de Ollama en memoria. Pulsa Cargar en un modelo instalado, o abre su ficha para elegir el contexto y cuánto tiempo se queda."));
    return;
  }
  box.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "stack" },
    h("thead", {}, h("tr", {}, h("th", {}, "Modelo"), h("th", { class: "num" }, "En VRAM"), h("th", {}, "Dónde"),
      h("th", { class: "num" }, "Contexto"), h("th", {}, "Se descarga"), h("th", {}, h("span", { class: "visually-hidden" }, "Acciones")))),
    h("tbody", {}, state.ps.map((m) => {
      const gpuPart = m.size ? Math.round((m.size_vram / m.size) * 100) : 0;
      const where = gpusForModel(m.name);
      const forever = new Date(m.expires_at).getFullYear() > 2200;
      return h("tr", {},
        h("td", { class: "model", "data-label": "Modelo" }, m.name),
        h("td", { class: "num", "data-label": "En VRAM" }, h("span", {}, qty(fmtGB(m.size_vram)),
          gpuPart < 100 ? h("span", { class: "u" }, " " + gpuPart + " % en GPU, resto en RAM") : null)),
        h("td", { "data-label": "Dónde" }, where.length ? where.join(", ") : gpuPart === 0 ? "CPU" : "GPU"),
        h("td", { class: "num", "data-label": "Contexto" }, fmtCtx(m.context_length) || "?"),
        h("td", { "data-label": "Se descarga" }, forever ? "Nunca (fijado)" : fmtRelative(m.expires_at)),
        h("td", { class: "row-actions" }, h("button", { type: "button", onclick: () => unloadModel(m.name) }, "Descargar de memoria")));
    })))));
}

function sortedModels() {
  const f = state.filter.trim().toLowerCase();
  const list = (state.tags || []).filter((m) => !f || m.name.toLowerCase().includes(f));
  const key = {
    name: (m) => m.name, size: (m) => m.size, params: (m) => parseParams(m.details.parameter_size) || 0,
    ctx: (m) => m.details.context_length || 0, modified: (m) => m.modified_at,
  }[state.sortKey];
  return list.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * state.sortDir);
}

function sortHeader(label, key, numeric) {
  const active = state.sortKey === key;
  return h("th", { class: numeric ? "num" : "", "aria-sort": active ? (state.sortDir > 0 ? "ascending" : "descending") : null },
    h("button", { type: "button", onclick: () => {
      state.sortDir = active ? -state.sortDir : (numeric ? -1 : 1);
      state.sortKey = key;
      renderInstalled();
    } }, label));
}

function renderInstalled() {
  const box = $("#installed");
  if (state.tagsError) {
    box.replaceChildren(h("p", { class: "error-text" }, "No se pudo leer la lista de modelos: " + state.tagsError),
      h("button", { type: "button", onclick: refreshModels }, "Reintentar"));
    return;
  }
  if (!state.tags) return;
  if (!state.tags.length) {
    box.replaceChildren(h("p", { class: "empty" }, "No hay modelos instalados. ", h("a", { href: "#descargar" }, "Descarga uno"), " o ", h("a", { href: "#subir" }, "sube un GGUF"), "."));
    return;
  }
  const models = sortedModels();
  const rows = [];
  for (const m of models) {
    const d = m.details || {};
    const loaded = loadedEntry(m.name);
    const open = state.open === m.name;
    const caps = m.capabilities || [];
    const isEmbed = caps.includes("embedding") && !caps.includes("completion");
    rows.push(h("tr", { class: open ? "open" : "" },
      h("td", { class: "model", "data-label": "Modelo" }, h("div", { class: "model-cell" }, h("span", {}, m.name),
        loaded ? h("span", { class: "note ok" }, "En memoria") : null)),
      h("td", { class: "num", "data-label": "Parámetros" }, qty((d.parameter_size || "").replace(/([\d.])([KMBT])$/i, "$1 $2"))),
      h("td", { "data-label": "Cuantización" }, d.quantization_level || ""),
      h("td", { class: "num", "data-label": "Tamaño" }, qty(fmtGB(m.size))),
      h("td", { class: "num", "data-label": "Contexto" }, qty(fmtCtx(d.context_length).replace(/K$/, " K"))),
      h("td", { "data-label": "Capacidades" }, caps.join(", ")),
      h("td", { "data-label": "Veredicto" }, fitCell(m)),
      h("td", { class: "row-actions" },
        loaded
          ? h("button", { type: "button", onclick: () => unloadModel(m.name) }, "Descargar")
          : h("button", { type: "button", onclick: () => loadModel(m.name, "5m", "", isEmbed) }, "Cargar"),
        h("button", { type: "button", class: open ? "primary" : "quiet", "aria-expanded": String(open),
          onclick: () => { state.open = open ? null : m.name; renderInstalled(); } }, open ? "Cerrar ficha" : "Ficha"),
        h("button", { type: "button", class: "danger", onclick: () => deleteModel(m.name) }, "Borrar"))));
    if (open) rows.push(h("tr", { class: "detail" }, h("td", { colspan: "8" }, ficha(m))));
  }
  fill(box,
    models.length ? null : h("p", { class: "empty" }, "Ningún modelo coincide con «" + state.filter + "»."),
    h("div", { class: "table-wrap" }, h("table", { class: "stack" },
      h("thead", {}, h("tr", {}, sortHeader("Modelo", "name"), sortHeader("Parámetros", "params", true), h("th", {}, "Cuantización"),
        sortHeader("Tamaño", "size", true), sortHeader("Contexto", "ctx", true), h("th", {}, "Capacidades"), h("th", {}, "Veredicto"),
        h("th", {}, h("span", { class: "visually-hidden" }, "Acciones")))),
      h("tbody", {}, rows))),
    h("p", { class: "note" }, models.length + " de " + state.tags.length + " modelos · " + fmtGB(state.tags.reduce((s, m) => s + m.size, 0)) + " en disco"));
}

/** Ficha técnica desplegada de un modelo: datos de /api/show y formulario de carga. */
function ficha(m) {
  const box = h("div", { class: "ficha" }, h("div", { class: "skeleton w60" }), h("div", { class: "skeleton w40" }));
  getShow(m.name).then((s) => {
    const info = s.model_info || {};
    const arch = info["general.architecture"];
    const pick = (suffix) => arch ? info[arch + "." + suffix] : undefined;
    const d = s.details || {};
    const maxCtx = pick("context_length") || m.details.context_length;
    const rows = [
      ["Familia", (d.families || [d.family]).filter(Boolean).join(", ")],
      ["Arquitectura", arch],
      ["Formato", d.format],
      ["Modelo padre", d.parent_model || "Ninguno"],
      ["Parámetros", d.parameter_size],
      ["Cuantización", d.quantization_level],
      ["Contexto máximo", maxCtx ? maxCtx.toLocaleString("es") + " tokens" : null],
      ["Capas", pick("block_count")],
      ["Dimensión de embedding", pick("embedding_length")],
      ["Capacidades", (s.capabilities || []).join(", ")],
      ["Modificado", fmtDate(m.modified_at)],
      ["Digest", m.digest.slice(0, 12)],
    ].filter(([, v]) => v != null && v !== "");
    const loaded = loadedEntry(m.name);
    const isEmbed = (s.capabilities || []).includes("embedding") && !(s.capabilities || []).includes("completion");
    const ctxOptions = [2048, 4096, 8192, 16384, 32768, 65536, 131072].filter((n) => !maxCtx || n <= maxCtx);
    const freeNow = gpuCaps().reduce((sum, g) => sum + Math.max(0, g.mem_total - g.mem_used), 0);
    const fitNote = h("p", { class: "note" });
    const fitBox = h("div", {});
    const updateFit = () => {
      const ctx = Number(ctxSel.value) || null;
      const f = fitFor(m, ctx);
      if (!f) { fitNote.textContent = "Sin datos de GPU para estimar la ocupación."; fitBox.replaceChildren(); return; }
      fill(fitBox, fitCell(m, ctx));
      fitNote.textContent = (f.measured
        ? "Ocupa " + fmtGiB(f.need) + " GiB ahora mismo con " + fmtCtx(f.ctx) + " de contexto (medido por Ollama)."
        : "Necesita unos " + fmtGiB(f.need) + " GiB con " + f.ctx.toLocaleString("es") + " tokens de contexto (" + f.ctxSource + ")" +
          (!f.kvKnown ? "; el modelo no publica su arquitectura y la caché KV no está incluida."
            : ", caché KV " + f.kvType + " incluida para " + f.parallel.n + (f.parallel.n === 1 ? " petición" : " peticiones en paralelo") +
              (f.parallel.source ? " (" + f.parallel.source + ")." : "; si Ollama atiende varias a la vez, ocupará más."))) +
        (f.fits ? "" : " No cabe en VRAM: Ollama pondrá capas en RAM y irá mucho más lento.") +
        " Libre ahora: " + fmtGiB(freeNow) + " GiB. Si no hay sitio, Ollama descarga otros modelos.";
    };
    const keep = h("fieldset", { class: "seg" }, h("legend", {}, "Mantener cargado"),
      [["5m", "5 min"], ["30m", "30 min"], ["1h", "1 h"], ["-1", "Siempre"]].map(([v, label], i) =>
        h("label", {}, h("input", { type: "radio", name: "keep-" + m.digest, value: v, checked: i === 0 }), h("span", {}, label))));
    const ctxSel = h("select", { onchange: () => updateFit() }, h("option", { value: "" }, "El del servidor"), ctxOptions.map((n) => h("option", { value: n }, n.toLocaleString("es") + " tokens")));
    const copyName = h("input", { placeholder: m.name.split(":")[0] + ":copia", autocomplete: "off", spellcheck: "false" });
    box.replaceChildren(
      h("div", { class: "ficha-grid" },
        h("div", {},
          h("dl", { class: "spec" }, rows.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, String(v))))),
          s.system ? h("details", {}, h("summary", {}, "Prompt de sistema"), h("pre", {}, s.system)) : null,
          s.parameters ? h("details", {}, h("summary", {}, "Parámetros por defecto"), h("pre", {}, s.parameters)) : null,
          s.template ? h("details", {}, h("summary", {}, "Plantilla"), h("pre", {}, s.template)) : null,
          s.license ? h("details", {}, h("summary", {}, "Licencia"), h("pre", {}, s.license)) : null),
        h("div", { class: "load-panel" },
          h("h4", {}, loaded ? "Recargar en memoria" : "Cargar en memoria"),
          keep,
          isEmbed ? null : h("label", {}, "Contexto (num_ctx)", ctxSel),
          fitBox,
          fitNote,
          h("div", { class: "actions" },
            h("button", { type: "button", class: "primary", onclick: () => loadModel(m.name, $("input:checked", keep).value, isEmbed ? "" : ctxSel.value, isEmbed) }, "Cargar en memoria"),
            loaded ? h("button", { type: "button", onclick: () => unloadModel(m.name) }, "Descargar de memoria") : null,
            isEmbed ? null : h("button", { type: "button", class: "quiet", onclick: () => openChat(m.name) }, "Probar en chat")),
          isEmbed ? null : h("p", { class: "note" }, "¿Quieres elegir en qué GPU va? ",
            h("a", { href: "#motores", onclick: () => { engineDraft = m.name; } }, "Sírvelo con llama.cpp"), "."),
          h("h4", {}, "Copiar con otro nombre"),
          h("div", { class: "actions", style: "margin-top:0" }, copyName,
            h("button", { type: "button", onclick: () => copyModel(m.name, copyName.value.trim()) }, "Copiar")))));
    updateFit();
  }).catch((e) => box.replaceChildren(h("p", { class: "error-text" }, "No se pudo leer la ficha: " + e.message)));
  return box;
}

function renderModelsView() {
  renderGpus();
  renderLoaded();
  renderInstalled();
}

/* ---------------------------------------------------------------- acciones sobre modelos */

async function loadModel(name, keep, ctx, isEmbed) {
  const keep_alive = keep === "-1" ? -1 : keep;
  await runOp("Cargar " + name, async (update) => {
    update({ status: "Cargando pesos en la GPU…" });
    if (isEmbed) await api("/ollama/embed", { body: { model: name, input: ".", keep_alive } });
    else await api("/ollama/generate", { body: { model: name, keep_alive, stream: false, ...(ctx ? { options: { num_ctx: Number(ctx) } } : {}) } });
    return { message: "En memoria." };
  }, { cancellable: false });
}

async function unloadModel(name) {
  await runOp("Descargar " + name + " de memoria", async () => {
    try { await api("/ollama/generate", { body: { model: name, keep_alive: 0 } }); }
    catch (e) { await api("/ollama/embed", { body: { model: name, input: ".", keep_alive: 0 } }); }
    return { message: "Memoria liberada." };
  }, { cancellable: false });
}

async function unloadAll() {
  for (const m of state.ps || []) await unloadModel(m.name);
}

async function deleteModel(name) {
  const ok = await confirmAction("Borrar " + name, "Se elimina del disco. Las capas que compartan otros modelos se conservan. No se puede deshacer.", "Borrar modelo");
  if (!ok) return;
  if (state.open === name) state.open = null;
  await runOp("Borrar " + name, async () => {
    await api("/ollama/delete", { method: "DELETE", body: { model: name } });
    return { message: "Borrado." };
  }, { cancellable: false });
}

async function copyModel(source, destination) {
  if (!destination) { notify("Escribe el nombre de la copia.", "error"); return; }
  await runOp("Copiar " + source + " como " + destination, async () => {
    await api("/ollama/copy", { body: { source, destination } });
    return { message: "Copiado." };
  }, { cancellable: false });
}

/* ================================================================ selects de modelos */

function fillSelect(sel, models, keepValue) {
  const prev = keepValue ?? sel.value;
  sel.replaceChildren(...models.map((m) => h("option", { value: m.name }, m.name + "  ·  " + (m.details.parameter_size || "") + " " + (m.details.quantization_level || ""))));
  if (models.some((m) => m.name === prev)) sel.value = prev;
}

const UNQUANTIZED = /^(f16|bf16|f32|fp16|fp32)$/i;

function fillModelSelects() {
  const tags = state.tags || [];
  const chatable = tags.filter((m) => !m.capabilities || m.capabilities.includes("completion"));
  fillSelect($("#variant-form [name=from]"), tags);
  fillSelect($("#train-form [name=ollama_from]"), chatable);
  fillChatSelect();
  fillSelect($("#engine-form [name=ollama_model]"), chatable, engineDraft);
  if (currentView() === "motores") updateEngineFit();

  // Primero los que no están cuantizados: son el buen punto de partida.
  const quantSrc = tags.slice().sort((a, b) => UNQUANTIZED.test(b.details.quantization_level || "") - UNQUANTIZED.test(a.details.quantization_level || ""));
  fillSelect($("#quant-form [name=from]"), quantSrc);
  suggestQuantName();
}

/* ================================================================ vista: motores (llama.cpp y vLLM) */

const ENGINE_STATUS = { loading: ["Cargando", "warn"], ready: ["Lista", "ok"], stopped: ["Detenida", ""], failed: ["Falló", "bad"] };
const engineLogs = new Map();
const openEngineLogs = new Set();

function engineKind() { return $("#engine-form input[name=engine]:checked").value; }

async function renderEngineEnv() {
  if (!state.engineEnv) {
    try { state.engineEnv = await api("/panel/engines/env"); }
    catch (e) { fill($("#engine-env"), h("p", { class: "error-text" }, e.message)); return; }
  }
  updateEngineForm();
}

function updateEngineForm() {
  const kind = engineKind();
  const env = state.engineEnv && state.engineEnv[kind === "vllm" ? "vllm" : "llama_cpp"];
  for (const el of $$("#engine-form [data-engine]")) el.hidden = el.dataset.engine !== kind;
  const box = $("#engine-env");
  if (!env) { fill(box, h("div", { class: "skeleton w40" })); return; }
  $("#engine-fields").hidden = !env.available;
  if (!env.available) {
    fill(box, h("p", { class: "empty", style: "padding-top:0" }, env.reason));
  } else if (kind === "llama.cpp") {
    fill(box, env.warning ? h("p", { class: "warn" }, env.warning)
      : h("p", { class: "note" }, "llama-server ve " + env.devices.length + " dispositivo" + (env.devices.length === 1 ? "" : "s") + ": " + env.devices.join(" · ")));
  } else {
    fill(box, h("p", { class: "note" }, "vLLM " + env.version + ". El modelo se descarga de Hugging Face la primera vez (los modelos con acceso restringido necesitan HF_TOKEN en /etc/ollama-panel.env). Con GPU de 12 GB, usa versiones AWQ o GPTQ para modelos de más de 7B."));
  }
  renderGpuPicker();
  updateEngineFit();
}

function renderGpuPicker() {
  const box = $("#engine-gpus");
  const prev = new Set($$("input:checked", box).map((i) => i.value));
  const gpus = (state.sys && state.sys.gpus) || [];
  const firstTime = !box.dataset.ready;
  fill(box, h("legend", {}, engineKind() === "vllm" ? "GPU (1, 2 o 4: el modelo se divide entre ellas)" : "GPU (ninguna marcada = todas)"),
    gpus.length ? gpus.map((g) => {
      const free = g.mem_total - g.mem_used;
      const own = gpuOwners(g).names;
      return h("label", {}, h("input", { type: "checkbox", value: g.index, checked: prev.has(String(g.index)) || (firstTime && own.length === 0 && free > 4 * GIB),
        onchange: updateEngineFit }),
        h("span", {}, "GPU " + g.index, h("span", { class: "free" }, fmtGiB(free) + " GiB libres" + (own.length ? " · " + own.join(", ") : ""))));
    }) : h("p", { class: "note" }, "Sin datos de GPU."));
  box.dataset.ready = "1";
}

function selectedGpus() { return $$("#engine-gpus input:checked").map((i) => Number(i.value)); }

function updateEngineFit() {
  const out = $("#engine-fit");
  const kind = engineKind();
  const gpus = (state.sys && state.sys.gpus) || [];
  const sel = selectedGpus();
  const chosen = sel.length ? gpus.filter((g) => sel.includes(Number(g.index))) : gpus;
  const free = chosen.reduce((s, g) => s + Math.max(0, g.mem_total - g.mem_used), 0);
  const parts = [];
  if (kind === "llama.cpp") {
    const m = (state.tags || []).find((t) => t.name === $("#engine-form [name=ollama_model]").value);
    const ctx = Number($("#engine-form [name=ctx]").value) || 0;
    const par = Number($("#engine-form [name=parallel]").value) || 1;
    if (m) {
      // Mismo estimador que Modelos; aquí el paralelo y el tipo de caché son los de esta instancia.
      const extra = $("#engine-form [name=extra]").value;
      const kvType = (/--cache-type-k\s+(q8_0|q4_0)/.exec(extra) || [])[1] || "f16";
      const est = estimateVram(m, ctx, par, kvType);
      const need = est.total + 0.6 * GIB * Math.max(1, chosen.length);
      parts.push("Necesita unos " + fmtGiB(need) + " GiB (" + fmtGB(m.size) + " de pesos" + (est.kv != null ? " + " + fmtGiB(est.kv) + " GiB de caché KV " + kvType + " para " + par + " × " + ctx.toLocaleString("es") + " tokens" : "") + ").");
      if (need > free) parts.push("En las GPU elegidas hay " + fmtGiB(free) + " GiB libres: no cabe entero y llama.cpp dejará capas en CPU.");
      else parts.push("Libre en las GPU elegidas: " + fmtGiB(free) + " GiB.");
    }
  } else {
    if (![1, 2, 4, 8].includes(sel.length)) parts.push("Marca 1, 2 o 4 GPU.");
    else parts.push("vLLM reservará el " + Math.round(Number($("#engine-form [name=mem_util]").value) * 100) + " % de la memoria de cada GPU elegida, aunque el modelo ocupe menos. Elige GPU sin modelos de Ollama.");
  }
  out.textContent = parts.join(" ");
}

$("#engine-form").addEventListener("change", (e) => {
  if (e.target.name === "engine") { delete $("#engine-gpus").dataset.ready; updateEngineForm(); }
  else updateEngineFit();
});
$("#engine-form").addEventListener("input", (e) => { if (["ctx", "parallel", "mem_util", "extra"].includes(e.target.name)) updateEngineFit(); });

$("#engine-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const kind = engineKind();
  const body = {
    engine: kind, model: kind === "vllm" ? f.hf_model.value.trim() : f.ollama_model.value,
    alias: f.alias.value.trim(), gpus: selectedGpus(), ctx: Number(f.ctx.value), parallel: Number(f.parallel.value),
    ngl: Number(f.ngl.value), split: f.split.value, flash_attn: f.flash_attn.checked,
    gpu_memory_utilization: Number(f.mem_util.value), extra: f.extra.value.trim(),
  };
  if (!body.model) { notify(kind === "vllm" ? "Escribe el id del modelo de Hugging Face." : "Elige un modelo.", "error"); return; }
  const btn = $("#engine-submit");
  btn.disabled = true;
  try {
    const inst = await api("/panel/engines", { body });
    openEngineLogs.add(inst.id);
    await refreshStatus();
    renderEngines();
  } catch (err) { notify(err.message, "error"); }
  finally { btn.disabled = false; }
});

async function pollEngineLog(id, pre) {
  const entry = engineLogs.get(id) || { text: "", offset: 0 };
  try {
    const data = await api("/panel/engines/" + id + "/log?offset=" + entry.offset);
    entry.text = (entry.text + data.text).slice(-200000);
    entry.offset = data.offset;
    engineLogs.set(id, entry);
  } catch (e) { entry.text = entry.text || "No se pudo leer el registro: " + e.message; }
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
  pre.textContent = entry.text || "Sin salida todavía.";
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

function engineUrl(inst) {
  const host = location.hostname || "IP-DEL-SERVIDOR";
  return "http://" + host + ":" + inst.port + "/v1";
}

function renderEngines() {
  const box = $("#engines");
  const list = state.engines || [];
  if (!list.length) { fill(box, h("p", { class: "empty" }, "No hay instancias. Elige motor, modelo y GPU arriba y pulsa Iniciar instancia.")); return; }
  fill(box, list.map((inst) => {
    const [label, cls] = ENGINE_STATUS[inst.status] || [inst.status, ""];
    const live = inst.status === "loading" || inst.status === "ready";
    const open = openEngineLogs.has(inst.id);
    const pre = open ? h("pre", { class: "log", tabindex: "0" }, (engineLogs.get(inst.id) || {}).text || "Cargando…") : null;
    if (pre) pollEngineLog(inst.id, pre);
    return h("div", { class: "op" },
      h("div", { class: "title" }, inst.alias + " · " + inst.engine),
      h("div", { class: "status" }, h("span", { class: cls }, label),
        " · " + (inst.gpus.length ? "GPU " + inst.gpus.join(", ") : "todas las GPU") + " · " + inst.ctx.toLocaleString("es") + " tokens × " + inst.parallel +
        (inst.status === "failed" ? " · código " + inst.exit_code + ", mira el registro" : "")),
      live ? h("div", { class: "status" }, "API compatible con OpenAI: ", h("code", {}, engineUrl(inst)), " · modelo ", h("code", {}, inst.alias)) : null,
      h("div", { class: "actions", style: "margin-top:4px;grid-column:1" },
        inst.status === "ready" ? h("button", { type: "button", onclick: () => openChat("engine:" + inst.id) }, "Probar en chat") : null,
        h("button", { type: "button", "aria-expanded": String(open), onclick: () => { open ? openEngineLogs.delete(inst.id) : openEngineLogs.add(inst.id); renderEngines(); } }, open ? "Ocultar registro" : "Ver registro"),
        live
          ? h("button", { type: "button", class: "danger", onclick: async () => {
              if (!(await confirmAction("Detener " + inst.alias, "Se cierra la instancia y libera su memoria. Las aplicaciones que la usen dejarán de recibir respuesta.", "Detener instancia"))) return;
              await api("/panel/engines/" + inst.id + "/stop", { body: {} }).catch((err) => notify(err.message, "error"));
              await refreshStatus(); renderEngines();
            } }, "Detener")
          : h("button", { type: "button", class: "quiet", onclick: async () => {
              await api("/panel/engines/" + inst.id, { method: "DELETE" }).catch((err) => notify(err.message, "error"));
              openEngineLogs.delete(inst.id); engineLogs.delete(inst.id);
              await refreshStatus(); renderEngines();
            } }, "Quitar de la lista")),
      pre ? h("div", { style: "grid-column:1 / -1" }, pre) : null);
  }));
}

async function enterEngines() {
  fillSelect($("#engine-form [name=ollama_model]"), (state.tags || []).filter((m) => (m.capabilities || []).includes("completion")), engineDraft);
  if (engineDraft) { $("#engine-form input[value='llama.cpp']").checked = true; engineDraft = null; }
  await refreshStatus();
  renderEngines();
  renderEngineEnv();
}

/* ================================================================ vista: descargar */

$("#pull-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = e.target.model;
  const model = input.value.trim();
  if (!model) return;
  input.value = "";
  runOp("Descargar " + model, async (update, signal) => {
    await stream("/ollama/pull", { model, stream: true }, progressTracker(update), signal);
    return { message: "Descargado." };
  });
});

/* ================================================================ vista: subir GGUF */

$("#upload-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const file = form.file.files[0];
  const model = form.model.value.trim();
  const system = form.system.value.trim();
  if (!file || !model) return;
  if (!/\.gguf$/i.test(file.name)) { notify("El archivo debe tener extensión .gguf.", "error"); return; }
  form.reset();
  let xhr;
  runOp("Subir " + file.name + " como " + model, async (update, signal) => {
    const digest = await new Promise((resolve, reject) => {
      xhr = new XMLHttpRequest();
      xhr.open("POST", "/panel/upload");
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (ev) => update({ status: "Enviando al servidor", completed: ev.loaded, total: ev.total });
      xhr.upload.onload = () => update({ status: "Calculando la firma del archivo", total: 0, completed: 0 });
      let seen = 0, last = null;
      const parse = () => {
        const lines = xhr.responseText.split("\n");
        for (; seen < lines.length - 1; seen++) {
          if (!lines[seen].trim()) continue;
          try { last = JSON.parse(lines[seen]); } catch (err) { continue; }
          if (last.status && last.status !== "success") update({ status: last.status, completed: last.completed, total: last.total });
        }
      };
      xhr.onprogress = parse;
      xhr.onload = () => {
        parse();
        const tail = xhr.responseText.trim().split("\n").pop();
        try { last = JSON.parse(tail); } catch (err) { /* sin JSON */ }
        if (xhr.status >= 400 || !last || last.error) reject(new Error((last && last.error) || "El servidor rechazó la subida (" + xhr.status + ")."));
        else resolve(last.digest);
      };
      xhr.onerror = () => reject(new Error("Se cortó la conexión durante la subida."));
      xhr.onabort = () => reject(new Error("Cancelado."));
      signal.addEventListener("abort", () => xhr.abort());
      xhr.send(file);
    });
    update({ status: "Creando el modelo", total: 0, completed: 0 });
    const fname = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
    await stream("/ollama/create", { model, files: { [fname]: digest }, ...(system ? { system } : {}), stream: true }, progressTracker(update), signal);
    return { message: "Modelo " + model + " creado." };
  });
});

/* ================================================================ vista: cuantizar */

// Bits por peso efectivos aproximados de cada tipo de llama.cpp (incluyen escalas y tablas).
const BPW = { Q2_K: 3.35, Q3_K_S: 3.5, Q3_K_M: 3.91, Q3_K_L: 4.27, Q4_0: 4.55, Q4_K_S: 4.58, Q4_K_M: 4.89, IQ4_XS: 4.25,
  Q5_0: 5.54, Q5_K_S: 5.54, Q5_K_M: 5.69, Q6_K: 6.56, Q8_0: 8.5, F16: 16, BF16: 16 };

function suggestQuantName() {
  const form = $("#quant-form");
  const from = form.from.value;
  const q = form.quantize.value;
  if (!from) return;
  const m = (state.tags || []).find((t) => t.name === from);
  const srcQuant = (m && m.details.quantization_level) || "";
  const needsRequant = !UNQUANTIZED.test(srcQuant);
  $("#requant-wrap").hidden = !needsRequant;
  if (!needsRequant) form.allow_requantize.checked = false;
  const [repo, tag = "latest"] = from.split(":");
  const low = q.toLowerCase();
  let newTag = tag.replace(new RegExp("(fp16|bf16|fp32|f16|f32|" + srcQuant.toLowerCase().replace(/[^a-z0-9_]/g, "") + ")", "i"), low);
  if (newTag === tag) newTag = tag + "-" + low;
  if (!form.model.dataset.touched) form.model.value = repo + ":" + newTag;
  const params = m && parseParams(m.details.parameter_size);
  const est = params ? (params * BPW[q]) / 8 : null;
  const box = $("#quant-estimate");
  if (!est) { box.replaceChildren(); return; }
  box.replaceChildren(
    h("div", {}, h("dt", {}, "Origen"), h("dd", {}, srcQuant + " · " + fmtGB(m.size))),
    h("div", {}, h("dt", {}, "Tamaño estimado"), h("dd", {}, "~" + fmtGB(est))),
    h("div", {}, h("dt", {}, "Cabida estimada"), h("dd", {}, fitCell({ ...m, size: est, estimate: true }))));
}
$("#quant-form").from.addEventListener("change", suggestQuantName);
$("#quant-form").quantize.addEventListener("change", suggestQuantName);
$("#quant-form").model.addEventListener("input", (e) => { e.target.dataset.touched = "1"; });

async function renderQuantEnv() {
  const box = $("#quant-env");
  let env;
  try { env = await api("/panel/quantize/env"); }
  catch (e) { fill(box, h("p", { class: "error-text" }, e.message)); $("#quant-form").hidden = true; return; }
  $("#quant-form").hidden = !env.available;
  if (env.available) { box.replaceChildren(); suggestQuantName(); return; }
  fill(box, h("div", { class: "block" }, h("p", { class: "empty", style: "padding-top:0" }, env.reason),
    h("p", { class: "note" }, "Tu versión de Ollama" + (state.version ? " (" + state.version + ")" : "") + " no cuantiza modelos GGUF ya instalados: solo lo hace al importar safetensors. Por eso el panel usa llama.cpp.")));
}

$("#quant-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = { from: form.from.value, output: form.model.value.trim(), type: form.quantize.value, allow_requantize: form.allow_requantize.checked };
  if (!body.output) return;
  if (!$("#requant-wrap").hidden && !body.allow_requantize) {
    notify("El origen ya está cuantizado. Marca la casilla de recuantizar o elige un modelo F16.", "error");
    return;
  }
  if ((state.tags || []).some((t) => t.name === body.output || t.name === body.output + ":latest")) {
    if (!(await confirmAction("Ya existe " + body.output, "El resultado sustituirá al modelo con ese nombre.", "Sustituir"))) return;
  }
  const btn = $("button[type=submit]", form);
  btn.disabled = true;
  try {
    await api("/panel/quantize", { body });
    delete form.model.dataset.touched;
    renderJobList($("#quant-jobs"), "quantize");
  } catch (err) { notify(err.message, "error"); }
  finally { btn.disabled = false; }
});

/* ================================================================ vista: variante */

$("#variant-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const body = { model: form.model.value.trim(), from: form.from.value, stream: true };
  if (form.system.value.trim()) body.system = form.system.value.trim();
  if (form.template.value.trim()) body.template = form.template.value;
  const parameters = {};
  for (const k of ["temperature", "top_p", "num_ctx", "repeat_penalty"]) {
    if (form[k].value !== "") parameters[k] = Number(form[k].value);
  }
  const stop = form.stop.value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (stop.length) parameters.stop = stop;
  if (Object.keys(parameters).length) body.parameters = parameters;
  runOp("Crear variante " + body.model, async (update, signal) => {
    await stream("/ollama/create", body, progressTracker(update), signal);
    return { message: "Variante " + body.model + " creada." };
  });
});

/* ================================================================ vista: chat */

const chat = { messages: [], ctrl: null };

/** Modelos de Ollama y, aparte, las instancias listas de los motores (valor "engine:<id>"). */
function fillChatSelect(want) {
  const sel = $("#chat-model");
  const prev = want ?? sel.value;
  const chatable = (state.tags || []).filter((m) => !m.capabilities || m.capabilities.includes("completion"));
  const ready = (state.engines || []).filter((e) => e.status === "ready");
  fill(sel,
    h("optgroup", { label: "Ollama" }, chatable.map((m) => h("option", { value: m.name }, m.name + "  ·  " + (m.details.parameter_size || "")))),
    ready.length ? h("optgroup", { label: "Motores" }, ready.map((e) => h("option", { value: "engine:" + e.id }, e.alias + "  ·  " + e.engine + " :" + e.port))) : null);
  if ($$("option", sel).some((o) => o.value === prev)) sel.value = prev;
  updateChatCaps();
}

function chatTarget() {
  const v = $("#chat-model").value;
  if (v.startsWith("engine:")) {
    const inst = (state.engines || []).find((e) => "engine:" + e.id === v);
    return inst ? { engine: inst, label: inst.alias + " · " + inst.engine } : null;
  }
  return v ? { model: v, label: v } : null;
}

function openChat(name) {
  location.hash = "#chat";
  fillChatSelect(name);
}

function updateChatCaps() {
  const t = chatTarget();
  const m = t && t.model && (state.tags || []).find((x) => x.name === t.model);
  const caps = (m && m.capabilities) || [];
  $("#chat-think-wrap").hidden = !caps.includes("thinking");
  $("#chat-image-wrap").hidden = !(caps.includes("vision") || (t && t.engine && t.engine.vision));
}

/** Chat con una instancia de motor: API de OpenAI con streaming SSE, a través del proxy del panel. */
async function engineChat(inst, messages, options, onDelta, signal) {
  const body = { model: inst.alias, stream: true, messages: messages.map((msg) => msg.images
    ? { role: msg.role, content: [{ type: "text", text: msg.content }].concat(msg.images.map((b64) => ({ type: "image_url", image_url: { url: "data:image/png;base64," + b64 } }))) }
    : { role: msg.role, content: msg.content }) };
  if (options.temperature != null) body.temperature = options.temperature;
  const res = await fetch("/engine/" + inst.id + "/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || text; } catch (e) { /* texto plano */ }
    throw new Error(String(msg).slice(0, 400));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", stats = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let obj;
      try { obj = JSON.parse(data); } catch (e) { continue; }
      if (obj.error) throw new Error(obj.error.message || String(obj.error));
      const delta = (obj.choices && obj.choices[0] && obj.choices[0].delta) || {};
      onDelta({ content: delta.content || "", thinking: delta.reasoning_content || "" });
      if (obj.timings) stats = { tokens: obj.timings.predicted_n, tps: obj.timings.predicted_per_second };
      else if (obj.usage && obj.usage.completion_tokens) stats = { tokens: obj.usage.completion_tokens };
    }
  }
  return stats;
}
$("#chat-model").addEventListener("change", updateChatCaps);

function chatBubble(role, text) {
  const textEl = h("div", { class: "text" }, text);
  const t = chatTarget();
  const el = h("div", { class: "msg " + role }, h("div", { class: "who" }, role === "user" ? "Tú" : t ? t.label : ""), textEl);
  $("#chat-empty").hidden = true;
  $("#chat-log").append(el);
  return { el, textEl };
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("No se pudo leer la imagen."));
    r.readAsDataURL(file);
  });
}

$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  const target = chatTarget();
  if (!text || !target || chat.ctrl) return;
  const model = target.model;
  const userMsg = { role: "user", content: text };
  const imgFile = !$("#chat-image-wrap").hidden && $("#chat-image").files[0];
  if (imgFile) userMsg.images = [await readImage(imgFile)];
  $("#chat-image").value = "";
  input.value = "";
  chat.messages.push(userMsg);
  chatBubble("user", text + (imgFile ? "\n[imagen: " + imgFile.name + "]" : ""));
  const { el, textEl } = chatBubble("assistant", "");
  textEl.textContent = "Cargando el modelo…";
  const sys = $("#chat-system").value.trim();
  const options = {};
  if ($("#chat-temp").value !== "") options.temperature = Number($("#chat-temp").value);
  if ($("#chat-ctx").value !== "") options.num_ctx = Number($("#chat-ctx").value);
  // keep_alive explícito: si el servidor fija los modelos para siempre (OLLAMA_KEEP_ALIVE=-1), una prueba no debe quedarse ocupando VRAM.
  const body = { model, stream: true, keep_alive: "5m", messages: (sys ? [{ role: "system", content: sys }] : []).concat(chat.messages), options };
  if (!$("#chat-think-wrap").hidden) body.think = $("#chat-think").checked;
  chat.ctrl = new AbortController();
  $("#chat-send").disabled = true;
  $("#chat-stop").disabled = false;
  let content = "", thinking = "", thinkEl = null, started = false;
  const onDelta = (d) => {
    if (!started) { started = true; textEl.textContent = ""; }
    if (d.thinking) {
      if (!thinkEl) { thinkEl = h("div", {}); el.insertBefore(h("details", {}, h("summary", {}, "Razonamiento"), thinkEl), textEl); }
      thinking += d.thinking;
      thinkEl.textContent = thinking;
    }
    if (d.content) { content += d.content; textEl.textContent = content; }
  };
  const statsLine = (tokens, tps, load) => el.append(h("div", { class: "stats" }, (tokens || 0) + " tokens" +
    (tps ? " · " + Number(tps).toFixed(1) + " tokens/s" : "") + (load ? " · carga " + load.toFixed(1) + " s" : "")));
  try {
    if (target.engine) {
      textEl.textContent = "Esperando respuesta…";
      const stats = await engineChat(target.engine, body.messages, options, onDelta, chat.ctrl.signal);
      if (stats) statsLine(stats.tokens, stats.tps);
    } else {
      await stream("/ollama/chat", body, (msg) => {
        if (msg.message) onDelta({ content: msg.message.content, thinking: msg.message.thinking });
        if (msg.done) statsLine(msg.eval_count, msg.eval_count && msg.eval_duration ? msg.eval_count / (msg.eval_duration / 1e9) : null,
          msg.load_duration > 5e8 ? msg.load_duration / 1e9 : null);
      }, chat.ctrl.signal);
    }
    chat.messages.push({ role: "assistant", content });
  } catch (err) {
    if (err.name === "AbortError") {
      el.append(h("div", { class: "stats" }, "Detenido."));
      if (content) chat.messages.push({ role: "assistant", content });
    } else {
      chat.messages.pop();
      textEl.textContent = "";
      textEl.append(h("span", { class: "error-text" }, "Error: " + err.message));
    }
  } finally {
    chat.ctrl = null;
    $("#chat-send").disabled = false;
    $("#chat-stop").disabled = true;
    refreshStatus();
  }
});
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("#chat-form").requestSubmit(); }
});
$("#chat-stop").addEventListener("click", () => chat.ctrl && chat.ctrl.abort());
$("#chat-clear").addEventListener("click", () => {
  if (chat.ctrl) chat.ctrl.abort();
  chat.messages = [];
  $$(".msg", $("#chat-log")).forEach((m) => m.remove());
  $("#chat-empty").hidden = false;
});

/* ================================================================ vista: entrenamiento */

let trainEnv = null;

async function renderTrainEnv() {
  const box = $("#train-env");
  box.replaceChildren(h("div", { class: "skeleton w60" }), h("p", { class: "note" }, "Comprobando PyTorch y CUDA en el servidor…"));
  try { trainEnv = await api("/panel/train/env"); }
  catch (e) { box.replaceChildren(h("p", { class: "error-text" }, e.message)); return; }
  const env = trainEnv;
  if (env.error) {
    box.replaceChildren(h("p", { class: "error-text" }, "No se pudo ejecutar el intérprete de entrenamiento " + env.interpreter + ": " + env.error));
    return;
  }
  const yes = (v, extra) => v ? h("span", { class: "ok" }, String(v === true ? "Sí" : v) + (extra || "")) : h("span", { class: "bad" }, "Falta");
  const rows = [
    ["Intérprete", env.interpreter + " (Python " + env.python + ")"],
    ["PyTorch", yes(env.torch)],
    ["CUDA", env.cuda ? yes(env.gpu, env.vram ? " · " + fmtGiB(env.vram) + " GiB" : "") : h("span", { class: "bad" }, "No disponible")],
    ["transformers", yes(env.transformers)],
    ["peft", yes(env.peft)],
    ["accelerate", yes(env.accelerate)],
    ["bitsandbytes (4 bits)", yes(env.bitsandbytes)],
    ["llama.cpp (adaptador a GGUF)", env.llama_cpp ? h("span", { class: "ok" }, env.llama_cpp) : h("span", { class: "warn" }, "No configurado: el adaptador se envía en safetensors")],
  ];
  fill(box,
    h("dl", { class: "spec" }, rows.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))),
    env.ready ? null : h("p", { class: "note" }, "Para entrenar falta preparar el entorno. En el servidor, desde la carpeta del panel: ",
      h("code", {}, "sudo ./install.sh --train"), ". Mientras tanto puedes validar datasets con «Solo validar el dataset»."));
}

async function renderDatasets() {
  const box = $("#datasets");
  let list;
  try { list = (await api("/panel/datasets")).datasets; }
  catch (e) { box.replaceChildren(h("p", { class: "error-text" }, e.message)); return; }
  const sel = $("#train-form [name=dataset]");
  const prev = sel.value;
  sel.replaceChildren(...list.map((d) => h("option", { value: d.name }, d.name)));
  if (list.some((d) => d.name === prev)) sel.value = prev;
  if (!list.length) { box.replaceChildren(h("p", { class: "empty" }, "Aún no hay datasets. Sube un .jsonl con tus ejemplos.")); return; }
  box.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "stack" },
    h("thead", {}, h("tr", {}, h("th", {}, "Archivo"), h("th", { class: "num" }, "Tamaño"), h("th", {}, "Subido"), h("th", {}, h("span", { class: "visually-hidden" }, "Acciones")))),
    h("tbody", {}, list.map((d) => h("tr", {},
      h("td", { class: "model", "data-label": "Archivo" }, d.name),
      h("td", { class: "num", "data-label": "Tamaño" }, fmtSize(d.size)),
      h("td", { "data-label": "Subido" }, fmtDate(d.modified * 1000)),
      h("td", { class: "row-actions" }, h("button", { type: "button", class: "danger", onclick: async () => {
        if (!(await confirmAction("Borrar " + d.name, "Se elimina el dataset del servidor.", "Borrar dataset"))) return;
        try { await api("/panel/datasets/" + encodeURIComponent(d.name), { method: "DELETE" }); renderDatasets(); }
        catch (e) { notify(e.message, "error"); }
      } }, "Borrar"))))))));
}

function reportView(report) {
  return h("div", {},
    h("p", { class: report.invalid ? "warn" : "ok" }, report.examples + " ejemplos válidos" + (report.invalid ? ", " + report.invalid + " líneas descartadas" : "") +
      " · media de " + report.avg_chars + " caracteres por ejemplo."),
    report.errors.length ? h("ul", { class: "note" }, report.errors.map((er) => h("li", {}, "Línea " + er.line + ": " + er.reason))) : null);
}

$("#dataset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = e.target.file.files[0];
  if (!file) return;
  const out = $("#dataset-report");
  out.replaceChildren(h("p", { class: "note" }, "Subiendo y validando " + file.name + "…"));
  try {
    const name = file.name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[^A-Za-z0-9]+/, "");
    const res = await fetch("/panel/datasets?name=" + encodeURIComponent(name), { method: "POST", body: file });
    const data = await res.json().catch(() => ({ error: "Respuesta inesperada del servidor." }));
    if (!res.ok) {
      fill(out, h("p", { class: "error-text" }, data.error), data.report ? reportView(data.report) : null);
      return;
    }
    out.replaceChildren(h("p", {}, "Guardado como " + data.name + "."), reportView(data.report));
    e.target.reset();
    await renderDatasets();
    $("#train-form [name=dataset]").value = data.name;
  } catch (err) { out.replaceChildren(h("p", { class: "error-text" }, err.message)); }
});

$("#train-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    base_model: f.base_model.value.trim(), dataset: f.dataset.value, ollama_from: f.ollama_from.value,
    output_model: f.output_model.value.trim(), dry_run: f.dry_run.checked, load_4bit: f.load_4bit.checked,
  };
  for (const k of ["epochs", "learning_rate", "lora_r", "lora_alpha", "max_seq_len", "batch_size", "grad_accum"]) body[k] = Number(f[k].value);
  if (!body.dataset) { notify("Sube primero un dataset.", "error"); return; }
  if (!body.dry_run && !body.output_model) { notify("Indica el nombre del modelo resultante.", "error"); f.output_model.focus(); return; }
  if (!body.dry_run && trainEnv && !trainEnv.ready) { notify("El entorno de entrenamiento no está listo (ver Entorno del servidor). Marca «Solo validar el dataset» para probar.", "error"); return; }
  if (!body.dry_run && state.ps && state.ps.length) {
    const ok = await confirmAction("Hay modelos en memoria", "Ocupan VRAM que el entrenamiento necesita: " + state.ps.map((m) => m.name).join(", ") + ". ¿Descargarlos antes de empezar?", "Descargar y entrenar");
    if (!ok) return;
    await unloadAll();
  }
  const btn = $("#train-submit");
  btn.disabled = true;
  try {
    const job = await api("/panel/train", { body });
    openJobs.add(job.id);
    notify(body.dry_run ? "Validación lanzada." : "Entrenamiento lanzado.");
    renderJobs();
  } catch (err) { notify(err.message, "error"); }
  finally { btn.disabled = false; }
});

const JOB_STATUS = { running: ["En curso", "warn"], done: ["Terminado", "ok"], failed: ["Falló", "bad"], cancelled: ["Cancelado", "bad"], interrupted: ["Interrumpido (se reinició el panel)", "bad"] };
const openJobs = new Set();
const jobLogs = new Map();

async function pollJobLog(id, pre) {
  const entry = jobLogs.get(id) || { text: "", offset: 0 };
  try {
    const data = await api("/panel/jobs/" + id + "/log?offset=" + entry.offset);
    entry.text += data.text;
    entry.offset = data.offset;
    jobLogs.set(id, entry);
  } catch (e) { entry.text = entry.text || "No se pudo leer el registro: " + e.message; }
  if (pre) {
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
    pre.textContent = entry.text || "Sin salida todavía.";
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  }
  return entry;
}

/** Progreso de llama-quantize: la última marca "[ n/ total]" del registro. */
function quantProgress(text) {
  let last = null;
  for (const m of text.matchAll(/\[\s*(\d+)\s*\/\s*(\d+)\]/g)) last = m;
  return last ? { done: Number(last[1]), total: Number(last[2]) } : null;
}

const JOB_KIND = {
  train: {
    title: (c) => c.dry_run ? "Validación de " + c.dataset_name : c.base_model + " → " + c.output_model,
    detail: (c) => c.dataset_name,
    empty: "Sin trabajos. Configura uno arriba; con «Solo validar el dataset» compruebas el formato en segundos.",
    cancel: ["Cancelar entrenamiento", "Se detiene el proceso. Lo entrenado hasta ahora se pierde."],
    remove: "Se borran su registro y el adaptador guardado. El modelo creado en Ollama, si lo hay, se conserva.",
  },
  quantize: {
    title: (c) => c.from + " → " + c.output,
    detail: (c) => c.type + (c.allow_requantize ? " · recuantizado" : ""),
    empty: "Aún no has cuantizado ningún modelo.",
    cancel: ["Cancelar cuantización", "Se detiene llama-quantize y se descarta el archivo a medias."],
    remove: "Se borra el registro del trabajo. El modelo creado en Ollama, si lo hay, se conserva.",
  },
};
const jobStatusSeen = new Map();

async function renderJobList(box, kind) {
  const K = JOB_KIND[kind];
  let jobs;
  try { jobs = (await api("/panel/jobs?kind=" + kind)).jobs; }
  catch (e) { fill(box, h("p", { class: "error-text" }, e.message)); return; }
  if (kind === "train") $("#nav-count-jobs").textContent = jobs.some((j) => j.status === "running") ? String(jobs.filter((j) => j.status === "running").length) : "";
  let finishedNow = false;
  for (const j of jobs) {
    if (jobStatusSeen.get(j.id) === "running" && j.status !== "running") finishedNow = true;
    jobStatusSeen.set(j.id, j.status);
  }
  if (finishedNow) refreshModels();
  if (!jobs.length) { fill(box, h("p", { class: "empty" }, K.empty)); return; }
  const progress = new Map();
  if (kind === "quantize") {
    await Promise.all(jobs.filter((j) => j.status === "running").map(async (j) => progress.set(j.id, quantProgress((await pollJobLog(j.id)).text))));
  }
  const rerender = () => renderJobList(box, kind);
  fill(box, jobs.map((j) => {
    const c = j.config;
    const [label, cls] = JOB_STATUS[j.status] || [j.status, ""];
    const open = openJobs.has(j.id);
    const pre = open ? h("pre", { class: "log", tabindex: "0" }, (jobLogs.get(j.id) || {}).text || "Cargando…") : null;
    if (pre) pollJobLog(j.id, pre);
    const p = progress.get(j.id);
    return h("div", { class: "op" },
      h("div", { class: "title" }, K.title(c)),
      p ? h("div", { class: "meter", role: "progressbar", "aria-label": K.title(c), "aria-valuemin": "0", "aria-valuemax": String(p.total), "aria-valuenow": String(p.done) },
        h("i", { style: "width:" + ((p.done / p.total) * 100).toFixed(1) + "%" })) : null,
      h("div", { class: "status" }, h("span", { class: cls }, label), (p ? " · tensor " + p.done + " de " + p.total : "") + " · " + K.detail(c) + " · " + fmtDate(j.created * 1000) +
        (j.finished ? " · duró " + fmtDuration(j.finished - j.created) : "")),
      h("div", { class: "actions", style: "margin-top:4px;grid-column:1" },
        h("button", { type: "button", "aria-expanded": String(open), onclick: () => { open ? openJobs.delete(j.id) : openJobs.add(j.id); rerender(); } }, open ? "Ocultar registro" : "Ver registro"),
        j.status === "running"
          ? h("button", { type: "button", class: "danger", onclick: async () => {
              if (!(await confirmAction(K.cancel[0], K.cancel[1], K.cancel[0]))) return;
              await api("/panel/jobs/" + j.id + "/cancel", { body: {} }).catch((e) => notify(e.message, "error"));
              rerender();
            } }, "Cancelar")
          : h("button", { type: "button", class: "quiet", onclick: async () => {
              if (!(await confirmAction("Borrar trabajo", K.remove, "Borrar trabajo"))) return;
              await api("/panel/jobs/" + j.id, { method: "DELETE" }).catch((e) => notify(e.message, "error"));
              openJobs.delete(j.id); jobLogs.delete(j.id);
              rerender();
            } }, "Borrar")),
      pre ? h("div", { style: "grid-column:1 / -1" }, pre) : null);
  }));
}
const renderJobs = () => renderJobList($("#jobs"), "train");

/* ================================================================ vista: registros */

async function renderLogs() {
  const out = $("#log-out");
  try {
    const data = await api("/panel/logs?lines=" + $("#log-lines").value);
    const errEl = $("#log-error");
    errEl.hidden = !data.error;
    out.hidden = !!data.error;
    if (data.error) { errEl.textContent = data.error; return; }
    const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
    out.textContent = data.log;
    if (atBottom || !out.dataset.loaded) out.scrollTop = out.scrollHeight;
    out.dataset.loaded = "1";
  } catch (e) { $("#log-error").textContent = e.message; $("#log-error").hidden = false; out.hidden = true; }
}
$("#log-refresh").addEventListener("click", renderLogs);
$("#log-lines").addEventListener("change", renderLogs);

/* ================================================================ navegación, tema y ciclo de refresco */

const VIEWS = ["modelos", "motores", "descargar", "subir", "cuantizar", "variante", "chat", "entrenamiento", "registros"];
function currentView() {
  const v = location.hash.slice(1);
  return VIEWS.includes(v) ? v : "modelos";
}

function route() {
  const view = currentView();
  for (const s of $$("[data-view]")) s.hidden = s.dataset.view !== view;
  // La bandeja de operaciones va bajo la entrada de la vista activa: el título de la vista encabeza la página.
  const lede = $("[data-view='" + view + "'] .lede");
  if (lede) lede.after($("#ops"));
  for (const a of $$("#nav a")) {
    if (a.getAttribute("href") === "#" + view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  $("#rail").classList.remove("open");
  $("#nav-toggle").setAttribute("aria-expanded", "false");
  if (view === "modelos") renderModelsView();
  if (view === "motores") enterEngines();
  if (view === "chat") fillChatSelect();
  if (view === "entrenamiento") { renderTrainEnv(); renderDatasets(); renderJobs(); }
  if (view === "registros") renderLogs();
  if (view === "cuantizar") { renderQuantEnv(); renderJobList($("#quant-jobs"), "quantize"); }
  const heading = $("[data-view='" + view + "'] h2");
  if (heading && document.activeElement && document.activeElement.closest("#nav")) { heading.tabIndex = -1; heading.focus(); }
}
window.addEventListener("hashchange", route);

$("#nav-toggle").addEventListener("click", () => {
  const open = $("#rail").classList.toggle("open");
  $("#nav-toggle").setAttribute("aria-expanded", String(open));
});

const THEMES = [["", "sistema"], ["light", "claro"], ["dark", "oscuro"]];
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  $("#theme-btn").textContent = "Tema: " + THEMES.find(([k]) => k === (t || ""))[1];
}
$("#theme-btn").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || "";
  const next = THEMES[(THEMES.findIndex(([k]) => k === cur) + 1) % THEMES.length][0];
  storeSet("theme", next || null);
  applyTheme(next);
});
applyTheme(document.documentElement.dataset.theme || "");

$("#filter").addEventListener("input", (e) => { state.filter = e.target.value; renderInstalled(); });
$("#unload-all").addEventListener("click", unloadAll);

setInterval(() => {
  if (document.hidden) return;
  const view = currentView();
  if (view === "modelos") refreshStatus();
  if (view === "motores") refreshStatus().then(() => { renderEngines(); updateEngineFit(); });
  if (view === "entrenamiento") renderJobs();
  if (view === "cuantizar") renderJobList($("#quant-jobs"), "quantize");
  if (view === "registros" && $("#log-follow").checked) renderLogs();
}, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && currentView() === "modelos") refreshStatus(); });

route();
refreshModels();
