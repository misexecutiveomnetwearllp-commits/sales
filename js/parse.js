// Reads a File (csv/xlsx/xls) into a raw matrix: array of arrays of cell
// values, exactly as they appear in the file — no header assumption yet.
export function readFileMatrix(file){
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "csv"){
    return new Promise((resolve, reject) => {
      window.Papa.parse(file, {
        header: false,
        skipEmptyLines: "greedy",
        complete: (res) => resolve(res.data),
        error: reject
      });
    });
  }
  // xlsx / xls
  return file.arrayBuffer().then(buf => {
    const wb = window.XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    return window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false });
  });
}

// Converts a File to a base64 string, for handing off to the backend to
// store as-is (chunked to avoid call-stack limits on large files).
export function fileToBase64(file){
  return file.arrayBuffer().then(buf => {
    const bytes = new Uint8Array(buf);
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize){
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  });
}

// Rebuilds a raw matrix from a base64 string + filename — used when
// re-loading a previously uploaded file from the backend, without the
// user needing to pick the file from disk again.
export function matrixFromBase64(base64, filename){
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (ext === "csv"){
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const text = new TextDecoder("utf-8").decode(bytes);
    const result = window.Papa.parse(text, { header: false, skipEmptyLines: "greedy" });
    return result.data;
  }
  const wb = window.XLSX.read(base64, { type: "base64", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  return window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false });
}

const HEADER_KEYWORDS = [
  "date", "store", "branch", "outlet", "location", "shop",
  "salesperson", "sales person", "staff", "employee", "sold by", "executive", "name",
  "qty", "quantity", "units", "pieces", "pcs",
  "bill", "invoice", "receipt", "period", "month", "target"
];

// Scans the first `maxScan` rows and guesses which one is the header row —
// the row with the most non-empty, non-numeric, header-keyword-like cells.
export function detectHeaderRow(matrix, maxScan = 15){
  let best = 0, bestScore = -Infinity;
  const scanLimit = Math.min(maxScan, matrix.length);
  for (let i = 0; i < scanLimit; i++){
    const row = matrix[i] || [];
    let nonEmpty = 0, numeric = 0, keywordHits = 0;
    for (const cell of row){
      const s = String(cell ?? "").trim();
      if (!s) continue;
      nonEmpty++;
      if (/^-?\d+(\.\d+)?$/.test(s)) numeric++;
      const low = s.toLowerCase();
      if (HEADER_KEYWORDS.some(k => low.includes(k))) keywordHits++;
    }
    if (nonEmpty < 2) continue; // skip blank / near-blank rows (titles, gaps)
    const score = nonEmpty - numeric * 1.5 + keywordHits * 3;
    if (score > bestScore){ bestScore = score; best = i; }
  }
  return best;
}

// headers: [{ index, label, included }] — editable by the user before confirming
export function extractHeaders(matrix, headerRowIndex){
  const headerRow = matrix[headerRowIndex] || [];
  const nextRows = matrix.slice(headerRowIndex + 1, headerRowIndex + 6);
  const width = Math.max(headerRow.length, ...nextRows.map(r => r.length), 1);
  const headers = [];
  for (let i = 0; i < width; i++){
    const raw = String(headerRow[i] ?? "").trim();
    headers.push({ index: i, label: raw || `Column ${i + 1}`, included: true });
  }
  return headers;
}

export function extractDataRows(matrix, headerRowIndex){
  return matrix.slice(headerRowIndex + 1).filter(row => row.some(c => String(c ?? "").trim() !== ""));
}

// Row label for the "which row is the header?" picker in the mapping modal
export function rowPreviewLabel(row){
  const cells = (row || []).map(c => String(c ?? "").trim()).filter(Boolean).slice(0, 5);
  return cells.length ? cells.join(" \u00B7 ") : "(blank row)";
}

const GUESS_MAP = {
  date: ["date", "bill date", "sale date", "txn date", "invoice date"],
  store: ["store", "branch", "outlet", "location", "shop"],
  salesperson: ["salesperson", "sales person", "staff", "employee", "sold by", "executive", "sales executive", "name"],
  qty: ["qty", "quantity", "units", "pieces", "pcs"],
  bill: ["bill no", "bill number", "invoice no", "invoice", "bill", "receipt no"],
  target: ["target", "sales target", "monthly target", "qty target"],
  period: ["period", "month", "target month"]
};

// Guess field -> column index from (editable) header labels
export function guessMapping(headers, fields){
  const mapping = {};
  for (const field of fields){
    const candidates = GUESS_MAP[field] || [field];
    let found = "";
    for (const h of headers){
      if (!h.included) continue;
      const low = h.label.toLowerCase().trim();
      if (candidates.some(c => low === c || low.includes(c))){ found = h.index; break; }
    }
    mapping[field] = found;
  }
  return mapping;
}

function parseDateValue(v){
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === "number"){
    const d = window.XLSX ? window.XLSX.SSF.parse_date_code(v) : null;
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
  }
  if (typeof v === "string"){
    const s = v.trim();
    let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m){
      let [, d, mo, y] = m;
      if (y.length === 2) y = "20" + y;
      const dt = new Date(Number(y), Number(mo) - 1, Number(d));
      if (!isNaN(dt)) return dt;
    }
    const dt2 = new Date(s);
    if (!isNaN(dt2)) return dt2;
  }
  return null;
}

export function toPeriod(dateObj){
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function cleanNumber(v){
  if (typeof v === "number") return v;
  if (!v) return 0;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

// mapping values are column indices (numbers) or "" when unmapped
function cell(row, idx){
  return idx === "" || idx === undefined ? "" : row[idx];
}

// Normalize raw data rows into sales records. Quantity is the tracked
// figure — no price/amount involved.
export function buildSalesRecords(dataRows, mapping, uploadId){
  const out = [];
  let skipped = 0;
  for (const row of dataRows){
    const dateObj = parseDateValue(cell(row, mapping.date));
    const store = String(cell(row, mapping.store) || "").trim();
    const salesperson = String(cell(row, mapping.salesperson) || "").trim();
    const qty = cleanNumber(cell(row, mapping.qty));
    if (!dateObj || !salesperson || !qty){ skipped++; continue; }
    out.push({
      uploadId,
      date: dateObj.toISOString().slice(0, 10),
      period: toPeriod(dateObj),
      store: store || "Main",
      salesperson,
      qty,
      bill: String(cell(row, mapping.bill) || "")
    });
  }
  return { records: out, skipped };
}

export function buildTargetRecords(dataRows, mapping){
  const out = [];
  let skipped = 0;
  for (const row of dataRows){
    const store = String(cell(row, mapping.store) || "").trim();
    const salesperson = String(cell(row, mapping.salesperson) || "").trim();
    const target = cleanNumber(cell(row, mapping.target));
    let period = String(cell(row, mapping.period) || "").trim();
    const asDate = parseDateValue(period);
    if (asDate) period = toPeriod(asDate);
    if (!salesperson || !target || !period){ skipped++; continue; }
    out.push({
      key: `${store || "Main"}|${salesperson}|${period}`,
      store: store || "Main",
      salesperson,
      period,
      target
    });
  }
  return { records: out, skipped };
}
