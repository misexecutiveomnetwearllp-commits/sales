import { DB, setApiUrl, getApiUrl, isConfigured } from "./api.js";
import {
  readFileMatrix, fileToBase64, matrixFromBase64, detectHeaderRow, extractHeaders, extractDataRows, rowPreviewLabel,
  guessMapping, buildSalesRecords, buildTargetRecords
} from "./parse.js";
import {
  filterSales, filterTargets, aggregateByPerson, aggregateByPersonMonthly, aggregateByStore, totals,
  previousPeriod, nextPeriod, generateInsights, sumQty
} from "./insights.js";
import { renderTrendChart } from "./charts.js";

/* ============ State ============ */
const state = {
  sales: [],
  targets: [],
  files: [],
  store: "__all__",
  period: "__all__",
  growthRate: 10,
  peopleSort: { key: "actual", dir: "desc" },
  pendingMap: null // { type, file, matrix, headerRowIndex, headers, dataRows, fields, mapping }
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const fmt = (n) => Math.round(n || 0).toLocaleString("en-IN");
const fmtPcs = (n) => fmt(n) + " pcs";
const pct = (n) => (n === null || n === undefined) ? "\u2014" : Math.round(n) + "%";

function toast(msg){
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-shown");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("is-shown"), 2800);
}

/* ============ Boot ============ */
async function boot(){
  wireNav();
  wireTopbar();
  wireUpload();
  wireTargetsView();
  wireDataView();
  wireModals();
  wireConnection();
  renderConnectionStatus();
  await loadData();
}

async function loadData(){
  if (!isConfigured()){
    renderAll();
    renderDataView();
    return;
  }
  try {
    const c = await DB.refresh();
    state.files = c.files;
    state.targets = c.targets;
    state.growthRate = Number(c.meta.growthRate || 10) || 10;
    $("#growthRate").value = state.growthRate;
    await reloadSalesFromFiles();
  } catch (err){
    console.error(err);
    toast("Couldn't reach the backend: " + (err.message || err) + " — check the Data tab");
  }
  refreshFilters();
  renderAll();
  renderDataView();
}

// Re-downloads every stored sales file and re-parses it client-side using
// the mapping saved at upload time — this is how "the same data everywhere"
// works without writing rows into the Sheet.
async function reloadSalesFromFiles(){
  const salesFiles = state.files.filter(f => f.type === "sales");
  const allRecords = [];
  for (const f of salesFiles){
    if (!f.mapping || f.headerRowIndex === null){
      console.warn("Skipping file with no saved mapping:", f.name);
      continue;
    }
    try {
      const content = await DB.getFileContent(f.id);
      const matrix = matrixFromBase64(content.base64, content.name || f.name);
      const dataRows = extractDataRows(matrix, f.headerRowIndex);
      const { records } = buildSalesRecords(dataRows, f.mapping, f.id);
      allRecords.push(...records);
    } catch (err){
      console.error("Failed to load file", f.name, err);
      toast(`Couldn't load ${f.name}: ` + (err.message || err));
    }
  }
  state.sales = allRecords;
}

/* ============ Connection (Apps Script URL) ============ */
function wireConnection(){
  $("#apiUrlInput").value = getApiUrl();
  $("#apiUrlSaveBtn").addEventListener("click", async () => {
    const url = $("#apiUrlInput").value.trim();
    if (!url){ toast("Paste your Apps Script Web App URL first"); return; }
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)){
      toast("That doesn't look like an Apps Script web app URL");
      return;
    }
    setApiUrl(url);
    renderConnectionStatus();
    toast("Connecting\u2026");
    await loadData();
  });
}

function renderConnectionStatus(){
  const configured = isConfigured();
  const el = $("#connectionStatus");
  el.textContent = configured ? "Connected" : "Not connected";
  el.className = "tag " + (configured ? "tag-good" : "tag-bad");
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
  $("#quickUploadBtn").addEventListener("click", () => { goToView("data"); if (isConfigured()) $("#fileInput").click(); });
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
  if (!isConfigured()){
    $("#dashboardEmpty").classList.remove("hidden");
    $("#dashboardBody").classList.add("hidden");
    $("#dashboardEmptyTitle").textContent = "Connect your Google Sheet first";
    $("#dashboardEmptyText").textContent = "Go to the Data tab, paste your Apps Script Web App URL and save — then upload your first sales file. All data lives in that sheet, so it looks the same from any browser or device.";
    $("#emptyUploadBtn").textContent = "Go to Data tab";
    return;
  }

  const sales = filterSales(state.sales, state.store, state.period);
  const targets = filterTargets(state.targets, state.store, state.period);

  const hasData = state.sales.length > 0;
  $("#dashboardEmpty").classList.toggle("hidden", hasData);
  $("#dashboardBody").classList.toggle("hidden", !hasData);
  if (!hasData){
    $("#dashboardEmptyTitle").textContent = "No sales data yet";
    $("#dashboardEmptyText").textContent = "Upload an Excel or CSV export from your ERP to see achievement against target, store-wise performance, and who needs support to hit the next target.";
    $("#emptyUploadBtn").textContent = "Upload your first file";
    return;
  }

  const personRows = aggregateByPerson(sales, targets);
  const storeRows = aggregateByStore(sales, targets);
  const t = totals(personRows);
  const achvPct = t.target ? (t.actual / t.target) * 100 : null;

  // Ring
  const circumference = 377;
  const clamped = Math.max(0, Math.min(100, achvPct ?? 0));
  $("#heroRingFill").style.strokeDashoffset = String(circumference * (1 - clamped / 100));
  $("#heroRingPct").textContent = achvPct === null ? "\u2014" : pct(achvPct);
  $("#heroAchieved").textContent = fmtPcs(t.actual);
  $("#heroTarget").textContent = t.target ? fmtPcs(t.target) : "Not set";
  $("#heroGap").textContent = t.target ? fmtPcs(Math.max(0, t.target - t.actual)) : "\u2014";

  const withTarget = personRows.filter(r => r.target > 0);
  $("#statAbove").textContent = withTarget.filter(r => r.achv >= 100).length;
  $("#statBelow").textContent = withTarget.filter(r => r.achv < 80).length;
  const bestStore = [...storeRows].filter(s => s.target > 0).sort((a, b) => b.achv - a.achv)[0];
  $("#statBestStore").textContent = bestStore ? bestStore.store : "\u2014";

  const prev = previousPeriod(state.period);
  if (prev){
    const prevSales = filterSales(state.sales, state.store, prev);
    const prevTotal = sumQty(prevSales);
    if (prevTotal > 0){
      const delta = ((t.actual - prevTotal) / prevTotal) * 100;
      $("#statVsPrev").textContent = (delta >= 0 ? "+" : "") + Math.round(delta) + "%";
    } else {
      $("#statVsPrev").textContent = "\u2014";
    }
  } else {
    $("#statVsPrev").textContent = "\u2014";
  }

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

  const withT = personRows.filter(r => r.target > 0);
  const below80 = [...withT].filter(r => r.achv < 80).sort((a, b) => a.achv - b.achv).slice(0, 6);
  const top = [...withT].sort((a, b) => b.achv - a.achv).slice(0, 6);

  $("#tableNeedsAttention tbody").innerHTML = below80.map(rowToPersonTr).join("");
  $("#needsAttentionEmpty").classList.toggle("hidden", below80.length > 0);
  $("#tableTopPerformers tbody").innerHTML = top.map(rowToPersonTr).join("");

  $$("#tableNeedsAttention tbody tr, #tableTopPerformers tbody tr").forEach(tr => {
    tr.addEventListener("click", () => openDrawer(tr.dataset.name, tr.dataset.store));
  });

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
  // Monthly-columns view: store filter applies, period filter doesn't
  // (every period is shown as its own set of columns).
  const sales = filterSales(state.sales, state.store, "__all__");
  const targets = filterTargets(state.targets, state.store, "__all__");
  const periods = [...new Set([...sales.map(r => r.period), ...targets.map(r => r.period)])].sort();
  let rows = aggregateByPersonMonthly(sales, targets, periods);

  const q = $("#peopleSearch").value.trim().toLowerCase();
  if (q) rows = rows.filter(r => r.salesperson.toLowerCase().includes(q));

  const { key, dir } = state.peopleSort;
  rows.sort((a, b) => {
    let av = key === "name" ? a.salesperson : key === "store" ? a.store : a.totalActual;
    let bv = key === "name" ? b.salesperson : key === "store" ? b.store : b.totalActual;
    if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === "asc" ? av - bv : bv - av;
  });

  $("#peopleEmpty").classList.toggle("hidden", rows.length > 0);

  $("#peopleTable thead").innerHTML = `
    <tr>
      <th rowspan="2" data-sort="name">Salesperson</th>
      <th rowspan="2" data-sort="store">Store</th>
      ${periods.map(p => `<th colspan="2" class="month-head">${formatPeriod(p)}</th>`).join("")}
      <th rowspan="2" data-sort="total">Total actual</th>
    </tr>
    <tr>
      ${periods.map(() => `<th class="sub-head">Commission</th><th class="sub-head">Actual Commission</th>`).join("")}
    </tr>`;

  $("#peopleTable tbody").innerHTML = rows.map(r => `
    <tr data-name="${escapeAttr(r.salesperson)}" data-store="${escapeAttr(r.store)}">
      <td>${escapeHtml(r.salesperson)}</td>
      <td>${escapeHtml(r.store)}</td>
      ${periods.map(p => {
        const cell = r.byPeriod[p];
        return `<td class="pivot-first">${cell.target ? fmt(cell.target) : "\u2014"}</td><td>${fmt(cell.actual)}</td>`;
      }).join("")}
      <td class="pivot-first">${fmt(r.totalActual)}</td>
    </tr>`).join("");

  $$("#peopleTable tbody tr").forEach(tr => {
    tr.addEventListener("click", () => openDrawer(tr.dataset.name, tr.dataset.store));
  });
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

function wirePeopleView(){
  $("#peopleSearch").addEventListener("input", renderPeople);
}

/* ============ Drawer (salesperson detail) ============ */
function openDrawer(name, store){
  const personSales = state.sales.filter(r => r.salesperson === name && r.store === store);
  const personTargets = state.targets.filter(r => r.salesperson === name && r.store === store);
  const periods = [...new Set([...personSales.map(r => r.period), ...personTargets.map(r => r.period)])].sort();

  $("#drawerName").textContent = `${name} \u00B7 ${store}`;
  const points = periods.map(p => ({
    label: p,
    actual: sumQty(personSales.filter(r => r.period === p)),
    target: personTargets.filter(r => r.period === p).reduce((a, r) => a + r.target, 0)
  }));

  const totalActual = points.reduce((a, p) => a + p.actual, 0);
  const totalTarget = points.reduce((a, p) => a + p.target, 0);

  const body = $("#drawerBody");
  body.innerHTML = `
    <div class="hero-stats" style="grid-template-columns: 1fr 1fr 1fr; margin-bottom:18px;">
      <div class="stat-card"><span class="stat-label">Total Actual Commission</span><span class="stat-val">${fmt(totalActual)}</span></div>
      <div class="stat-card"><span class="stat-label">Total Commission</span><span class="stat-val">${totalTarget ? fmt(totalTarget) : "\u2014"}</span></div>
      <div class="stat-card"><span class="stat-label">Achievement</span><span class="stat-val">${totalTarget ? pct((totalActual / totalTarget) * 100) : "\u2014"}</span></div>
    </div>
    <h4 style="font-size:13.5px;margin-bottom:8px;">Period trend</h4>
    <div class="drawer-sparkline" id="drawerChart"></div>
    <h4 style="font-size:13.5px;margin:18px 0 8px;">By period</h4>
    <table class="ledger">
      <thead><tr><th>Period</th><th>Actual Commission</th><th>Commission</th><th>Achv.</th></tr></thead>
      <tbody>
        ${points.slice().reverse().map(p => `
          <tr>
            <td>${formatPeriod(p.label)}</td>
            <td>${fmt(p.actual)}</td>
            <td>${p.target ? fmt(p.target) : "\u2014"}</td>
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
  // Monthly-columns view, same as Salespeople — every period gets its own
  // editable Commission cell, ignoring the period filter.
  const sales = filterSales(state.sales, state.store, "__all__");
  const targets = filterTargets(state.targets, state.store, "__all__");
  const periods = [...new Set([...sales.map(r => r.period), ...targets.map(r => r.period)])].sort();
  const rows = aggregateByPersonMonthly(sales, targets, periods).filter(r => r.totalActual > 0 || r.totalTarget > 0);

  $("#targetsEmpty").classList.toggle("hidden", rows.length > 0);

  $("#targetsTable thead").innerHTML = `
    <tr>
      <th rowspan="2">Salesperson</th>
      <th rowspan="2">Store</th>
      ${periods.map(p => `<th colspan="3" class="month-head">${formatPeriod(p)}</th>`).join("")}
    </tr>
    <tr>
      ${periods.map(() => `<th class="sub-head">Commission</th><th class="sub-head">Actual Commission</th><th class="sub-head">Achv.</th>`).join("")}
    </tr>`;

  $("#targetsTable tbody").innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.salesperson)}</td>
      <td>${escapeHtml(r.store)}</td>
      ${periods.map(p => {
        const cell = r.byPeriod[p];
        const achv = cell.target ? Math.round((cell.actual / cell.target) * 100) : null;
        const tagClass = achv === null ? "" : achv >= 100 ? "tag-good" : achv >= 80 ? "tag-mid" : "tag-bad";
        return `
          <td class="pivot-first"><input type="number" class="target-input" data-store="${escapeAttr(r.store)}" data-name="${escapeAttr(r.salesperson)}" data-period="${p}" value="${cell.target || ""}" placeholder="\u2014"></td>
          <td>${fmt(cell.actual)}</td>
          <td>${achv === null ? "\u2014" : `<span class="tag ${tagClass}">${achv}%</span>`}</td>`;
      }).join("")}
    </tr>`).join("");

  $$(".target-input").forEach(input => {
    input.addEventListener("change", async (e) => {
      const val = Number(e.target.value);
      if (!val) return;
      const store = e.target.dataset.store, salesperson = e.target.dataset.name, period = e.target.dataset.period;
      const key = `${store}|${salesperson}|${period}`;
      try {
        await DB.putTargets([{ key, store, salesperson, period, target: val }]);
        state.targets = await DB.getAllTargets();
        toast("Commission saved");
        renderAll();
      } catch (err){
        console.error(err);
        toast("Couldn't save: " + (err.message || err));
      }
    });
  });
}

function wireTargetsView(){
  $("#addTargetRowBtn").addEventListener("click", async () => {
    if (!isConfigured()){ toast("Connect your Google Sheet first (Data tab)"); return; }
    const store = prompt("Store name:", state.store !== "__all__" ? state.store : "");
    if (!store) return;
    const salesperson = prompt("Salesperson name:");
    if (!salesperson) return;
    const period = prompt("Period (YYYY-MM), e.g. 2026-09:", state.period !== "__all__" ? state.period : "");
    if (!period || !/^\d{4}-\d{2}$/.test(period.trim())){ toast("Enter the period as YYYY-MM"); return; }
    const target = Number(prompt("Commission (units):"));
    if (!target) return;
    const key = `${store.trim()}|${salesperson.trim()}|${period.trim()}`;
    try {
      await DB.putTargets([{ key, store: store.trim(), salesperson: salesperson.trim(), period: period.trim(), target }]);
      state.targets = await DB.getAllTargets();
      refreshFilters();
      renderAll();
      toast("Commission added");
    } catch (err){
      console.error(err);
      toast("Couldn't save: " + (err.message || err));
    }
  });

  $("#growthRate").addEventListener("change", async (e) => {
    state.growthRate = Number(e.target.value) || 0;
    if (isConfigured()) await DB.setMeta("growthRate", state.growthRate);
    renderAll();
  });

  $("#suggestTargetsBtn").addEventListener("click", openSuggestModal);
  $("#importTargetsBtn").addEventListener("click", () => {
    if (!isConfigured()){ toast("Connect your Google Sheet first (Data tab)"); return; }
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
  const rows = aggregateByPerson(sales, targets).filter(r => r.actual > 0);
  const growth = state.growthRate / 100;
  const next = nextPeriod(basePeriod);

  $("#suggestHint").textContent = `Based on ${formatPeriod(basePeriod)} units sold, with a ${state.growthRate}% growth assumption, saved as targets for ${formatPeriod(next)}.`;
  $("#suggestTable tbody").innerHTML = rows.map((r, i) => {
    const suggested = Math.max(1, Math.round(r.actual * (1 + growth)));
    return `<tr data-store="${escapeAttr(r.store)}" data-name="${escapeAttr(r.salesperson)}">
      <td>${escapeHtml(r.salesperson)}</td>
      <td>${escapeHtml(r.store)}</td>
      <td>${fmt(r.actual)}</td>
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
  $("#emptyUploadBtn").addEventListener("click", () => {
    goToView("data");
    if (isConfigured()) fileInput.click();
  });
  dropzone.addEventListener("click", () => {
    if (!isConfigured()){ toast("Connect your Google Sheet first (see above)"); return; }
    fileInput.click();
  });
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
    if (!isConfigured()){ toast("Connect your Google Sheet first (see above)"); return; }
    const file = e.dataTransfer.files[0];
    if (file) handleFileForMapping(file, "sales");
  });
}

const SALES_FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "store", label: "Store / branch", required: false },
  { key: "salesperson", label: "Salesperson", required: true },
  { key: "qty", label: "Quantity sold", required: true },
  { key: "bill", label: "Bill / invoice no.", required: false }
];
const TARGET_FIELDS = [
  { key: "store", label: "Store / branch", required: false },
  { key: "salesperson", label: "Salesperson", required: true },
  { key: "period", label: "Period / month", required: true },
  { key: "target", label: "Commission quantity (pcs)", required: true }
];

async function handleFileForMapping(file, type){
  if (!file) return;
  try {
    const matrix = await readFileMatrix(file);
    if (!matrix.length){ toast("That file looks empty"); return; }
    const headerRowIndex = detectHeaderRow(matrix);
    state.pendingMap = { type, file, matrix, headerRowIndex };
    rebuildPendingHeaders();
    openMapModal();
  } catch (err){
    console.error(err);
    toast("Couldn't read that file — check it's a valid CSV or Excel export");
  }
}

function rebuildPendingHeaders(){
  const { matrix, headerRowIndex, type } = state.pendingMap;
  const headers = extractHeaders(matrix, headerRowIndex);
  const dataRows = extractDataRows(matrix, headerRowIndex);
  const fields = type === "sales" ? SALES_FIELDS : TARGET_FIELDS;
  const mapping = guessMapping(headers, fields.map(f => f.key));
  state.pendingMap.headers = headers;
  state.pendingMap.dataRows = dataRows;
  state.pendingMap.fields = fields;
  state.pendingMap.mapping = mapping;
}

function openMapModal(){
  const { type } = state.pendingMap;
  $("#mapModalTitle").textContent = type === "sales" ? "Match your sales columns" : "Match your target columns";
  $("#mapModalHint").textContent = type === "sales"
    ? "Ledger guessed the header row and matched columns below — check them and adjust anything that's off. Date, salesperson and quantity are required."
    : "Ledger guessed the header row and matched columns below — check them and adjust anything that's off. Salesperson, period and target quantity are required.";
  renderHeaderRowSelect();
  renderHeadersEditor();
  renderFieldMapping();
  renderMapPreview();
  $("#mapModalBackdrop").classList.remove("hidden");
}

function renderHeaderRowSelect(){
  const { matrix, headerRowIndex } = state.pendingMap;
  const scanLimit = Math.min(15, matrix.length);
  const sel = $("#headerRowSelect");
  sel.innerHTML = "";
  for (let i = 0; i < scanLimit; i++){
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `Row ${i + 1}: ${rowPreviewLabel(matrix[i])}`;
    if (i === headerRowIndex) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderHeadersEditor(){
  const { headers } = state.pendingMap;
  $("#headersEditor").innerHTML = headers.map(h => `
    <div class="header-chip ${h.included ? "" : "is-excluded"}" data-index="${h.index}">
      <input type="checkbox" class="header-include" data-index="${h.index}" ${h.included ? "checked" : ""} title="Include this column as an option below">
      <input type="text" class="header-label" data-index="${h.index}" value="${escapeAttr(h.label)}">
    </div>`).join("");

  $$(".header-include").forEach(cb => cb.addEventListener("change", (e) => {
    const idx = Number(e.target.dataset.index);
    const h = state.pendingMap.headers.find(hh => hh.index === idx);
    h.included = e.target.checked;
    e.target.closest(".header-chip").classList.toggle("is-excluded", !h.included);
    renderFieldMapping();
    renderMapPreview();
  }));
  $$(".header-label").forEach(inp => inp.addEventListener("input", (e) => {
    const idx = Number(e.target.dataset.index);
    const h = state.pendingMap.headers.find(hh => hh.index === idx);
    h.label = e.target.value.trim() || `Column ${idx + 1}`;
    renderFieldMapping();
    renderMapPreview();
  }));
}

function renderFieldMapping(){
  const { headers, fields, mapping } = state.pendingMap;
  const included = headers.filter(h => h.included);
  $("#mapGrid").innerHTML = fields.map(f => `
    <div class="map-item">
      <label>${f.label}${f.required ? " *" : ""}</label>
      <select data-field="${f.key}">
        <option value="">${f.required ? "\u2014 choose a column \u2014" : "\u2014 none \u2014"}</option>
        ${included.map(h => `<option value="${h.index}" ${String(mapping[f.key]) === String(h.index) ? "selected" : ""}>${escapeHtml(h.label)}</option>`).join("")}
      </select>
    </div>`).join("");
}

function renderMapPreview(){
  const { headers, dataRows, headerRowIndex } = state.pendingMap;
  const rows = dataRows.slice(0, 5);
  $("#mapPreviewTable thead").innerHTML = `<tr>${headers.map(h => `<th class="${h.included ? "" : "is-excluded"}">${escapeHtml(h.label)}</th>`).join("")}</tr>`;
  $("#mapPreviewTable tbody").innerHTML = rows.map(r =>
    `<tr>${headers.map(h => `<td class="${h.included ? "" : "is-excluded"}">${escapeHtml(String(r[h.index] ?? ""))}</td>`).join("")}</tr>`
  ).join("");
  $("#mapRowCount").textContent = `${dataRows.length.toLocaleString("en-IN")} data rows \u00B7 header on row ${headerRowIndex + 1}`;
}

function readMappingFromForm(){
  const mapping = {};
  $$("#mapGrid select").forEach(sel => { mapping[sel.dataset.field] = sel.value === "" ? "" : Number(sel.value); });
  return mapping;
}

function wireModals(){
  $("#mapModalClose").addEventListener("click", closeMapModal);
  $("#mapCancelBtn").addEventListener("click", closeMapModal);
  $("#mapConfirmBtn").addEventListener("click", confirmMapping);
  $("#headerRowSelect").addEventListener("change", (e) => {
    state.pendingMap.headerRowIndex = Number(e.target.value);
    rebuildPendingHeaders();
    renderHeadersEditor();
    renderFieldMapping();
    renderMapPreview();
  });

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
  const { type, file, dataRows, fields } = state.pendingMap;
  const mapping = readMappingFromForm();
  const missing = fields.filter(f => f.required && mapping[f.key] === "");
  if (missing.length){
    toast(`Please match: ${missing.map(f => f.label).join(", ")}`);
    return;
  }

  try {
    if (type === "sales"){
      const { headerRowIndex } = state.pendingMap;
      const dryRun = buildSalesRecords(dataRows, mapping, "pending");
      if (!dryRun.records.length){
        toast("No valid rows found — check the column mapping");
        closeMapModal();
        return;
      }
      const base64 = await fileToBase64(file);
      const fileId = await DB.uploadFile({
        name: file.name, base64, mimeType: file.type || "",
        type: "sales", headerRowIndex, mapping, rows: dryRun.records.length,
        uploadedAt: new Date().toISOString()
      });
      const { records, skipped } = buildSalesRecords(dataRows, mapping, fileId);
      state.sales = [...state.sales, ...records];
      state.files = await DB.getFiles();
      toast(`Added ${records.length} sales records${skipped ? ` (${skipped} skipped)` : ""}`);
    } else {
      const { records, skipped } = buildTargetRecords(dataRows, mapping);
      if (!records.length){
        toast("No valid target rows found — check the column mapping");
        closeMapModal();
        return;
      }
      await DB.putTargets(records);
      state.targets = await DB.getAllTargets();
      toast(`Saved ${records.length} targets${skipped ? ` (${skipped} skipped)` : ""}`);
    }
  } catch (err){
    console.error(err);
    toast("Couldn't reach the backend: " + (err.message || err));
    closeMapModal();
    return;
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
      rows.push({ key: `${store}|${salesperson}|${next}`, store, salesperson, period: next, target: val });
    }
  });
  if (!rows.length){ $("#suggestModalBackdrop").classList.add("hidden"); return; }
  try {
    await DB.putTargets(rows);
    state.targets = await DB.getAllTargets();
    $("#suggestModalBackdrop").classList.add("hidden");
    refreshFilters();
    renderAll();
    toast(`Saved ${rows.length} targets for ${formatPeriod(next)}`);
  } catch (err){
    console.error(err);
    toast("Couldn't save: " + (err.message || err));
  }
}

/* ============ Data view ============ */
function renderDataView(){
  $("#uploadsEmpty").classList.toggle("hidden", state.files.length > 0);
  $("#uploadsTable tbody").innerHTML = state.files.slice().reverse().map(f => `
    <tr>
      <td>${escapeHtml(f.name)}</td>
      <td>${f.rows}</td>
      <td>${f.uploadedAt ? new Date(f.uploadedAt).toLocaleString("en-IN") : "\u2014"}</td>
      <td>${f.type}</td>
      <td><button class="btn btn-ghost btn-small" data-id="${escapeAttr(f.id)}">Remove</button></td>
    </tr>`).join("");

  $$("#uploadsTable button[data-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      try {
        await DB.deleteFile(id);
        state.files = state.files.filter(f => f.id !== id);
        state.sales = state.sales.filter(r => r.uploadId !== id);
        refreshFilters();
        renderAll();
        renderDataView();
        toast("File removed");
      } catch (err){
        console.error(err);
        toast("Couldn't remove: " + (err.message || err));
      }
    });
  });
}

function wireDataView(){
  $("#clearAllBtn").addEventListener("click", async () => {
    if (!isConfigured()){ toast("Connect your Google Sheet first"); return; }
    if (!confirm("This removes every uploaded file, all targets, and settings from your connected Google Sheet and Drive folder. Continue?")) return;
    try {
      await DB.clearAll();
      state.sales = []; state.targets = []; state.files = [];
      refreshFilters();
      renderAll();
      renderDataView();
      toast("All data cleared");
    } catch (err){
      console.error(err);
      toast("Couldn't clear: " + (err.message || err));
    }
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
    downloadBlob(toCSV(state.sales, ["date", "period", "store", "salesperson", "qty", "bill"]), "sales_export.csv");
  }
  if (state.targets.length){
    downloadBlob(toCSV(state.targets, ["store", "salesperson", "period", "target"]), "targets_export.csv");
  }
  toast("Export started");
}

/* ============ Utils ============ */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s){ return escapeHtml(s); }

boot();
