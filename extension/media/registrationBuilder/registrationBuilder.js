(/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();

const els = {
  form: document.getElementById("form"),
  docLabel: document.getElementById("docLabel"),
  ptype: document.getElementById("ptype"),
  ttype: document.getElementById("ttype"),
  materials: document.getElementById("materials"),
  zones: document.getElementById("zones"),
  objects: document.getElementById("objects"),
  energy: document.getElementById("energy"),
  includeFlux: document.getElementById("includeFlux"),
  includeReactions: document.getElementById("includeReactions"),
  reactions: document.getElementById("reactions"),
  reactionsWrap: document.getElementById("reactionsWrap"),
  matChips: document.getElementById("matChips"),
  zoneChips: document.getElementById("zoneChips"),
  preview: document.getElementById("preview"),
  warnings: document.getElementById("warnings"),
  rgsHint: document.getElementById("rgsHint"),
  btnInsert: document.getElementById("btnInsert"),
  btnRefresh: document.getElementById("btnRefresh"),
};

function readForm() {
  const ttypeRaw = els.ttype.value;
  return {
    ptype: Number(els.ptype.value),
    ttype: ttypeRaw === "" ? undefined : Number(ttypeRaw),
    materials: els.materials.value,
    zones: els.zones.value,
    objects: els.objects.value,
    energy: els.energy.value,
    includeFlux: els.includeFlux.checked,
    includeReactions: els.includeReactions.checked,
    reactions: els.reactions.value,
  };
}

function writeForm(form) {
  if (!form) return;
  els.ptype.value = String(form.ptype ?? 1);
  els.ttype.value = form.ttype == null ? "" : String(form.ttype);
  els.materials.value = form.materials ?? "";
  els.zones.value = form.zones ?? "";
  els.objects.value = form.objects ?? "";
  els.energy.value = form.energy ?? "0";
  els.includeFlux.checked = form.includeFlux !== false;
  els.includeReactions.checked = !!form.includeReactions;
  els.reactions.value = form.reactions ?? "1";
  els.reactionsWrap.hidden = !els.includeReactions.checked;
}

function appendToken(input, token) {
  const cur = input.value.trim();
  const parts = cur ? cur.split(/[\s,;]+/).filter(Boolean) : [];
  if (!parts.includes(token)) parts.push(token);
  input.value = parts.join(" ");
  schedulePreview();
}

function renderChips(hints) {
  els.matChips.innerHTML = "";
  for (const m of hints?.materials ?? []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rb-chip";
    btn.textContent = m.label || String(m.number);
    btn.addEventListener("click", () => appendToken(els.materials, String(m.number)));
    els.matChips.appendChild(btn);
  }

  els.zoneChips.innerHTML = "";
  for (const z of hints?.zones ?? []) {
    if (z.regNum == null) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rb-chip";
    btn.textContent = `${z.regNum} · ${z.name}`;
    btn.addEventListener("click", () => appendToken(els.zones, String(z.regNum)));
    els.zoneChips.appendChild(btn);
  }

  if (hints?.hasRgs) {
    els.rgsHint.textContent = "RGS найден — вставка перед FINISH регистрации.";
    els.rgsHint.classList.remove("warn");
  } else {
    els.rgsHint.textContent = "В активном файле нет RGS/REG — сначала вставьте заголовок регистрации.";
    els.rgsHint.classList.add("warn");
  }
}

let previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    vscode.postMessage({ type: "preview", form: readForm() });
  }, 120);
}

els.form.addEventListener("input", schedulePreview);
els.form.addEventListener("change", () => {
  els.reactionsWrap.hidden = !els.includeReactions.checked;
  schedulePreview();
});

els.btnInsert.addEventListener("click", () => {
  vscode.postMessage({ type: "insert", form: readForm() });
});

els.btnRefresh.addEventListener("click", () => {
  vscode.postMessage({ type: "refreshHints" });
});

window.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "state") {
    writeForm(msg.form);
    els.docLabel.textContent = msg.docLabel || "";
    renderChips(msg.hints);
  }
  if (msg.type === "preview") {
    els.preview.textContent = msg.text || "";
    els.warnings.innerHTML = "";
    for (const w of msg.warnings || []) {
      const li = document.createElement("li");
      li.textContent = w;
      els.warnings.appendChild(li);
    }
  }
});

vscode.postMessage({ type: "ready" });
)
