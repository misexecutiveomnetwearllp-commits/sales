// Minimal SVG line chart for a salesperson's period-by-period actual vs target.
// points: [{ label, actual, target }]
export function renderTrendChart(container, points){
  if (!points.length){
    container.innerHTML = `<p style="color:#4B5666;font-size:13px;">No period history yet.</p>`;
    return;
  }
  const w = 480, h = 160, padL = 34, padB = 22, padT = 10, padR = 10;
  const maxVal = Math.max(...points.map(p => Math.max(p.actual, p.target || 0)), 1);
  const stepX = points.length > 1 ? (w - padL - padR) / (points.length - 1) : 0;
  const xFor = i => padL + i * stepX;
  const yFor = v => padT + (1 - v / maxVal) * (h - padT - padB);

  const actualPts = points.map((p, i) => `${xFor(i)},${yFor(p.actual)}`).join(" ");
  const targetPts = points.map((p, i) => `${xFor(i)},${yFor(p.target || 0)}`).join(" ");

  const dots = points.map((p, i) => `<circle cx="${xFor(i)}" cy="${yFor(p.actual)}" r="3" fill="#C98A02"></circle>`).join("");
  const labels = points.map((p, i) => `<text x="${xFor(i)}" y="${h - 4}" font-size="9.5" fill="#4B5666" text-anchor="middle">${p.label.slice(2)}</text>`).join("");
  const gridY = [0, 0.5, 1].map(f => {
    const y = padT + f * (h - padT - padB);
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#E5E8EA" stroke-width="1"></line>`;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
      ${gridY}
      <polyline points="${targetPts}" fill="none" stroke="#AE4332" stroke-width="1.5" stroke-dasharray="4 3"></polyline>
      <polyline points="${actualPts}" fill="none" stroke="#C98A02" stroke-width="2.5"></polyline>
      ${dots}
      ${labels}
    </svg>
    <div style="display:flex;gap:16px;font-size:11.5px;color:#4B5666;margin-top:4px;">
      <span><span style="display:inline-block;width:10px;height:2.5px;background:#C98A02;vertical-align:middle;margin-right:5px;"></span>Actual</span>
      <span><span style="display:inline-block;width:10px;height:2.5px;background:#AE4332;vertical-align:middle;margin-right:5px;border-top:1.5px dashed #AE4332;"></span>Target</span>
    </div>
  `;
}
