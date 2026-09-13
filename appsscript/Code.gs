/**
 * Ledger — Sales Performance backend.
 * Deploy as a Web App (Execute as: Me, Who has access: Anyone).
 * Backed by a Google Sheet with tabs: Sales, Targets, Uploads, Meta
 * (created automatically on first use — nothing to set up by hand).
 *
 * IMPORTANT: paste your Google Sheet's ID below before deploying.
 * Find it in the Sheet's URL: docs.google.com/spreadsheets/d/<THIS PART>/edit
 * (Web apps have no "active spreadsheet", so this can't be done automatically.)
 */
const SPREADSHEET_ID = "PASTE_YOUR_SPREADSHEET_ID_HERE";

const SHEETS = {
  sales: { name: "Sales", headers: ["id", "uploadId", "date", "period", "store", "salesperson", "qty", "bill"] },
  targets: { name: "Targets", headers: ["key", "store", "salesperson", "period", "target"] },
  uploads: { name: "Uploads", headers: ["id", "file", "rows", "uploadedAt", "type"] },
  meta: { name: "Meta", headers: ["key", "value"] }
};

function getSpreadsheet_(){
  if (!SPREADSHEET_ID || SPREADSHEET_ID.indexOf("PASTE_") === 0){
    throw new Error("Set SPREADSHEET_ID at the top of Code.gs to your Google Sheet's ID, then redeploy (Deploy \u2192 Manage deployments \u2192 Edit \u2192 New version).");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet_(kind){
  const ss = getSpreadsheet_();
  const def = SHEETS[kind];
  let sheet = ss.getSheetByName(def.name);
  if (!sheet){
    sheet = ss.insertSheet(def.name);
    sheet.appendRow(def.headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sheetToObjects_(sheet){
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const out = [];
  for (let i = 1; i < values.length; i++){
    const row = values[i];
    if (row.every(c => c === "" || c === null)) continue;
    const obj = {};
    headers.forEach((h, j) => { obj[h] = row[j]; });
    out.push(obj);
  }
  return out;
}

function findRowIndexByValue_(sheet, colIndex, value){
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++){
    if (String(values[i][colIndex]) === String(value)) return i + 1; // 1-based sheet row
  }
  return -1;
}

/* ============ Public API ============ */

function doGet(e){
  const action = (e.parameter && e.parameter.action) || "getAll";
  let result;
  try {
    if (action === "getAll"){
      const metaRows = sheetToObjects_(getSheet_("meta"));
      const meta = {};
      metaRows.forEach(r => { meta[r.key] = r.value; });
      result = {
        sales: sheetToObjects_(getSheet_("sales")),
        targets: sheetToObjects_(getSheet_("targets")),
        uploads: sheetToObjects_(getSheet_("uploads")),
        meta
      };
    } else {
      result = { error: "Unknown action: " + action };
    }
  } catch (err){
    result = { error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e){
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err){
    return jsonOut_({ error: "Invalid request body" });
  }
  const action = body.action;
  const payload = body.payload || {};
  let result;
  try {
    switch (action){
      case "addSales": result = addSales_(payload); break;
      case "deleteSalesByUpload": result = deleteSalesByUpload_(payload); break;
      case "clearSales": result = clearSheet_("sales"); break;
      case "putTargets": result = putTargets_(payload); break;
      case "deleteTarget": result = deleteTarget_(payload); break;
      case "clearTargets": result = clearSheet_("targets"); break;
      case "addUpload": result = addUpload_(payload); break;
      case "deleteUpload": result = deleteUpload_(payload); break;
      case "clearUploads": result = clearSheet_("uploads"); break;
      case "setMeta": result = setMeta_(payload); break;
      case "clearAll": result = clearAll_(); break;
      default: result = { error: "Unknown action: " + action };
    }
  } catch (err){
    result = { error: String(err) };
  }
  return jsonOut_(result);
}

function jsonOut_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============ Sales ============ */

function addSales_(payload){
  const records = payload.records || [];
  if (!records.length) return { count: 0 };
  const sheet = getSheet_("sales");
  const rows = records.map(r => [
    Utilities.getUuid(), r.uploadId || "", r.date || "", r.period || "",
    r.store || "", r.salesperson || "", r.qty || 0, r.bill || ""
  ]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return { count: rows.length };
}

function deleteSalesByUpload_(payload){
  const uploadId = payload.uploadId;
  const sheet = getSheet_("sales");
  const values = sheet.getDataRange().getValues();
  const keepRows = [values[0]];
  for (let i = 1; i < values.length; i++){
    if (String(values[i][1]) !== String(uploadId)) keepRows.push(values[i]);
  }
  sheet.clearContents();
  sheet.getRange(1, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
  return { ok: true };
}

/* ============ Targets (upsert by key) ============ */

function putTargets_(payload){
  const records = payload.records || [];
  const sheet = getSheet_("targets");
  const values = sheet.getDataRange().getValues();
  const keyCol = 0;
  const keyIndex = {};
  for (let i = 1; i < values.length; i++) keyIndex[String(values[i][keyCol])] = i + 1;

  records.forEach(r => {
    const row = [r.key, r.store || "", r.salesperson || "", r.period || "", r.target || 0];
    const existingRow = keyIndex[String(r.key)];
    if (existingRow){
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
      keyIndex[String(r.key)] = sheet.getLastRow();
    }
  });
  return { count: records.length };
}

function deleteTarget_(payload){
  const sheet = getSheet_("targets");
  const rowIdx = findRowIndexByValue_(sheet, 0, payload.key);
  if (rowIdx > 0) sheet.deleteRow(rowIdx);
  return { ok: true };
}

/* ============ Uploads ============ */

function addUpload_(payload){
  const sheet = getSheet_("uploads");
  const id = Utilities.getUuid();
  sheet.appendRow([id, payload.file || "", payload.rows || 0, payload.uploadedAt || new Date().toISOString(), payload.type || "sales"]);
  return { id };
}

function deleteUpload_(payload){
  const sheet = getSheet_("uploads");
  const rowIdx = findRowIndexByValue_(sheet, 0, payload.id);
  if (rowIdx > 0) sheet.deleteRow(rowIdx);
  return { ok: true };
}

/* ============ Meta ============ */

function setMeta_(payload){
  const sheet = getSheet_("meta");
  const rowIdx = findRowIndexByValue_(sheet, 0, payload.key);
  if (rowIdx > 0){
    sheet.getRange(rowIdx, 2).setValue(payload.value);
  } else {
    sheet.appendRow([payload.key, payload.value]);
  }
  return { ok: true };
}

/* ============ Clearing ============ */

function clearSheet_(kind){
  const sheet = getSheet_(kind);
  const headers = SHEETS[kind].headers;
  sheet.clearContents();
  sheet.appendRow(headers);
  sheet.setFrozenRows(1);
  return { ok: true };
}

function clearAll_(){
  clearSheet_("sales");
  clearSheet_("targets");
  clearSheet_("uploads");
  clearSheet_("meta");
  return { ok: true };
}
