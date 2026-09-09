// Reads a File (csv/xlsx/xls) into { headers: [...], rows: [ {header: value, ...} ] }
export function readFile(file){
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "csv"){
    return new Promise((resolve, reject) => {
      window.Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        complete: (res) => {
          const headers = res.meta.fields || [];
          resolve({ headers, rows: res.data });
        },
        error: reject
      });
    });
  }
  // xlsx / xls
  return file.arrayBuffer().then(buf => {
    const wb = window.XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return { headers, rows };
  });
}

// Try to guess which source header matches a target field, by loose name matching
const GUESS_MAP = {
  date: ["date", "bill date", "sale date", "txn date", "invoice date"],
  store: ["store", "branch", "outlet", "location", "shop"],
  salesperson: ["salesperson", "sales person", "staff", "employee", "sold by", "executive", "sales executive", "name"],
  amount: ["amount", "sale amount", "net amount", "total", "sales value", "bill amount", "value"],
  qty: ["qty", "quantity", "units", "pieces", "pcs"],
  bill: ["bill no", "bill number", "invoice no", "invoice", "bill", "receipt no"],
  target: ["target", "sales target", "monthly target"],
  period: ["period", "month", "target month"]
};

export function guessMapping(headers, fields){
  const mapping = {};
  for (const field of fields){
    const candidates = GUESS_MAP[field] || [field];
    let found = "";
    for (const h of headers){
      const hLower = h.toLowerCase().trim();
      if (candidates.some(c => hLower === c || hLower.includes(c))){
        found = h; break;
      }
    }
    mapping[field] = found;
  }
  return mapping;
}

function parseDateValue(v){
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === "number"){
    // excel serial date
    const d = window.XLSX ? window.XLSX.SSF.parse_date_code(v) : null;
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
  }
  if (typeof v === "string"){
    const s = v.trim();
    // try dd-mm-yyyy or dd/mm/yyyy first (common in Indian exports)
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

// Normalize raw rows into sales records using confirmed mapping
export function buildSalesRecords(rows, mapping, uploadId){
  const out = [];
  let skipped = 0;
  for (const row of rows){
    const rawDate = mapping.date ? row[mapping.date] : "";
    const dateObj = parseDateValue(rawDate);
    const store = mapping.store ? String(row[mapping.store] || "").trim() : "Main";
    const salesperson = mapping.salesperson ? String(row[mapping.salesperson] || "").trim() : "";
    const amount = mapping.amount ? cleanNumber(row[mapping.amount]) : 0;
    if (!dateObj || !salesperson || !amount){ skipped++; continue; }
    out.push({
      uploadId,
      date: dateObj.toISOString().slice(0, 10),
      period: toPeriod(dateObj),
      store: store || "Main",
      salesperson,
      amount,
      qty: mapping.qty ? cleanNumber(row[mapping.qty]) : 0,
      bill: mapping.bill ? String(row[mapping.bill] || "") : ""
    });
  }
  return { records: out, skipped };
}

// Normalize raw rows into target records using confirmed mapping.
// metric: "amount" (₹ sales value) or "qty" (units) — which basis this batch of targets is set on.
export function buildTargetRecords(rows, mapping, metric = "amount"){
  const out = [];
  let skipped = 0;
  for (const row of rows){
    const store = mapping.store ? String(row[mapping.store] || "").trim() : "Main";
    const salesperson = mapping.salesperson ? String(row[mapping.salesperson] || "").trim() : "";
    const target = mapping.target ? cleanNumber(row[mapping.target]) : 0;
    let period = mapping.period ? String(row[mapping.period] || "").trim() : "";
    // normalize period to YYYY-MM if it looks like a date
    const asDate = parseDateValue(period);
    if (asDate) period = toPeriod(asDate);
    if (!salesperson || !target || !period){ skipped++; continue; }
    out.push({
      key: `${store}|${salesperson}|${period}|${metric}`,
      store: store || "Main",
      salesperson,
      period,
      target,
      metric
    });
  }
  return { records: out, skipped };
}
