// Editor: live preview rendered by the server (same code as the public page, so
// {{placeholders}}, ratios and bands are exact), plus click-to-insert placeholder chips.
(function () {
  const form = document.getElementById("editor-form");
  const out = document.getElementById("preview");
  if (!form || !out) return;

  let timer = null, seq = 0;
  async function refresh() {
    const my = ++seq;
    try {
      const res = await fetch(form.dataset.preview, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(new FormData(form)),
        credentials: "same-origin",
      });
      if (!res.ok || my !== seq) return;
      const data = await res.json();
      out.innerHTML = data.html;
      document.getElementById("runway-live").textContent = data.runway ?? "—";
    } catch {}
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 300); };
  form.addEventListener("input", schedule);

  // Insert {{token}} at the cursor of the last focused text field (defaults to the letter).
  let target = form.elements.body_markdown;
  form.addEventListener("focusin", (e) => { if (e.target.tagName === "TEXTAREA") target = e.target; });
  form.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const text = `{{${chip.dataset.token}}}`;
    const s = target.selectionStart ?? target.value.length, en = target.selectionEnd ?? s;
    target.value = target.value.slice(0, s) + text + target.value.slice(en);
    target.focus();
    target.selectionStart = target.selectionEnd = s + text.length;
    dirty = true;
    schedule();
  });

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
})();
