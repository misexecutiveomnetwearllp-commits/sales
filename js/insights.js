export function filterSales(sales, store, period){
  return sales.filter(r =>
    (store === "__all__" || r.store === store) &&
    (period === "__all__" || r.period === period)
  );
}

export function filterTargets(targets, store, period){
  return targets.filter(t =>
    (store === "__all__" || t.store === store) &&
    (period === "__all__" || t.period === period)
  );
}

export function sumQty(salesRows){
  return salesRows.reduce((a, r) => a + (r.qty || 0), 0);
}

// Groups by salesperson+store (collapsing period when period === "__all__")
export function aggregateByPerson(sales, targets){
  const map = new Map(); // key = store|salesperson
  for (const r of sales){
    const key = `${r.store}|${r.salesperson}`;
    if (!map.has(key)){
      map.set(key, { store: r.store, salesperson: r.salesperson, actual: 0, target: 0, bills: new Set() });
    }
    const row = map.get(key);
    row.actual += r.qty || 0;
    if (r.bill) row.bills.add(r.bill);
  }
  for (const t of targets){
    const key = `${t.store}|${t.salesperson}`;
    if (!map.has(key)){
      map.set(key, { store: t.store, salesperson: t.salesperson, actual: 0, target: 0, bills: new Set() });
    }
    map.get(key).target += t.target;
  }
  const rows = [...map.values()].map(r => ({
    store: r.store,
    salesperson: r.salesperson,
    actual: r.actual,
    target: r.target,
    bills: r.bills.size,
    avgPerBill: r.bills.size ? r.actual / r.bills.size : 0,
    achv: r.target ? (r.actual / r.target) * 100 : null
  }));
  rows.sort((a, b) => b.actual - a.actual);
  return rows;
}

export function aggregateByStore(sales, targets){
  const map = new Map();
  for (const r of sales){
    if (!map.has(r.store)) map.set(r.store, { store: r.store, actual: 0, target: 0 });
    map.get(r.store).actual += r.qty || 0;
  }
  for (const t of targets){
    if (!map.has(t.store)) map.set(t.store, { store: t.store, actual: 0, target: 0 });
    map.get(t.store).target += t.target;
  }
  const rows = [...map.values()].map(r => ({ ...r, achv: r.target ? (r.actual / r.target) * 100 : null }));
  rows.sort((a, b) => b.actual - a.actual);
  return rows;
}

// Like aggregateByPerson, but keeps every period as its own bucket —
// used for the monthly-columns view on the Salespeople and Targets tabs.
export function aggregateByPersonMonthly(sales, targets, periods){
  const map = new Map(); // key = store|salesperson
  const ensure = (store, salesperson) => {
    const key = `${store}|${salesperson}`;
    if (!map.has(key)) map.set(key, { store, salesperson, byPeriod: {}, totalActual: 0, totalTarget: 0 });
    return map.get(key);
  };
  for (const r of sales){
    const row = ensure(r.store, r.salesperson);
    if (!row.byPeriod[r.period]) row.byPeriod[r.period] = { actual: 0, target: 0 };
    row.byPeriod[r.period].actual += r.qty || 0;
    row.totalActual += r.qty || 0;
  }
  for (const t of targets){
    const row = ensure(t.store, t.salesperson);
    if (!row.byPeriod[t.period]) row.byPeriod[t.period] = { actual: 0, target: 0 };
    row.byPeriod[t.period].target += t.target;
    row.totalTarget += t.target;
  }
  const rows = [...map.values()].map(r => {
    periods.forEach(p => { if (!r.byPeriod[p]) r.byPeriod[p] = { actual: 0, target: 0 }; });
    return r;
  });
  rows.sort((a, b) => b.totalActual - a.totalActual);
  return rows;
}

export function totals(rows){
  return rows.reduce((acc, r) => {
    acc.actual += r.actual;
    acc.target += r.target;
    return acc;
  }, { actual: 0, target: 0 });
}

export function previousPeriod(period){
  if (period === "__all__") return null;
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function nextPeriod(period){
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function generateInsights(personRows, storeRows, growthRatePct){
  const insights = [];
  const withTarget = personRows.filter(r => r.target > 0);
  const below80 = withTarget.filter(r => r.achv < 80);
  const above100 = withTarget.filter(r => r.achv >= 100);
  const noTarget = personRows.filter(r => !r.target);

  if (below80.length){
    const names = below80.slice(0, 4).map(r => r.salesperson).join(", ");
    insights.push(`${below80.length} salesperson${below80.length > 1 ? "s are" : " is"} under 80% of their unit target — start with ${names}. A short floor-coaching session on add-on selling and billing conversion usually moves this fastest.`);
  }
  if (above100.length){
    const top = above100[0];
    insights.push(`${top.salesperson} is running at ${Math.round(top.achv)}% of target at ${top.store}. Worth understanding what's working there — footfall, a strong category mix, or a promotion — and repeating it at other counters.`);
  }
  if (storeRows.length > 1){
    const sorted = [...storeRows].filter(s => s.target > 0).sort((a, b) => (a.achv ?? 0) - (b.achv ?? 0));
    if (sorted.length){
      const weakest = sorted[0];
      if (weakest.achv < 90){
        insights.push(`${weakest.store} is the softest store this period at ${Math.round(weakest.achv)}% of target. Check stock availability and staffing there before assuming it's a demand problem.`);
      }
    }
  }
  if (noTarget.length){
    insights.push(`${noTarget.length} salesperson${noTarget.length > 1 ? "s have" : " has"} sales recorded but no target set — set one on the Targets tab so achievement shows correctly.`);
  }
  if (withTarget.length){
    insights.push(`At a ${growthRatePct}% growth assumption, next period's targets would total roughly what you'd get from "Suggest next-period targets" on the Targets tab — tune the percentage up for a store you want to push harder.`);
  }
  if (!insights.length){
    insights.push("Upload more sales history or set targets to start seeing focus areas here.");
  }
  return insights;
}
