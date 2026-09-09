import { DB } from "./db.js";
import { readFile, guessMapping, buildSalesRecords, buildTargetRecords } from "./parse.js";
import { filterSales, filterTargets, aggregateByPerson, aggregateByStore, totals, previousPeriod, nextPeriod, generateInsights, sumActual } from "./insights.js";
import { renderTrendChart } from "./charts.js";

/* ============ State ============ */
const state = {
  sales: [],
  targets: [],
  uploads: [],
  store: "__all__",
  period: "__all__",
  metric: "amount", // "amount" (₹ sale value) or "qty" (units sold) — which basis targets are measured on
  growthRate: 10,
  peopleSort: { key: "actual", dir: "desc" },
  pendingMap: null // { type: 'sales'|'targets', headers, rows, fields }
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const inr = (n) => "\u20B9" + Math.round(n || 0).toLocaleString("en-IN");
const qtyFmt = (n) => Math.round(n || 0).toLocaleString("en-IN") + " pcs";
const fmtVal = (n, metric = state.metric) => metric === "qty" ? qtyFmt(n) : inr(n);
const pct = (n) => (n === null || n === undefined) ? "\u2014" : Math.round(n) + "%";

function toast(msg){
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-shown");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("is-shown"), 2600);
}

/* ============ Boot ============ */
async function boot(){
  state.sales = await DB.getAllSales();
  state.targets = await DB.getAllTargets();
  state.uploads = await DB.getAllUploads();
  state.growthRate = await DB.getMeta("growthRate", 10);
  $("#growthRate").value = state.growthRate;
  state.metric = await DB.getMeta("metric", "amount");
  $("#filterMetric").value = state.metric;

  wireNav();
  wireTopbar();
  wireUpload();
  wireTargetsView();
  wireDataView();
  wireModals();

  refreshFilters();
  renderAll();
}

/* ============ Nav ============ */
function wireNav(){
  $$(".rail-link").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".rail-link").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const view = btn.dataset.view;
      $$(".view").forEach(v => v.classList.toggle("is-active", v.dataset.view === view));
      if (view === "people") renderPeople();
      if (view === "targets") renderTargets();
      if (view === "data") renderDataView();
    });
  });
}

function goToView(view){
  $$(".rail-link").forEach(b => b.classList.toggle("is-active", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("is-active", v.dataset.view === view));
}

/* ============ Topbar filters ============ */
function refreshFilters(){
  const stores = [...new Set([...state.sales.map(r => r.store), ...state.targets.map(r => r.store)])].sort();
  const periods = [...new Set([...state.sales.map(r => r.period), ...state.targets.map(r => r.period)])].sort().reverse();

  const storeSel = $("#filterStore");
  const curStore = storeSel.value || "__all__";
  storeSel.innerHTML = `<option value="__all__">All stores</option>` +
    stores.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
  storeSel.value = stores.includes(curStore) ? curStore : "__all__";
  state.store = storeSel.value;

  const periodSel = $("#filterPeriod");
  const curPeriod = periodSel.value || "__all__";
  periodSel.innerHTML = `<option value="__all__">All periods</option>` +
    periods.map(p => `<option value="${p}">${formatPeriod(p)}</option>`).join("");
  periodSel.value = periods.includes(curPeriod) ? curPeriod : "__all__";
  state.period = periodSel.value;

  $("#railRecordCount").textContent = `${state.sales.length.toLocaleString("en-IN")} record${state.sales.length === 1 ? "" : "s"} loaded`;
  const peopleCount = new Set(state.sales.map(r => r.salesperson)).size;
  $("#railStoreCount").textContent = `${stores.length} store${stores.length === 1 ? "" : "s"} \u00B7 ${peopleCount} people`;
}

function wireTopbar(){
  $("#filterStore").addEventListener("change", (e) => { state.store = e.target.value; renderAll(); });
  $("#filterPeriod").addEventListener("change", (e) => { state.period = e.target.value; renderAll(); });
  $("#filterMetric").addEventListener("change", async (e) => {
    state.metric = e.target.value;
    await DB.setMeta("metric", state.metric);
    renderAll();
  });
  $("#quickUploadBtn").addEventListener("click", () => { goToView("data"); $("#fileInput").click(); });
  $("#exportBtn").addEventListener("click", exportData);
}

function formatPeriod(p){
  if (p === "__all__") return "All periods";
  const [y, m] = p.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[Number(m) - 1]} ${y}`;
}

/* ============ Render orchestration ============ */
function renderAll(){
  renderDashboard();
  const activeView = $(".rail-link.is-active")?.dataset.view;
  if (activeView === "people") renderPeople();
  if (activeView === "targets") renderTargets();
}

/* ============ Dashboard ============ */
function renderDashboard(){
  const sales = filterSales(state.sales, state.store, state.period);
  const targets = filterTargets(state.targets, state.store, state.period);

  const hasData = state.sales.length > 0;
  $("#dashboardEmpty").classList.toggle("hidden", hasData);
  $("#dashboardBody").classList.toggle("hidden", !hasData);
  if (!hasData) return;

  const personRows = aggregateByPerson(sales, targets, state.metric);
  const storeRows = aggregateByStore(sales, targets, state.metric);
  const t = totals(personRows);
  const achvPct = t.target ? (t.actual / t.target) * 100 : null;

  // Ring
  const circumference = 377;
  const clamped = Math.max(0, Math.min(100, achvPct ?? 0));
  $("#heroRingFill").style.strokeDashoffset = String(circumference * (1 - clamped / 100));
  $("#heroRingPct").textContent = achvPct === null ? "\u2014" : pct(achvPct);
  $("#heroAchieved").textContent = fmtVal(t.actual);
  $("#heroTarget").textContent = t.target ? fmtVal(t.target) : "Not set";
  $("#heroGap").textContent = t.target ? fmtVal(Math.max(0, t.target - t.actual)) : "\u2014";

  const withTarget = personRows.filter(r => r.target > 0);
  $("#statAbove").textContent = withTarget.filter(r => r.achv >= 100).length;
  $("#statBelow").textContent = withTarget.filter(r => r.achv < 80).length;
  const bestStore = [...storeRows].filter(s => s.target > 0).sort((a, b) => b.achv - a.achv)[0];
  $("#statBestStore").textContent = bestStore ? bestStore.store : "\u2014";

  // vs previous period
  const prev = previousPeriod(state.period);
  if (prev){
    const prevSales = filterSales(state.sales, state.store, prev);
    const prevTotal = sumActual(prevSales, state.metric);
    if (prevTotal > 0){
      const delta = ((t.actual - prevTotal) / prevTotal) * 100;
      $("#statVsPrev").textContent = (delta >= 0 ? "+" : "") + Math.round(delta) + "%";
    } else {
      $("#statVsPrev").textContent = "\u2014";
    }
  } else {
    $("#statVsPrev").textContent = "\u2014";
  }

  // Store bars
  const barsEl = $("#storeBars");
  if (!storeRows.length){
    barsEl.innerHTML = `<p class="ledger-empty">No store data for this selection.</p>`;
  } else {
    barsEl.innerHTML = storeRows.map(s => {
      const p = s.achv === null ? 0 : Math.min(150, s.achv);
      const under = s.achv !== null && s.achv < 100;
      return `
        <div class="bar-row">
          <span>${escapeHtml(s.store)}</span>
          <div class="bar-track"><div class="bar-fill ${under ? "is-under" : ""}" style="width:${Math.min(100, p)}%"></div></div>
          <span class="bar-pct">${s.achv === null ? "no target" : pct(s.achv)}</span>
        </div>`;
    }).join("");
  }

  // Needs attention / top performers
  const withT = personRows.filter(r => r.target > 0);
  const below80 = [...withT].filter(r => r.achv < 80).sort((a, b) => a.achv - b.achv).slice(0, 6);
  const top = [...withT].sort((a, b) => b.achv - a.achv).slice(0, 6);

  $("#tableNeedsAttention tbody").innerHTML = below80.map(rowToPersonTr).join("");
  $("#needsAttentionEmpty").classList.toggle("hidden", below80.length > 0);
  $("#tableTopPerformers tbody").innerHTML = top.map(rowToPersonTr).join("");

  $$("#tableNeedsAttention tbody tr, #tableTopPerformers tbody tr").forEach(tr => {
    tr.addEventListener("click", () => openDrawer(tr.dataset.name, tr.dataset.store));
  });

  // Insights
  const insights = generateInsights(personRows, storeRows, state.growthRate);
  $("#insightsList").innerHTML = insights.map(i => `<li>${escapeHtml(i)}</li>`).join("");
}

function rowToPersonTr(r){
  const tagClass = r.achv >= 100 ? "tag-good" : r.achv >= 80 ? "tag-mid" : "tag-bad";
  return `<tr data-name="${escapeAttr(r.salesperson)}" data-store="${escapeAttr(r.store)}">
    <td>${escapeHtml(r.salesperson)}</td>
    <td>${escapeHtml(r.store)}</td>
    <td><span class="tag ${tagClass}">${pct(r.achv)}</span></td>
  </tr>`;
}

/* ============ People view ============ */
function renderPeople(){
  const sales = filterSales(state.sales, state.store, state.period);
  const targets = filterTargets(state.targets, state.store, state.period);
  let rows = aggregateByPerson(sales, targets, state.metric);

  const q = $("#peopleSearch").value.trim().toLowerCase();
  if (q) rows = rows.filter(r => r.salesperson.toLowerCase().includes(q));

  const { key, dir } = state.peopleSort;
  rows.sort((a, b) => {
    let av = key === "name" ? a.salesperson : key === "store" ? a.store : key === "achv" ? (a.achv ?? -1) : a[key];
    let bv = key === "name" ? b.salesperson : key === "store" ? b.store : key === "achv" ? (b.achv ?? -1) : b[key];
    if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === "asc" ? av - bv : bv - av;
  });

  $("#peopleEmpty").classList.toggle("hidden", rows.length > 0);
  $("#peopleTable tbody").innerHTML = rows.map(r => `
    <tr data-name="${escapeAttr(r.salesperson)}" data-store="${escapeAttr(r.store)}">
      <td>${escapeHtml(r.salesperson)}</td>
      <td>${escapeHtml(r.store)}</td>
      <td>${fmtVal(r.actual)}</td>
      <td>${r.target ? fmtVal(r.target) : "\u2014"}</td>
      <td>${r.target ? `<span class="tag ${r.achv >= 100 ? "tag-good" : r.achv >= 80 ? "tag-mid" : "tag-bad"}">${pct(r.achv)}</span>` : "\u2014"}</td>
      <td>${r.bills || "\u2014"}</td>
      <td>${r.avgBill ? inr(r.avgBill) : "\u2014"}</td>
    </tr>`).join("");

  $$("#peopleTable tbody tr").forEach(tr => {
    tr.addEventListener("click", () => openDrawer(tr.dataset.name, tr.dataset.store));
  });
}

function wirePeopleView(){
  $("#peopleSearch").addEventListener("input", renderPeople);
  $$("#peopleTable thead th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.peopleSort.key === key){
        state.peopleSort.dir = state.peopleSort.dir === "asc" ? "desc" : "asc";
      } else {
        state.peopleSort = { key, dir: "desc" };
      }
      renderPeople();
    });
  });
}

/* ============ Drawer (salesperson detail) ============ */
function openDrawer(name, store){
  const personSales = state.sales.filter(r => r.salesperson === name && r.store === store);
  const personTargets = state.targets.filter(r => r.salesperson === name && r.store === store && (r.metric || "amount") === state.metric);
  const periods = [...new Set([...personSales.map(r => r.period), ...personTargets.map(r => r.period)])].sort();

  $("#drawerName").textContent = `${name} \u00B7 ${store}`;
  const points = periods.map(p => ({
    label: p,
    actual: sumActual(personSales.filter(r => r.period === p), state.metric),
    target: personTargets.filter(r => r.period === p).reduce((a, r) => a + r.target, 0)
  }));

  const totalActual = points.reduce((a, p) => a + p.actual, 0);
  const totalTarget = points.reduce((a, p) => a + p.target, 0);

  const body = $("#drawerBody");
  body.innerHTML = `
    <div class="hero-stats" style="grid-template-columns: 1fr 1fr 1fr; margin-bottom:18px;">
      <div class="stat-card"><span class="stat-label">Total actual</span><span class="stat-val">${fmtVal(totalActual)}</span></div>
      <div class="stat-card"><span class="stat-label">Total target</span><span class="stat-val">${totalTarget ? fmtVal(totalTarget) : "\u2014"}</span></div>
      <div class="stat-card"><span class="stat-label">Achievement</span><span class="stat-val">${totalTarget ? pct((totalActual / totalTarget) * 100) : "\u2014"}</span></div>
    </div>
    <h4 style="font-size:13.5px;margin-bottom:8px;">Period trend</h4>
    <div class="drawer-sparkline" id="drawerChart"></div>
    <h4 style="font-size:13.5px;margin:18px 0 8px;">By period</h4>
    <table class="ledger">
      <thead><tr><th>Period</th><th>Actual</th><th>Target</th><th>Achv.</th></tr></thead>
      <tbody>
        ${points.slice().reverse().map(p => `
          <tr>
            <td>${formatPeriod(p.label)}</td>
            <td>${fmtVal(p.actual)}</td>
            <td>${p.target ? fmtVal(p.target) : "\u2014"}</td>
            <td>${p.target ? pct((p.actual / p.target) * 100) : "\u2014"}</td>
          </tr>`).join("")}
      </tbody>
    </table>
  `;
  renderTrendChart($("#drawerChart"), points);
  $("#drawerBackdrop").classList.remove("hidden");
}

/* ============ Targets view ============ */
function renderTargets(){
  const sales = filterSales(state.sales, state.store, state.period);
  const targets = filterTargets(state.targets, state.store, state.period);
  const rows = aggregateByPerson(sales, targets, state.metric).filter(r => r.target > 0 || r.actual > 0);

  $("#targetsEmpty").classList.toggle("hidden", rows.length > 0);
  $("#targetsTable tbody").innerHTML = rows.map(r => {
    return `
    <tr>
      <td>${escapeHtml(r.salesperson)}</td>
      <td>${escapeHtml(r.store)}</td>
      <td>${state.period === "__all__" ? "All periods" : formatPeriod(state.period)}</td>
      <td>${fmtVal(r.actual)}</td>
      <td><input type="number" class="target-input" data-store="${escapeAttr(r.store)}" data-name="${escapeAttr(r.salesperson)}" value="${r.target || ""}" placeholder="${state.metric === "qty" ? "Set qty target" : "Set \u20B9 target"}" ${state.period === "__all__" ? "disabled title=\"Pick a specific period to edit\"" : ""}></td>
      <td>${r.target ? `<span class="tag ${r.achv >= 100 ? "tag-good" : r.achv >= 80 ? "tag-mid" : "tag-bad"}">${pct(r.achv)}</span>` : "\u2014"}</td>
      <td></td>
    </tr>`;
  }).join("");

  $$(".target-input").forEach(input => {
    input.addEventListener("change", async (e) => {
      const val = Number(e.target.value);
      if (!val || state.period === "__all__") return;
      const store = e.target.dataset.store, salesperson = e.target.dataset.name;
      const key = `${store}|${salesperson}|${state.period}|${state.metric}`;
      await DB.putTargets([{ key, store, salesperson, period: state.period, target: val, metric: state.metric }]);
      state.targets = await DB.getAllTargets();
      toast("Target saved");
      renderAll();
    });
  });
}

function wireTargetsView(){
  $("#addTargetRowBtn").addEventListener("click", async () => {
    if (state.period === "__all__"){
      toast("Pick a specific period first, so the target has somewhere to go");
      return;
    }
    const store = prompt("Store name:", state.store !== "__all__" ? state.store : "");
    if (!store) return;
    const salesperson = prompt("Salesperson name:");
    if (!salesperson) return;
    const target = Number(prompt(state.metric === "qty" ? "Target quantity (pcs):" : "Target amount (\u20B9):"));
    if (!target) return;
    const key = `${store.trim()}|${salesperson.trim()}|${state.period}|${state.metric}`;
    await DB.putTargets([{ key, store: store.trim(), salesperson: salesperson.trim(), period: state.period, target, metric: state.metric }]);
    state.targets = await DB.getAllTargets();
    refreshFilters();
    renderAll();
    toast("Target added");
  });

  $("#growthRate").addEventListener("change", async (e) => {
    state.growthRate = Number(e.target.value) || 0;
    await DB.setMeta("growthRate", state.growthRate);
    renderAll();
  });

  $("#suggestTargetsBtn").addEventListener("click", openSuggestModal);
  $("#importTargetsBtn").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.xlsx,.xls";
    input.addEventListener("change", () => handleFileForMapping(input.files[0], "targets"));
    input.click();
  });
}

/* ============ Suggest next-period targets ============ */
function openSuggestModal(){
  let basePeriod = state.period;
  if (basePeriod === "__all__"){
    const periods = [...new Set(state.sales.map(r => r.period))].sort();
    basePeriod = periods[periods.length - 1];
  }
  if (!basePeriod){ toast("Upload sales data first"); return; }

  const sales = filterSales(state.sales, state.store, basePeriod);
  const targets = filterTargets(state.targets, state.store, basePeriod);
  const rows = aggregateByPerson(sales, targets, state.metric).filter(r => r.actual > 0);
  const growth = state.growthRate / 100;
  const next = nextPeriod(basePeriod);
  const roundTo = state.metric === "qty" ? 1 : 100;

  $("#suggestHint").textContent = `Based on ${formatPeriod(basePeriod)} actuals (${state.metric === "qty" ? "units sold" : "sale value"}) with a ${state.growthRate}% growth assumption, saved as targets for ${formatPeriod(next)}.`;
  $("#suggestTable tbody").innerHTML = rows.map((r, i) => {
    const suggested = Math.round((r.actual * (1 + growth)) / roundTo) * roundTo;
    return `<tr data-store="${escapeAttr(r.store)}" data-name="${escapeAttr(r.salesperson)}">
      <td>${escapeHtml(r.salesperson)}</td>
      <td>${escapeHtml(r.store)}</td>
      <td>${fmtVal(r.actual)}</td>
      <td><input type="number" class="suggest-input" data-idx="${i}" value="${suggested}"></td>
    </tr>`;
  }).join("");

  $("#suggestModalBackdrop").dataset.next = next;
  $("#suggestModalBackdrop").classList.remove("hidden");
}

/* ============ Upload / mapping ============ */
function wireUpload(){
  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  $("#emptyUploadBtn").addEventListener("click", () => { goToView("data"); fileInput.click(); });
  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFileForMapping(fileInput.files[0], "sales");
    fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); })
  );
  ["dragleave", "drop"].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("is-drag"); })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFileForMapping(file, "sales");
  });
}

const SALES_FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "store", label: "Store / branch", required: false },
  { key: "salesperson", label: "Salesperson", required: true },
  { key: "amount", label: "Sale amount", required: true },
  { key: "qty", label: "Quantity", required: false },
  { key: "bill", label: "Bill / invoice no.", required: false }
];
function targetFields(){
  return [
    { key: "store", label: "Store / branch", required: false },
    { key: "salesperson", label: "Salesperson", required: true },
    { key: "period", label: "Period / month", required: true },
    { key: "target", label: state.metric === "qty" ? "Target quantity (pcs)" : "Target amount (\u20B9)", required: true }
  ];
}

async function handleFileForMapping(file, type){
  if (!file) return;
  try {
    const { headers, rows } = await readFile(file);
    if (!rows.length){ toast("That file looks empty"); return; }
    const fields = type === "sales" ? SALES_FIELDS : targetFields();
    const mapping = guessMapping(headers, fields.map(f => f.key));
    state.pendingMap = { type, file, headers, rows, fields, mapping };
    openMapModal();
  } catch (err){
    console.error(err);
    toast("Couldn't read that file — check it's a valid CSV or Excel export");
  }
}

function openMapModal(){
  const { type, headers, rows, fields, mapping } = state.pendingMap;
  $("#mapModalTitle").textContent = type === "sales" ? "Match your sales columns" : "Match your target columns";
  $("#mapModalHint").textContent = type === "sales"
    ? "Tell Ledger which column in your file is which. Date, salesperson and amount are required."
    : `Tell Ledger which column holds each value. Salesperson, period and target are required. These will be saved as ${state.metric === "qty" ? "quantity (pcs)" : "sale value (\u20B9)"} targets — switch \u201CMeasure targets in\u201D at the top first if that's not right.`;

  $("#mapGrid").innerHTML = fields.map(f => `
    <div class="map-item">
      <label>${f.label}${f.required ? " *" : ""}</label>
      <select data-field="${f.key}">
        <option value="">${f.required ? "\u2014 choose a column \u2014" : "\u2014 none \u2014"}</option>
        ${headers.map(h => `<option value="${escapeAttr(h)}" ${mapping[f.key] === h ? "selected" : ""}>${escapeHtml(h)}</option>`).join("")}
      </select>
    </div>`).join("");

  const previewRows = rows.slice(0, 5);
  $("#mapPreviewTable thead").innerHTML = `<tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  $("#mapPreviewTable tbody").innerHTML = previewRows.map(r =>
    `<tr>${headers.map(h => `<td>${escapeHtml(String(r[h] ?? ""))}</td>`).join("")}</tr>`
  ).join("");
  $("#mapRowCount").textContent = `${rows.length.toLocaleString("en-IN")} rows in file`;

  $("#mapModalBackdrop").classList.remove("hidden");
}

function readMappingFromForm(){
  const mapping = {};
  $$("#mapGrid select").forEach(sel => { mapping[sel.dataset.field] = sel.value; });
  return mapping;
}

function wireModals(){
  $("#mapModalClose").addEventListener("click", closeMapModal);
  $("#mapCancelBtn").addEventListener("click", closeMapModal);
  $("#mapConfirmBtn").addEventListener("click", confirmMapping);

  $("#drawerClose").addEventListener("click", () => $("#drawerBackdrop").classList.add("hidden"));
  $("#drawerBackdrop").addEventListener("click", (e) => { if (e.target.id === "drawerBackdrop") $("#drawerBackdrop").classList.add("hidden"); });

  $("#suggestModalClose").addEventListener("click", () => $("#suggestModalBackdrop").classList.add("hidden"));
  $("#suggestCancelBtn").addEventListener("click", () => $("#suggestModalBackdrop").classList.add("hidden"));
  $("#suggestConfirmBtn").addEventListener("click", confirmSuggestedTargets);

  wirePeopleView();
}

function closeMapModal(){
  $("#mapModalBackdrop").classList.add("hidden");
  state.pendingMap = null;
}

async function confirmMapping(){
  const { type, file, rows, fields } = state.pendingMap;
  const mapping = readMappingFromForm();
  const missing = fields.filter(f => f.required && !mapping[f.key]);
  if (missing.length){
    toast(`Please match: ${missing.map(f => f.label).join(", ")}`);
    return;
  }

  if (type === "sales"){
    const uploadId = await DB.addUpload({ file: file.name, rows: rows.length, uploadedAt: new Date().toISOString(), type: "sales" });
    const { records, skipped } = buildSalesRecords(rows, mapping, uploadId);
    if (!records.length){
      toast("No valid rows found — check the column mapping");
      await DB.deleteUpload(uploadId);
      closeMapModal();
      return;
    }
    await DB.addSalesRecords(records);
    state.sales = await DB.getAllSales();
    state.uploads = await DB.getAllUploads();
    toast(`Added ${records.length} sales records${skipped ? ` (${skipped} skipped)` : ""}`);
  } else {
    const { records, skipped } = buildTargetRecords(rows, mapping, state.metric);
    if (!records.length){
      toast("No valid target rows found — check the column mapping");
      closeMapModal();
      return;
    }
    await DB.putTargets(records);
    state.targets = await DB.getAllTargets();
    toast(`Saved ${records.length} targets${skipped ? ` (${skipped} skipped)` : ""}`);
  }

  closeMapModal();
  refreshFilters();
  renderAll();
  renderDataView();
}

async function confirmSuggestedTargets(){
  const next = $("#suggestModalBackdrop").dataset.next;
  const rows = [];
  $$("#suggestTable tbody tr").forEach(tr => {
    const store = tr.dataset.store, salesperson = tr.dataset.name;
    const val = Number(tr.querySelector(".suggest-input").value) || 0;
    if (val > 0){
      rows.push({ key: `${store}|${salesperson}|${next}|${state.metric}`, store, salesperson, period: next, target: val, metric: state.metric });
    }
  });
  if (!rows.length){ $("#suggestModalBackdrop").classList.add("hidden"); return; }
  await DB.putTargets(rows);
  state.targets = await DB.getAllTargets();
  $("#suggestModalBackdrop").classList.add("hidden");
  refreshFilters();
  renderAll();
  toast(`Saved ${rows.length} targets for ${formatPeriod(next)}`);
}

/* ============ Data view ============ */
function renderDataView(){
  $("#uploadsEmpty").classList.toggle("hidden", state.uploads.length > 0);
  $("#uploadsTable tbody").innerHTML = state.uploads.slice().reverse().map(u => `
    <tr>
      <td>${escapeHtml(u.file)}</td>
      <td>${u.rows}</td>
      <td>${new Date(u.uploadedAt).toLocaleString("en-IN")}</td>
      <td>${u.type}</td>
      <td><button class="btn btn-ghost btn-small" data-id="${u.id}">Remove</button></td>
    </tr>`).join("");

  $$("#uploadsTable button[data-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      await DB.deleteSalesByUpload(id);
      await DB.deleteUpload(id);
      state.sales = await DB.getAllSales();
      state.uploads = await DB.getAllUploads();
      refreshFilters();
      renderAll();
      renderDataView();
      toast("Upload removed");
    });
  });
}

function wireDataView(){
  $("#clearAllBtn").addEventListener("click", async () => {
    if (!confirm("This clears all sales records, targets and uploads stored in this browser. Continue?")) return;
    await DB.clearAll();
    state.sales = []; state.targets = []; state.uploads = [];
    refreshFilters();
    renderAll();
    renderDataView();
    toast("All data cleared");
  });
}

/* ============ Export ============ */
function toCSV(rows, headers){
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
}

function downloadBlob(text, filename){
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function exportData(){
  if (!state.sales.length && !state.targets.length){ toast("Nothing to export yet"); return; }
  if (state.sales.length){
    downloadBlob(toCSV(state.sales, ["date", "period", "store", "salesperson", "amount", "qty", "bill"]), "sales_export.csv");
  }
  if (state.targets.length){
    downloadBlob(toCSV(state.targets, ["store", "salesperson", "period", "target", "metric"]), "targets_export.csv");
  }
  toast("Export started");
}

/* ============ Utils ============ */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s){ return escapeHtml(s); }

boot();
