// Copy-to-clipboard buttons: <button data-copy="text">Copy link</button> → shows "Copied".
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;
  const text = btn.getAttribute("data-copy");
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
  }
  const label = btn.dataset.label || btn.textContent;
  btn.dataset.label = label;
  btn.textContent = ok ? "Copied" : "Copy failed";
  btn.classList.add("copied");
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = label; btn.classList.remove("copied"); }, 1600);
});
