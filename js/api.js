import { APPS_SCRIPT_URL } from "./config.js";

let cache = null; // { files, targets, meta }
let urlOverride = null;

function apiUrl(){
  return urlOverride || APPS_SCRIPT_URL || localStorage.getItem("ledger_apps_script_url") || "";
}

export function setApiUrl(url){
  urlOverride = url;
  localStorage.setItem("ledger_apps_script_url", url);
}

export function getApiUrl(){
  return apiUrl();
}

export function isConfigured(){
  return !!apiUrl();
}

function normalizeFileRow(f){
  let mapping = null;
  try { mapping = f.mapping ? JSON.parse(f.mapping) : null; } catch (e){ mapping = null; }
  return {
    id: f.id,
    name: f.name,
    uploadedAt: f.uploadedAt,
    type: f.type,
    headerRowIndex: (f.headerRowIndex === "" || f.headerRowIndex === null || f.headerRowIndex === undefined) ? null : Number(f.headerRowIndex),
    mapping,
    rows: Number(f.rows) || 0
  };
}
function normalizeTargetRow(r){
  return { key: r.key, store: r.store, salesperson: r.salesperson, period: r.period, target: Number(r.target) || 0 };
}

async function fetchAll(){
  const url = apiUrl();
  if (!url) throw new Error("NOT_CONFIGURED");
  const res = await fetch(`${url}?action=getAll`);
  if (!res.ok) throw new Error("Request failed: " + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  cache = {
    files: (data.files || []).map(normalizeFileRow),
    targets: (data.targets || []).map(normalizeTargetRow),
    meta: data.meta || {}
  };
  return cache;
}

async function post(action, payload){
  const url = apiUrl();
  if (!url) throw new Error("NOT_CONFIGURED");
  // text/plain avoids a CORS preflight against the Apps Script endpoint
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload })
  });
  if (!res.ok) throw new Error("Request failed: " + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function ensureCache(){
  if (!cache) await fetchAll();
  return cache;
}

export const DB = {
  async getFiles(){ return (await ensureCache()).files; },
  async getAllTargets(){ return (await ensureCache()).targets; },

  // Fetches one file's raw content on demand (base64) — not cached in
  // getAll, since files can be large and most loads only need metadata
  // plus a re-parse of the sales-type ones.
  async getFileContent(id){
    const url = apiUrl();
    if (!url) throw new Error("NOT_CONFIGURED");
    const res = await fetch(`${url}?action=getFileContent&id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("Request failed: " + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data; // { name, base64 }
  },

  async uploadFile(meta){
    // meta: { name, base64, mimeType, type, headerRowIndex, mapping, rows, uploadedAt }
    const r = await post("uploadFile", meta);
    await fetchAll();
    return r.id;
  },
  async deleteFile(id){
    await post("deleteFile", { id });
    await fetchAll();
  },
  async clearFiles(){
    await post("clearFiles", {});
    await fetchAll();
  },

  async putTargets(rows){
    const r = await post("putTargets", { records: rows });
    await fetchAll();
    return r.count;
  },
  async deleteTarget(key){
    await post("deleteTarget", { key });
    await fetchAll();
  },
  async clearTargets(){
    await post("clearTargets", {});
    await fetchAll();
  },

  async setMeta(key, value){
    await post("setMeta", { key, value });
    if (cache) cache.meta[key] = value;
  },
  async getMeta(key, fallback){
    const c = await ensureCache();
    return (c.meta && c.meta[key] !== undefined && c.meta[key] !== "") ? c.meta[key] : fallback;
  },

  async clearAll(){
    await post("clearAll", {});
    await fetchAll();
  },

  async refresh(){
    return fetchAll();
  }
};
