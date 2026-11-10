// Live preview for the update editor. Plain DOM + marked; no AI.
(function () {
  const form = document.getElementById("editor-form");
  const out = document.getElementById("preview");
  if (!form || !out) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  if (window.marked) {
    window.marked.use({
      renderer: {
        html(t) { return esc(t.text); },
        link(t) {
          const inner = this.parser.parseInline(t.tokens);
          return /^(https?:|mailto:|\/|#)/i.test(t.href || "") ? `<a href="${esc(t.href)}" target="_blank" rel="noopener">${inner}</a>` : inner;
        },
      },
    });
  }
  const num = (v) => { const n = Number(String(v).replace(/[$,\s]/g, "")); return v !== "" && Number.isFinite(n) ? n : null; };
  const money = (v) => {
    const a = Math.abs(v), s = v < 0 ? "-" : "";
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
    return `${s}$${a}`;
  };
  const labels = { mrr: "MRR", revenue: "Revenue", cash: "Cash", net_burn: "Net burn", headcount: "Headcount" };
  const lines = (name) => form.elements[name].value.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
  const list = (title, items, cls) => items.length ? `<section class="list ${cls}"><h3>${title}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></section>` : "";

  function render() {
    const m = {};
    for (const k of Object.keys(labels)) m[k] = num(form.elements["m_" + k].value);
    const runway = m.cash !== null && m.net_burn !== null && m.net_burn > 0 ? Math.round((m.cash / m.net_burn) * 10) / 10 : null;
    document.getElementById("runway-live").textContent = runway ?? "—";
    let cells = "";
    for (const [k, label] of Object.entries(labels)) {
      if (m[k] === null) continue;
      cells += `<div class="metric"><div class="m-label">${label}</div><div class="m-val">${k === "headcount" ? m[k] : money(m[k])}</div></div>`;
    }
    if (runway !== null) cells += `<div class="metric"><div class="m-label">Runway</div><div class="m-val">${runway} mo</div></div>`;
    form.querySelectorAll(".custom-row").forEach((row) => {
      const [k, v] = row.querySelectorAll("input");
      if (k.value.trim() && v.value.trim()) cells += `<div class="metric"><div class="m-label">${esc(k.value)}</div><div class="m-val">${esc(v.value)}</div></div>`;
    });
    const body = window.marked ? window.marked.parse(form.elements.body_markdown.value) : `<pre>${esc(form.elements.body_markdown.value)}</pre>`;
    out.innerHTML = `<div class="metrics">${cells}</div><div class="lists">${list("Highlights", lines("highlights"), "hi")}${list("Lowlights", lines("lowlights"), "lo")}${list("Asks", lines("asks"), "ask")}</div><article class="prose">${body}</article>`;
  }
  form.addEventListener("input", render);
  document.getElementById("add-custom").addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "custom-row";
    row.innerHTML = '<input name="custom_key[]" placeholder="Name"><input name="custom_val[]" placeholder="Value">';
    document.getElementById("custom-rows").appendChild(row);
  });
  let dirty = false;
  form.addEventListener("input", () => { dirty = true; });
  form.addEventListener("submit", () => { dirty = false; });
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  render();
})();
