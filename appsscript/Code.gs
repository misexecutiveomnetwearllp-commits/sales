/**
 * Ledger — Sales Performance backend.
 * Deploy as a Web App (Execute as: Me, Who has access: Anyone).
 *
 * Sales data is NOT written row-by-row into the Sheet. Each uploaded file
 * is stored as-is in a Drive folder, along with the column mapping you
 * confirmed on upload; the site re-downloads and re-parses that file in
 * the browser every time it loads, so opening it from any browser/device
 * shows the same data until you remove the file.
 *
 * Targets (typed in or imported on the Targets tab) ARE stored as rows,
 * since they're edited cell-by-cell in the app.
 *
 * IMPORTANT: paste your Google Sheet's ID below before deploying.
 * Find it in the Sheet's URL: docs.google.com/spreadsheets/d/<THIS PART>/edit
 * (Web apps have no "active spreadsheet", so this can't be done automatically.)
 */
const SPREADSHEET_ID = "PASTE_YOUR_SPREADSHEET_ID_HERE";

const SHEETS = {
  files: { name: "Files", headers: ["id", "name", "driveFileId", "uploadedAt", "type", "headerRowIndex", "mapping", "rows"] },
  targets: { name: "Targets", headers: ["key", "store", "salesperson", "period", "target"] },
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

function getFilesFolder_(){
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty("filesFolderId");
  if (folderId){
    try { return DriveApp.getFolderById(folderId); } catch (e){ /* recreate below */ }
  }
  const folder = DriveApp.createFolder("Ledger Sales Performance Files");
  props.setProperty("filesFolderId", folder.getId());
  return folder;
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
        files: sheetToObjects_(getSheet_("files")),
        targets: sheetToObjects_(getSheet_("targets")),
        meta
      };
    } else if (action === "getFileContent"){
      result = getFileContent_(e.parameter.id);
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
      case "uploadFile": result = uploadFile_(payload); break;
      case "deleteFile": result = deleteFile_(payload); break;
      case "clearFiles": result = clearFiles_(); break;
      case "putTargets": result = putTargets_(payload); break;
      case "deleteTarget": result = deleteTarget_(payload); break;
      case "clearTargets": result = clearSheet_("targets"); break;
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

/* ============ Files (Drive-backed) ============ */

function uploadFile_(payload){
  const folder = getFilesFolder_();
  const bytes = Utilities.base64Decode(payload.base64);
  const blob = Utilities.newBlob(bytes, payload.mimeType || "application/octet-stream", payload.name || "upload");
  const driveFile = folder.createFile(blob);
  const id = Utilities.getUuid();
  const sheet = getSheet_("files");
  sheet.appendRow([
    id,
    payload.name || "",
    driveFile.getId(),
    payload.uploadedAt || new Date().toISOString(),
    payload.type || "sales",
    (payload.headerRowIndex === undefined || payload.headerRowIndex === null) ? "" : payload.headerRowIndex,
    payload.mapping ? JSON.stringify(payload.mapping) : "",
    payload.rows || 0
  ]);
  return { id };
}

function getFileContent_(id){
  const sheet = getSheet_("files");
  const rowIdx = findRowIndexByValue_(sheet, 0, id);
  if (rowIdx < 0) return { error: "File not found" };
  const values = sheet.getDataRange().getValues();
  const row = values[rowIdx - 1];
  const driveFileId = row[2];
  const file = DriveApp.getFileById(driveFileId);
  const bytes = file.getBlob().getBytes();
  return { name: row[1], base64: Utilities.base64Encode(bytes) };
}

function deleteFile_(payload){
  const sheet = getSheet_("files");
  const rowIdx = findRowIndexByValue_(sheet, 0, payload.id);
  if (rowIdx > 0){
    const values = sheet.getDataRange().getValues();
    const driveFileId = values[rowIdx - 1][2];
    try { DriveApp.getFileById(driveFileId).setTrashed(true); } catch (e){ /* already gone */ }
    sheet.deleteRow(rowIdx);
  }
  return { ok: true };
}

function clearFiles_(){
  const sheet = getSheet_("files");
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++){
    try { DriveApp.getFileById(values[i][2]).setTrashed(true); } catch (e){ /* already gone */ }
  }
  return clearSheet_("files");
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
  clearFiles_();
  clearSheet_("targets");
  clearSheet_("meta");
  return { ok: true };
}
