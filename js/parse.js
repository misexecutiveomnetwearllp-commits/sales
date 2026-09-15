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
    // A real header row has distinct text labels. Penalise rows that look
    // like data (dates, mostly numbers) or that repeat the same value.
    let dateLike = 0;
    const seen = new Set();
    for (const cell of row){
      const s = String(cell ?? "").trim();
      if (!s) continue;
      seen.add(s.toLowerCase());
      if (/\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}/.test(s)) dateLike++;
    }
    const duplicates = nonEmpty - seen.size;
    const score = nonEmpty
      - numeric * 2
      - dateLike * 4
      - duplicates * 2
      + keywordHits * 4;
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

/* ------------------------------------------------------------------
   Column matching.

   The old version took the FIRST header containing a candidate word,
   which meant "Item Name" / "Customer Name" won the Salesperson slot
   before the real "Salesman" column was ever reached, and "Qty Free"
   or "Closing Qty" could win Quantity. Now every header is SCORED
   against every field, negative words push a header away from a field,
   and the best pairs are assigned greedily so no column is used twice.
   ------------------------------------------------------------------ */

// weight: how strong a signal this phrase is for the field
const FIELD_RULES = {
  date: {
    positive: [["bill date", 16], ["invoice date", 16], ["sale date", 16], ["sales date", 16],
               ["txn date", 14], ["transaction date", 14], ["voucher date", 14], ["date", 10]],
    negative: ["due", "birth", "dob", "joining", "join", "expiry", "expire", "updated", "modified", "created", "delivery"]
  },
  store: {
    positive: [["store name", 16], ["branch name", 16], ["store", 13], ["branch", 13], ["outlet", 13],
               ["showroom", 13], ["location", 9], ["shop", 9], ["site", 6]],
    negative: ["code", "id", "address", "item", "product"]
  },
  salesperson: {
    positive: [["salesperson", 18], ["sales person", 18], ["sales man", 17], ["salesman", 17],
               ["sales executive", 17], ["sales rep", 16], ["sold by", 16], ["created by", 8],
               ["executive", 11], ["employee name", 16], ["staff name", 16], ["employee", 11],
               ["staff", 11], ["agent", 10], ["cashier", 10], ["counter", 7], ["emp name", 15]],
    // these are the killers — "Item Name", "Customer Name" etc must never win
    negative: ["item", "product", "customer", "party", "client", "company", "category", "brand",
               "supplier", "vendor", "account", "model", "sku", "material", "description", "godown"]
  },
  qty: {
    positive: [["qty sold", 18], ["quantity sold", 18], ["sold qty", 18], ["net qty", 16],
               ["sale qty", 16], ["quantity", 13], ["qty", 12], ["units", 12], ["pieces", 12],
               ["pcs", 12], ["nos", 8]],
    negative: ["free", "return", "cancel", "balance", "stock", "opening", "closing", "rate",
               "price", "amount", "value", "damage", "reject", "order", "pending", "alt", "mrp"]
  },
  bill: {
    positive: [["bill no", 18], ["bill number", 18], ["invoice no", 18], ["invoice number", 18],
               ["receipt no", 17], ["voucher no", 16], ["bill#", 16], ["doc no", 12],
               ["invoice", 10], ["bill", 9]],
    negative: ["date", "amount", "value", "address", "type", "status", "qty"]
  },
  target: {
    positive: [["qty target", 18], ["target qty", 18], ["monthly target", 18], ["sales target", 18],
               ["commission qty", 18], ["target", 13], ["commission", 12], ["goal", 10], ["budget", 9]],
    negative: ["actual", "achieved", "achievement", "%", "percent", "variance", "gap"]
  },
  period: {
    positive: [["target month", 18], ["period", 14], ["month year", 16], ["month", 12], ["yyyy-mm", 15], ["mmm-yy", 14]],
    negative: ["day", "date of", "week"]
  }
};

const MIN_SCORE = 8; // below this we'd rather leave it blank than guess wrong

function normLabel(s){
  return String(s ?? "").toLowerCase().replace(/[_\-./\\]+/g, " ").replace(/\s+/g, " ").trim();
}

// How well does one header label fit one field?
function scoreHeader(label, field){
  const low = normLabel(label);
  if (!low || /^column \d+$/.test(low)) return -Infinity;
  const rules = FIELD_RULES[field];
  if (!rules) return low === field ? 20 : -Infinity;

  let best = -Infinity;
  for (const [phrase, weight] of rules.positive){
    const p = normLabel(phrase);
    let s = -Infinity;
    if (low === p) s = weight + 25;                                   // exact heading — strongest
    else if (new RegExp(`(^|\\s)${escapeRe(p)}($|\\s)`).test(low)) s = weight + 10; // whole word(s)
    else if (low.startsWith(p) || low.endsWith(p)) s = weight + 4;
    else if (low.includes(p)) s = weight - 4;                          // loose substring — weakest
    if (s > best) best = s;
  }
  if (best === -Infinity) return -Infinity;

  // Negative words: a header like "Item Name" must lose the salesperson slot
  for (const nWord of rules.negative){
    const n = normLabel(nWord);
    if (n && low.includes(n)) best -= 30;
  }
  return best;
}

function escapeRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**
 * Guess field -> column index from (editable) header labels.
 * Scores every (field, header) pair, then assigns the highest-scoring
 * pairs first, so a column can only ever be claimed by one field.
 */
export function guessMapping(headers, fields){
  const mapping = {};
  fields.forEach(f => { mapping[f] = ""; });

  const pairs = [];
  for (const field of fields){
    for (const h of headers){
      if (!h.included) continue;
      const score = scoreHeader(h.label, field);
      if (score >= MIN_SCORE) pairs.push({ field, index: h.index, score });
    }
  }
  // Highest score first; ties broken by leftmost column (usually the primary one)
  pairs.sort((a, b) => b.score - a.score || a.index - b.index);

  const takenFields = new Set();
  const takenCols = new Set();
  for (const p of pairs){
    if (takenFields.has(p.field) || takenCols.has(p.index)) continue;
    mapping[p.field] = p.index;
    takenFields.add(p.field);
    takenCols.add(p.index);
  }

  // Last resort for Quantity: if nothing matched by name, take the column
  // that actually looks like small whole numbers in the data.
  return mapping;
}

/**
 * Refines a mapping using the actual data rows, not just the headings.
 * Only fills fields the header pass left blank, and only when the
 * evidence in the column is strong — so it can't override a good guess.
 */
export function refineMappingWithData(mapping, headers, dataRows, fields){
  const sample = dataRows.slice(0, 60);
  if (!sample.length) return mapping;
  const used = new Set(Object.values(mapping).filter(v => v !== ""));
  const available = headers.filter(h => h.included && !used.has(h.index));

  const colStats = available.map(h => {
    let dates = 0, numbers = 0, texts = 0, filled = 0;
    const distinct = new Set();
    for (const row of sample){
      const v = row[h.index];
      const s = String(v ?? "").trim();
      if (!s) continue;
      filled++;
      distinct.add(s);
      if (parseDateValue(v)) dates++;
      else if (/^-?[\d,]+(\.\d+)?$/.test(s)) numbers++;
      else texts++;
    }
    return { index: h.index, dates, numbers, texts, filled, distinct: distinct.size };
  }).filter(c => c.filled >= Math.min(5, sample.length));

  const pick = (field, test) => {
    if (mapping[field] !== "" || !fields.includes(field)) return;
    const hit = colStats.find(c => !used.has(c.index) && test(c));
    if (hit){ mapping[field] = hit.index; used.add(hit.index); }
  };

  // A date column: almost every filled cell parses as a date
  pick("date", c => c.dates / c.filled > 0.8);
  // A quantity column: numeric, and not a huge-cardinality id-looking column
  pick("qty", c => c.numbers / c.filled > 0.9);
  // A salesperson column: repeating text values (few distinct names, many rows)
  pick("salesperson", c => c.texts / c.filled > 0.8 && c.distinct <= Math.max(3, c.filled * 0.5));

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
