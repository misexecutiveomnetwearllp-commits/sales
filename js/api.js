import { APPS_SCRIPT_URL } from "./config.js";

let cache = null; // { sales, targets, uploads, meta }
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

async function fetchAll(){
  const url = apiUrl();
  if (!url) throw new Error("NOT_CONFIGURED");
  const res = await fetch(`${url}?action=getAll`);
  if (!res.ok) throw new Error("Request failed: " + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  cache = {
    sales: (data.sales || []).map(normalizeSalesRow),
    targets: (data.targets || []).map(normalizeTargetRow),
    uploads: data.uploads || [],
    meta: data.meta || {}
  };
  return cache;
}

function normalizeSalesRow(r){
  return {
    id: r.id, uploadId: r.uploadId, date: r.date, period: r.period,
    store: r.store, salesperson: r.salesperson, qty: Number(r.qty) || 0, bill: r.bill || ""
  };
}
function normalizeTargetRow(r){
  return { key: r.key, store: r.store, salesperson: r.salesperson, period: r.period, target: Number(r.target) || 0 };
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
  async getAllSales(){ return (await ensureCache()).sales; },
  async getAllTargets(){ return (await ensureCache()).targets; },
  async getAllUploads(){ return (await ensureCache()).uploads; },

  async addSalesRecords(records){
    const r = await post("addSales", { records });
    await fetchAll();
    return r.count;
  },
  async deleteSalesByUpload(uploadId){
    await post("deleteSalesByUpload", { uploadId });
    await fetchAll();
  },
  async clearSales(){
    await post("clearSales", {});
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

  async addUpload(meta){
    const r = await post("addUpload", meta);
    await fetchAll();
    return r.id;
  },
  async deleteUpload(id){
    await post("deleteUpload", { id });
    await fetchAll();
  },
  async clearUploads(){
    await post("clearUploads", {});
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
