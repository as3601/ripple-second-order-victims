// Ripple guided view: same API as the classic dashboard, laid out as a step-by-step planner.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inr = (n) => Math.round(n).toLocaleString("en-IN");
const short = (n) => n >= 1e7 ? (n / 1e7).toFixed(1) + " crore" : n >= 1e5 ? (n / 1e5).toFixed(1) + " lakh" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n));
const when = (h) => h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${+h.toFixed(1)} h` : `${Math.round(h / 24)} days`;

const TYPES = {
  bridge_collapse: { ico: "🌉", name: "Bridge collapse", desc: "A bridge is damaged or washed away", where: "road",
    lead: "Click the bridge (or any road) on the map, or pick it from the list. Bridges and flyovers are listed first." },
  road_block: { ico: "🚧", name: "Road blocked / accident", desc: "A road is closed or partly blocked", where: "road",
    lead: "Click the blocked road on the map, or search for it below." },
  flood: { ico: "🌊", name: "Flood / waterlogging", desc: "Roads and homes under water", where: "area",
    lead: "Click the centre of the flooded area on the map, then set how wide it is." },
  power_outage: { ico: "⚡", name: "Power outage", desc: "Grid failure across an area", where: "area",
    lead: "Click the centre of the blackout on the map, then set how wide it is." },
  factory_shutdown: { ico: "🏭", name: "Workplace shutdown", desc: "A factory, IT park or market closes", where: "work",
    lead: "Which workplace has shut down? (yellow dots on the map)" },
  disease_outbreak: { ico: "🦠", name: "Disease outbreak", desc: "Dengue, cholera or flu cluster", where: "zone",
    lead: "Which area has the outbreak? You can also click an area circle on the map." },
};
const SEV = [
  [1, "Minor", "Small disruption. For roads: partly blocked, traffic crawls."],
  [2, "Moderate", "Noticeable disruption. For roads: still partly open."],
  [3, "Serious", "Fully closed or out of action. Casualties possible."],
  [4, "Severe", "Major damage, casualties likely, wide knock-on effects."],
  [5, "Extreme", "Disaster-level event. Expect the worst case."],
];
const DURS = [[2, "2 hours"], [6, "6 hours"], [12, "12 hours"], [24, "1 day"], [48, "2 days"], [168, "1 week"]];
const CAT = {
  ems: { ico: "🚑", name: "Emergency care", color: "#dc2626" },
  hospital: { ico: "🏥", name: "Hospitals", color: "#be123c" },
  medicine: { ico: "💊", name: "Medicines", color: "#7c3aed" },
  cold_chain: { ico: "🧊", name: "Vaccines & insulin", color: "#0891b2" },
  residents: { ico: "🏠", name: "Residents", color: "#0f766e" },
  income: { ico: "💼", name: "Jobs & wages", color: "#b45309" },
  food: { ico: "🍚", name: "Food security", color: "#a16207" },
  school: { ico: "🎒", name: "Schools", color: "#2563eb" },
  meals: { ico: "🍱", name: "Mid-day meals", color: "#4f46e5" },
};
const PRI = { Critical: "#dc2626", High: "#ea580c", Medium: "#ca8a04", Low: "#16a34a" };
const PRI_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const BUCKETS = [
  [0, 1, "🔴 Act now", "within the hour"],
  [1, 6, "🟠 Next 6 hours", ""],
  [6, 24, "🟡 Later today", "6–24 hours"],
  [24, Infinity, "🔵 Coming days", "after 24 hours"],
];

const S = { type: null, edge: null, lat: null, lon: null, radius_km: 1.5, workplace: null, zone: null, magnitude: 3, duration_h: 24 };
let step = 1, graph, scenarios = [], result = null, lastPayload = null;
const view = { cat: "all", zone: null, sort: "score" };
const done = new Set(), feedbackGiven = {};
const edgeLayers = {}, zoneLayers = {}, facLayers = {};
let pickLayer = null, epicentre = null;

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600);
}
const kindOf = () => S.type && TYPES[S.type].where;
const facility = (id) => graph.facilities.find((f) => f.id === id);
const edgeById = (id) => edgeLayers[id]?.e;

// ===================================================================== map
const map = L.map("map", { zoomControl: true }).setView([30.72, 76.77], 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 18 }).addTo(map);
const KIND = {
  hospital: { color: "#dc2626", r: 7, label: "Hospital" }, ambulance: { color: "#111827", r: 5, label: "Ambulance base" },
  depot: { color: "#059669", r: 6, label: "Medicine depot" }, workplace: { color: "#eab308", r: 6, label: "Workplace" },
  school: { color: "#7c3aed", r: 5, label: "School" },
};
const baseStyle = (e) => ({ color: e.kind === "bridge" ? "#0284c7" : e.kind === "flyover" ? "#4f46e5" : "#64748b", weight: e.kind === "road" ? 3.5 : 5.5, opacity: 0.85, dashArray: null });

addMapLegend(map);

function drawGraph() {
  const nodeById = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  for (const e of graph.edges) {
    const a = nodeById[e.a], b = nodeById[e.b], ll = [[a.lat, a.lon], [b.lat, b.lon]];
    const line = L.polyline(ll, { ...baseStyle(e), interactive: false }).addTo(map);
    const hit = L.polyline(ll, { weight: 20, opacity: 0, color: "#000" }).addTo(map);
    hit.bindTooltip(`<b>${esc(e.name)}</b><br>${e.km} km · ${e.time.toFixed(1)} min drive${e.source === "OSRM" ? " (real OSRM time)" : ""}<br><i>Click to choose this road</i>`, { sticky: true });
    hit.on("click", (ev) => { L.DomEvent.stopPropagation(ev); onRoadClick(e); });
    edgeLayers[e.id] = { line, hit, e };
  }
  for (const f of graph.facilities) {
    if (f.kind === "zone") {
      const c = L.circle([f.lat, f.lon], { radius: Math.sqrt(f.pop) * 2.4, color: "#2563eb", weight: 1, fillOpacity: 0.08 }).addTo(map);
      c.bindTooltip(`<b>${esc(f.name)}</b><br>${inr(f.pop)} residents<br>${Math.round(f.elderly * 100)}% elderly · ${Math.round(f.children * 100)}% children · ${Math.round(f.low_income * 100)}% low-income`);
      c.on("click", () => onZoneClick(f.id));
      zoneLayers[f.id] = c;
    } else {
      const k = KIND[f.kind];
      const m = L.circleMarker([f.lat, f.lon], { radius: k.r, color: "#fff", weight: 1.5, fillColor: k.color, fillOpacity: 1 }).addTo(map);
      m.bindTooltip(`<b>${esc(f.name)}</b><br>${k.label}`);
      if (f.kind === "workplace") m.on("click", (ev) => { L.DomEvent.stopPropagation(ev); onWorkClick(f.id); });
      facLayers[f.id] = m;
    }
  }
  Object.values(edgeLayers).forEach(({ hit }) => hit.bringToFront());
  Object.values(facLayers).forEach((m) => m.bringToFront());
}

function highlightEdge(id) {
  if (pickLayer) { map.removeLayer(pickLayer); pickLayer = null; }
  const sel = edgeLayers[id];
  if (!sel) return;
  pickLayer = L.polyline(sel.line.getLatLngs(), { color: "#2563eb", weight: 14, opacity: 0.3, interactive: false }).addTo(map);
  pickLayer.bringToBack();
}
function setEpicentre(lat, lon) {
  S.lat = lat; S.lon = lon;
  if (epicentre) map.removeLayer(epicentre);
  epicentre = L.circle([lat, lon], { radius: S.radius_km * 1000, color: "#dc2626", weight: 2, dashArray: "6 6", fillOpacity: 0.08, interactive: false }).addTo(map);
}
function clearEpicentre() { if (epicentre) map.removeLayer(epicentre); epicentre = null; }

function onRoadClick(e) {
  if (kindOf() !== "road") S.type = e.kind === "bridge" ? "bridge_collapse" : "road_block";
  S.edge = e.id; highlightEdge(e.id); clearEpicentre();
  if (step === 4) return run();
  renderStep1(); goto(2);
  toast(`Selected: ${e.name}`);
}
map.on("click", (ev) => {
  if (kindOf() !== "area") { if (step <= 2 && S.type == null) toast("First choose what happened, e.g. Flood"); return; }
  setEpicentre(ev.latlng.lat, ev.latlng.lng);
  if (step === 4) return run();
  renderWhere();
});
function onZoneClick(zid) {
  if (kindOf() === "area") return; // the map click handler sets the epicentre
  if (S.type === "disease_outbreak" && step < 4) { S.zone = zid; renderWhere(); return; }
  if (step === 4 && result) { view.zone = zid; view.cat = "all"; renderAlerts(); $("#who")?.scrollIntoView({ behavior: "smooth" }); }
}
function onWorkClick(wid) {
  if (S.type === "factory_shutdown" && step < 4) { S.workplace = wid; renderWhere(); }
  else if (step === 4 && S.type === "factory_shutdown") { S.workplace = wid; run(); }
}

function banner() {
  const b = $("#map-banner"), k = kindOf();
  const msg = step === 1 ? "Step 1: choose what happened in the panel →"
    : step === 2 ? { road: "👆 Click a road or bridge", area: "👆 Click the centre of the affected area", work: "👆 Click a yellow workplace dot, or pick from the list", zone: "👆 Click a blue area circle, or pick from the list" }[k]
    : step === 3 ? "Step 3: set severity and duration →"
    : { road: "Tip: click any other road to break it and re-run instantly", area: "Tip: click elsewhere to move the epicentre and re-run", work: "Tip: click another workplace to compare", zone: "Tip: click an area circle to see only its alerts" }[k];
  b.textContent = msg || ""; b.hidden = !msg;
}

// =================================================================== steps
function whereComplete() {
  return { road: !!S.edge, area: S.lat != null, work: !!S.workplace, zone: !!S.zone }[kindOf()] ?? false;
}
function goto(n) {
  if (n >= 2 && !S.type) return toast("Choose what happened first");
  if (n >= 3 && !whereComplete()) return toast("Pick where it happened first");
  if (n === 4 && !result) return toast("Run the prediction first");
  step = n;
  paintStepper();
  for (let i = 1; i <= 4; i++) $(`#step-${i}`).hidden = i !== n;
  if (n === 2) renderWhere();
  if (n === 3) renderHowBad();
  banner();
  $("#panel").scrollTo({ top: 0, behavior: "smooth" });
}
function paintStepper() {
  document.querySelectorAll(".stepper li").forEach((li) => {
    const s = +li.dataset.step;
    li.classList.toggle("on", s === step);
    li.classList.toggle("done", s < step);
    li.classList.toggle("locked", (s >= 2 && !S.type) || (s >= 3 && !whereComplete()) || (s === 4 && !result));
  });
}
document.querySelectorAll(".stepper button").forEach((b) => b.addEventListener("click", () => goto(+b.parentElement.dataset.step)));
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => goto(+b.dataset.go)));
$("#to-step-3").addEventListener("click", () => goto(3));

// ------------------------------------------------------------------ step 1
function renderStep1() {
  $("#type-grid").innerHTML = Object.entries(TYPES).map(([k, t]) => `
    <button type="button" class="type-card" role="radio" aria-checked="${S.type === k}" aria-label="${t.name}: ${t.desc}" data-type="${k}">
      <span class="ico" aria-hidden="true">${t.ico}</span><b>${t.name}</b><small>${t.desc}</small>
    </button>`).join("");
}
$("#type-grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-type]"); if (!b) return;
  const t = b.dataset.type, oldKind = kindOf();
  S.type = t;
  if (TYPES[t].where !== oldKind) { S.edge = null; S.zone = null; S.workplace = null; S.lat = S.lon = null; clearEpicentre(); highlightEdge(null); }
  renderStep1(); goto(2);
});
function renderScenarios() {
  $("#scenario-grid").innerHTML = scenarios.map((s, i) => `
    <button type="button" class="scn" data-i="${i}">
      <span class="ico" aria-hidden="true">${TYPES[s.type].ico}</span>
      <span><b>${esc(s.label)}</b><small>${SEV[s.magnitude - 1][1]} · lasts ${when(s.duration_h)}</small></span>
      <span class="go">Run ▶</span>
    </button>`).join("");
}
$("#scenario-grid").addEventListener("click", (e) => {
  const b = e.target.closest(".scn"); if (!b) return;
  const s = scenarios[+b.dataset.i];
  Object.assign(S, { type: s.type, edge: s.edge || null, workplace: s.workplace || null, zone: s.zone || null,
    lat: s.lat ?? null, lon: s.lon ?? null, radius_km: s.radius_km || 1.5, magnitude: s.magnitude, duration_h: s.duration_h });
  S.label = s.label;
  highlightEdge(S.edge);
  if (S.lat != null) setEpicentre(S.lat, S.lon); else clearEpicentre();
  renderStep1(); run();
});

// ------------------------------------------------------------------ step 2
function renderWhere() {
  const k = kindOf(), t = TYPES[S.type];
  $("#where-title").textContent = `${t.ico} Where is the ${t.name.toLowerCase()}?`;
  $("#where-lead").textContent = t.lead;
  for (const w of ["road", "area", "work", "zone"]) $(`#where-${w}`).hidden = w !== k;
  if (k === "road") renderRoadList();
  if (k === "area") {
    const st = $("#epicentre-status");
    st.className = "callout" + (S.lat != null ? " ok" : "");
    st.textContent = S.lat != null ? `✓ Centre set at ${S.lat.toFixed(4)}, ${S.lon.toFixed(4)}. Click again to move it.` : "👆 Click anywhere on the map to drop the centre point.";
    $("#radius").value = S.radius_km; $("#radius-out").textContent = `${S.radius_km} km`;
  }
  if (k === "work") {
    const dependents = (wid) => graph.facilities.filter((f) => f.kind === "zone" && f.work === wid);
    $("#work-list").innerHTML = graph.facilities.filter((f) => f.kind === "workplace").map((w) => {
      const zs = dependents(w.id), workers = zs.reduce((s, z) => s + z.pop * z.workers, 0);
      return `<button type="button" class="pick" role="option" aria-selected="${S.workplace === w.id}" data-id="${w.id}">
        <span class="ico">🏭</span><span>${esc(w.name)}<small>${zs.length ? `Workers from ${zs.map((z) => esc(z.name)).join(", ")} (~${short(workers)})` : "Few workers mapped"}</small></span></button>`;
    }).join("");
  }
  if (k === "zone") {
    $("#zone-list").innerHTML = graph.facilities.filter((f) => f.kind === "zone").map((z) => `
      <button type="button" class="pick" role="option" aria-selected="${S.zone === z.id}" data-id="${z.id}">
        <span class="ico">🏘️</span><span>${esc(z.name)}<small>${inr(z.pop)} residents · ${Math.round(z.elderly * 100)}% elderly · ${Math.round(z.low_income * 100)}% low-income</small></span></button>`).join("");
  }
  $("#to-step-3").disabled = !whereComplete();
  paintStepper();
}
function renderRoadList() {
  const q = $("#road-search").value.trim().toLowerCase();
  const rank = { bridge: 0, flyover: 1, road: 2 };
  const list = [...graph.edges].filter((e) => !q || e.name.toLowerCase().includes(q))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
  $("#road-list").innerHTML = list.map((e) => `
    <button type="button" class="pick" role="option" aria-selected="${S.edge === e.id}" data-id="${e.id}">
      <span class="ico">${e.kind === "bridge" ? "🌉" : e.kind === "flyover" ? "⤴️" : "🛣️"}</span>
      <span>${esc(e.name)}<small>${e.km} km · ${e.time.toFixed(1)} min drive</small></span><span class="tagr">${e.kind}</span>
    </button>`).join("") || `<p class="hint">No road matches "${esc(q)}".</p>`;
}
$("#road-search").addEventListener("input", renderRoadList);
$("#road-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]"); if (!b) return;
  S.edge = b.dataset.id; highlightEdge(S.edge);
  map.fitBounds(edgeLayers[S.edge].line.getBounds(), { padding: [80, 80], maxZoom: 14 });
  renderWhere();
});
$("#work-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]"); if (!b) return;
  S.workplace = b.dataset.id; const f = facility(S.workplace); map.setView([f.lat, f.lon], 13); renderWhere();
});
$("#zone-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]"); if (!b) return;
  S.zone = b.dataset.id; const f = facility(S.zone); map.setView([f.lat, f.lon], 13); renderWhere();
});
$("#radius").addEventListener("input", (e) => {
  S.radius_km = +e.target.value; $("#radius-out").textContent = `${S.radius_km} km`;
  if (epicentre) epicentre.setRadius(S.radius_km * 1000);
});

// ------------------------------------------------------------------ step 3
function whereText() {
  return { road: () => edgeById(S.edge)?.name, area: () => `${S.radius_km} km around ${S.lat?.toFixed(3)}, ${S.lon?.toFixed(3)}`,
    work: () => facility(S.workplace)?.name, zone: () => facility(S.zone)?.name }[kindOf()]?.() || "";
}
function describe() {
  const t = TYPES[S.type];
  return `${t.ico} <b>${t.name}</b> at <b>${esc(whereText())}</b> · ${SEV[S.magnitude - 1][1]} · lasting ${when(S.duration_h)}`;
}
function renderHowBad() {
  $("#sev-chips").innerHTML = SEV.map(([v, n]) => `<button type="button" class="chip" aria-pressed="${S.magnitude === v}" data-v="${v}">${v} · ${n}</button>`).join("");
  $("#sev-hint").textContent = SEV[S.magnitude - 1][2];
  $("#dur-chips").innerHTML = DURS.map(([h, n]) => `<button type="button" class="chip" aria-pressed="${S.duration_h === h}" data-h="${h}">${n}</button>`).join("");
  $("#dur-custom").value = S.duration_h;
  $("#event-summary").innerHTML = describe();
}
$("#sev-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { S.magnitude = +b.dataset.v; renderHowBad(); } });
$("#dur-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-h]"); if (b) { S.duration_h = +b.dataset.h; renderHowBad(); } });
$("#dur-custom").addEventListener("change", (e) => { S.duration_h = Math.min(720, Math.max(1, +e.target.value || 24)); renderHowBad(); });
$("#run").addEventListener("click", () => { S.label = null; run(); });

// ================================================================= running
function payload() {
  const t = TYPES[S.type], ev = { type: S.type, magnitude: S.magnitude, duration_h: S.duration_h, radius_km: S.radius_km };
  const k = t.where;
  if (k === "road") ev.edge = S.edge;
  if (k === "area") { ev.lat = S.lat; ev.lon = S.lon; }
  if (k === "work") ev.workplace = S.workplace;
  if (k === "zone") ev.zone = S.zone;
  ev.label = S.label || `${t.name}: ${whereText()}`;
  return ev;
}
async function run() {
  $("#err").textContent = "";
  const ev = payload();
  lastPayload = ev;
  step = 4; for (let i = 1; i <= 4; i++) $(`#step-${i}`).hidden = i !== 4;
  $("#loading").hidden = false; $("#results").style.opacity = 0.4;
  try {
    result = await api("/api/simulate", ev);
  } catch (e) {
    $("#loading").hidden = true; $("#results").style.opacity = 1;
    $("#err").textContent = e.message; goto(3); return;
  }
  $("#loading").hidden = true; $("#results").style.opacity = 1;
  view.cat = "all"; view.zone = null; done.clear();
  paintMap(result); renderResults(result); goto(4);
  api("/api/brief", ev).then((b) => {
    if (lastPayload !== ev) return;
    const SRC = { ollama: "Local AI · offline", groq: "AI · Groq", gemini: "AI · Gemini", claude: "AI · Claude" };
    $("#brief-text").textContent = b.briefing;
    $("#brief-src").textContent = SRC[b.source] || "Template (AI unavailable)";
    if (b.hidden_links?.length) { result.hidden_links = [...b.hidden_links, ...result.hidden_links]; renderHidden(); }
  }).catch(() => { $("#brief-text").textContent = "Briefing unavailable right now. The predictions below are unaffected."; });
}

function paintMap(r) {
  const gs = r.graph_state;
  for (const { line, e } of Object.values(edgeLayers)) {
    if (gs.removed.includes(e.id)) line.setStyle({ color: "#dc2626", weight: 7, dashArray: "8 8" });
    else if (gs.slowed.includes(e.id)) line.setStyle({ color: "#f59e0b", weight: 6, dashArray: null });
    else if (gs.congested.includes(e.id)) line.setStyle({ color: "#eab308", weight: 5, dashArray: "2 7" });
    else line.setStyle(baseStyle(e));
  }
  const worst = worstByZone(r);
  const bounds = [];
  for (const [zid, c] of Object.entries(zoneLayers)) {
    const w = worst[zid];
    c.setStyle(w ? { color: PRI[w.priority], fillColor: PRI[w.priority], fillOpacity: 0.25, weight: 2 } : { color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.08, weight: 1 });
    if (w) bounds.push(c.getLatLng());
  }
  for (const h of r.hospital_load) {
    facLayers[h.id].setRadius(h.ratio >= 0.95 ? 13 : 7);
    facLayers[h.id].setTooltipContent(`<b>${esc(h.name)}</b><br>Emergency ward ${Math.round(h.ratio * 100)}% full${h.extra ? ` (+${h.extra} patients)` : ""}`);
    if (h.ratio >= 0.95) bounds.push(facLayers[h.id].getLatLng());
  }
  if (S.edge && kindOf() === "road") bounds.push(...edgeLayers[S.edge].line.getLatLngs());
  if (S.lat != null && kindOf() === "area") bounds.push(L.latLng(S.lat, S.lon));
  if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 13 });
}
function worstByZone(r) {
  const w = {};
  for (const i of r.impacts) if (i.zone && (!w[i.zone] || w[i.zone].score < i.score)) w[i.zone] = i;
  return w;
}

// ================================================================= results
function renderResults(r) {
  const t = r.totals, ev = r.event, T = TYPES[ev.type];
  const head = r.impacts.length
    ? `${short(t.people)} people across ${t.zones} area${t.zones === 1 ? "" : "s"} will feel the knock-on effects. The first of them in <span style="color:var(--crit)">${when(t.first_eta_h)}</span>.`
    : "No serious knock-on effects are predicted for this event. Try a higher severity or longer duration.";
  $("#results").innerHTML = `
    <article class="card hero" aria-live="polite">
      <div class="ev">${T.ico} ${esc(ev.label || T.name)} · ${SEV[ev.magnitude - 1][1]} · lasting ${when(ev.duration_h)}</div>
      <p class="headline">${head}</p>
      <div class="stats">
        <div class="stat"><b>${short(t.people)}</b><span>people affected downstream</span></div>
        <div class="stat crit"><b>${t.critical}</b><span>critical alerts</span></div>
        <div class="stat"><b>${t.zones}</b><span>areas hit</span></div>
        <div class="stat"><b>${t.first_eta_h == null ? "—" : when(t.first_eta_h)}</b><span>until first impact</span></div>
      </div>
      <div class="tools" style="margin-top:12px">
        <button class="btn sm" type="button" data-act="edit">✏️ Change event</button>
        <button class="btn sm" type="button" data-act="new">➕ New event</button>
        <button class="btn sm" type="button" data-act="print">🖨️ Print / save PDF</button>
        <button class="btn sm" type="button" data-act="copy-sum">📋 Copy summary</button>
      </div>
    </article>

    <article class="card">
      <div class="card-head"><h2>🧠 Control-room briefing</h2><span class="badge" id="brief-src">writing…</span></div>
      <p class="brief-text" id="brief-text">The local AI is writing a plain-language briefing (takes about 6 seconds)…</p>
      <div class="tools" style="margin-top:10px">
        <button class="btn sm" type="button" data-act="speak">🔊 Read aloud</button>
        <button class="btn sm" type="button" data-act="copy-brief">📋 Copy briefing</button>
      </div>
    </article>

    ${r.impacts.length ? `
    <article class="card" id="plan">
      <div class="card-head"><h2>✅ What to do, in order</h2><span class="badge" id="plan-progress"></span></div>
      <p class="hint" style="margin-top:0">Tick an action once someone is assigned to it.</p>
      <div id="plan-body"></div>
    </article>

    <article class="card" id="who">
      <div class="card-head"><h2>👥 Who is affected</h2></div>
      <div id="zone-filter"></div>
      <div class="filters" id="cat-filters"></div>
      <div class="sort-row"><span id="alert-count"></span>
        <label>Sort by <select id="sort">
          <option value="score">Priority</option><option value="eta">Soonest first</option><option value="people">Most people</option>
        </select></label></div>
      <div id="alert-list"></div>
    </article>

    <article class="card"><h2>📊 Impact by type</h2><div class="bars" id="bars"></div></article>
    <article class="card"><h2>📍 Areas hit</h2><p class="hint" style="margin-top:0">Click an area to see only its alerts.</p><div class="areas" id="areas"></div></article>` : ""}

    <article class="card"><h2>🏥 Hospital emergency wards</h2><p class="hint" style="margin-top:0">Projected load after patients are re-routed. The line marks 95%, where a ward starts to fail.</p><div id="hosp"></div></article>
    <article class="card"><h2>🧱 What physically broke <small class="badge">1st order</small></h2><ul class="plain">${r.first_order.map((f) => `<li>${esc(f.what)}</li>`).join("") || "<li>Nothing physical. This is an economic or health event.</li>"}</ul></article>
    <article class="card"><h2>✦ Hidden risks to check</h2><p class="hint" style="margin-top:0">Suggested by the AI and expert heuristics. The model doesn't calculate these, so verify them before acting.</p><ul class="plain" id="hidden"></ul></article>
    <p class="hint" style="text-align:center"><button class="btn sm ghost" type="button" data-act="help">How was this calculated?</button></p>`;
  if (r.impacts.length) { renderPlan(); renderAlerts(); renderBars(); renderAreas(); }
  renderHosp(); renderHidden();
}

function renderPlan() {
  const items = [...result.impacts].sort((a, b) => a.eta_h - b.eta_h || b.score - a.score);
  $("#plan-body").innerHTML = BUCKETS.map(([lo, hi, title, sub]) => {
    const its = items.filter((i) => i.eta_h >= lo && i.eta_h < hi);
    if (!its.length) return "";
    return `<div class="plan-col"><h3>${title} <small>${sub} · ${its.length}</small></h3>${its.map((i) => {
      const key = i.title, isDone = done.has(key);
      return `<label class="plan-item${isDone ? " done" : ""}"><input type="checkbox" data-key="${esc(key)}" ${isDone ? "checked" : ""}>
        <span><span class="what">${CAT[i.category].ico} ${esc(i.title)}</span><br><span class="how">${esc(i.action)}</span></span></label>`;
    }).join("")}</div>`;
  }).join("");
  $("#plan-progress").textContent = `${done.size} of ${items.length} assigned`;
}

function chainFor(i) {
  const r = result, steps = [r.event.label || TYPES[r.event.type].name];
  if (i.order >= 2 && r.first_order.length) steps.push(r.first_order.length > 1 ? `${r.first_order.length} things broke` : r.first_order[0].what);
  if (i.order === 3 && i.parent) {
    const p = r.impacts.find((j) => j.order === 2 && j.category === i.parent && j.zone === i.zone);
    if (p) steps.push(p.title);
  }
  steps.push(i.title);
  return steps.map((s) => `<span>${esc(s)}</span>`).join("<i>→</i>");
}
function filtered() {
  let list = result.impacts.filter((i) => (view.cat === "all" || i.category === view.cat) && (!view.zone || i.zone === view.zone));
  const s = view.sort;
  return list.sort((a, b) => s === "eta" ? a.eta_h - b.eta_h : s === "people" ? b.people - a.people : b.score - a.score);
}
function renderAlerts() {
  const base = result.impacts.filter((i) => !view.zone || i.zone === view.zone);
  const counts = {};
  for (const i of base) counts[i.category] = (counts[i.category] || 0) + 1;
  $("#cat-filters").innerHTML = `<button type="button" class="chip" aria-pressed="${view.cat === "all"}" data-cat="all">All · ${base.length}</button>` +
    Object.entries(counts).map(([c, n]) => `<button type="button" class="chip" aria-pressed="${view.cat === c}" data-cat="${c}">${CAT[c].ico} ${CAT[c].name} · ${n}</button>`).join("");
  $("#zone-filter").innerHTML = view.zone ? `<div class="zone-filter">📍 Showing only <b>${esc(facility(view.zone).name)}</b><button class="btn sm" type="button" data-act="clear-zone">Show all areas</button></div>` : "";
  $("#sort").value = view.sort;
  const list = filtered();
  $("#alert-count").textContent = `${list.length} alert${list.length === 1 ? "" : "s"}`;
  $("#alert-list").innerHTML = list.map((i, idx) => {
    const fb = feedbackGiven[i.title];
    return `<details class="alert ${i.priority}" ${idx === 0 && i.priority === "Critical" ? "open" : ""}>
      <summary>
        <span class="ico" aria-hidden="true">${CAT[i.category].ico}</span>
        <span class="t">${esc(i.title)}</span>
        <span class="pri ${i.priority}">${i.priority.toUpperCase()}</span>
        <span class="m"><span class="ord o${i.order}">${["", "1st", "2nd", "3rd"][i.order]} order</span>👥 ${inr(i.people)} people · ⏱ in ${when(i.eta_h)} · score ${i.score}</span>
      </summary>
      <div class="body">
        <div class="chain" aria-label="Cause chain">${chainFor(i)}</div>
        <p class="why"><b>Why:</b> ${esc(i.detail)}</p>
        <p class="why">Vulnerability <span class="meter"><i style="width:${Math.round(i.vulnerability * 100)}%"></i></span> ${Math.round(i.vulnerability * 100)}% <small>(how many elderly, children and low-income people are involved)</small></p>
        <p class="act"><b>What to do:</b> ${esc(i.action)}</p>
        <div class="fb">Did this happen?
          <button class="btn sm${fb === true ? " on" : ""}" type="button" data-fb="1" data-title="${esc(i.title)}">✓ Yes</button>
          <button class="btn sm${fb === false ? " on" : ""}" type="button" data-fb="0" data-title="${esc(i.title)}">✗ No</button>
          <span>Your answer re-weights future ${esc(CAT[i.category].name.toLowerCase())} predictions.</span>
        </div>
      </div>
    </details>`;
  }).join("") || `<p class="hint">No alerts match this filter.</p>`;
}
function renderBars() {
  const by = {};
  for (const i of result.impacts) by[i.category] = (by[i.category] || 0) + i.people;
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]), max = rows[0]?.[1] || 1;
  $("#bars").innerHTML = rows.map(([c, n]) => `<div class="row"><span>${CAT[c].ico} ${CAT[c].name}</span>
    <span class="track"><i style="width:${Math.max(3, (n / max) * 100)}%;background:${CAT[c].color}"></i></span><span class="n">${short(n)}</span></div>`).join("");
}
function renderAreas() {
  const worst = worstByZone(result);
  const zones = Object.keys(worst).map((z) => facility(z)).sort((a, b) => worst[b.id].score - worst[a.id].score);
  $("#areas").innerHTML = zones.map((z) => {
    const n = result.impacts.filter((i) => i.zone === z.id).length, w = worst[z.id];
    return `<button type="button" class="area" data-zone="${z.id}">
      <span class="nm">${esc(z.name)}</span><span class="cnt"><span class="pri ${w.priority}">${w.priority}</span> ${n} alert${n === 1 ? "" : "s"}</span>
      <span class="prof">${inr(z.pop)} residents · ${Math.round(z.elderly * 100)}% elderly · ${Math.round(z.children * 100)}% children · ${Math.round(z.low_income * 100)}% low-income</span>
    </button>`;
  }).join("");
}
function renderHosp() {
  $("#hosp").innerHTML = [...result.hospital_load].sort((a, b) => b.ratio - a.ratio).map((h) => {
    const p = Math.round(h.ratio * 100), c = p >= 95 ? "#dc2626" : p >= 85 ? "#ea580c" : "#16a34a";
    const status = p >= 95 ? "Over capacity" : p >= 85 ? "Under strain" : "Coping";
    return `<div class="hosp"><div class="top-row"><b>${esc(h.name)}</b><span style="color:${c};font-weight:600">${p}% · ${status}</span></div>
      <div class="track"><i style="width:${Math.min(100, p)}%;background:${c}"></i><em></em></div>
      ${h.extra ? `<small>+${h.extra} extra patients from ${esc(h.sources.join(", "))}</small>` : ""}</div>`;
  }).join("");
}
function renderHidden() {
  const el = $("#hidden"); if (!el) return;
  el.innerHTML = result.hidden_links.map((h) => `<li class="${h.source !== "heuristic" ? "ai-li" : ""}">${esc(h.text)}${h.source !== "heuristic" ? ' <small class="badge">AI</small>' : ""}</li>`).join("") || "<li>None suggested.</li>";
}

// ------------------------------------------------------- results interactions
$("#results").addEventListener("click", async (e) => {
  const chip = e.target.closest("[data-cat]");
  if (chip) { view.cat = chip.dataset.cat; return renderAlerts(); }
  const area = e.target.closest("[data-zone]");
  if (area) {
    view.zone = area.dataset.zone; view.cat = "all"; renderAlerts();
    const f = facility(view.zone); map.setView([f.lat, f.lon], 13);
    return $("#who").scrollIntoView({ behavior: "smooth" });
  }
  const fbBtn = e.target.closest("[data-fb]");
  if (fbBtn) {
    const i = result.impacts.find((x) => x.title === fbBtn.dataset.title), yes = fbBtn.dataset.fb === "1";
    try {
      const stats = await api("/api/feedback", { category: i.category, happened: yes });
      feedbackGiven[i.title] = yes;
      toast(`Thanks! ${CAT[i.category].name} predictions now weigh ×${stats[i.category].factor}`);
      renderAlerts();
    } catch { toast("Couldn't save feedback"); }
    return;
  }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "edit") goto(3);
  if (act === "new") { S.type = null; S.edge = S.zone = S.workplace = null; S.lat = S.lon = null; clearEpicentre(); highlightEdge(null); renderStep1(); goto(1); }
  if (act === "print") { document.querySelectorAll("details").forEach((d) => (d.open = true)); window.print(); }
  if (act === "copy-sum") copy(summaryText(), "Summary copied");
  if (act === "copy-brief") copy($("#brief-text").textContent, "Briefing copied");
  if (act === "speak") speak($("#brief-text").textContent);
  if (act === "clear-zone") { view.zone = null; renderAlerts(); }
  if (act === "help") openHelp();
});
$("#results").addEventListener("change", (e) => {
  if (e.target.id === "sort") { view.sort = e.target.value; renderAlerts(); }
  if (e.target.matches("input[data-key]")) {
    const k = e.target.dataset.key;
    e.target.checked ? done.add(k) : done.delete(k);
    e.target.closest(".plan-item").classList.toggle("done", e.target.checked);
    $("#plan-progress").textContent = `${done.size} of ${result.impacts.length} assigned`;
  }
});
function summaryText() {
  const r = result, t = r.totals;
  const top = [...r.impacts].slice(0, 5).map((i) => `- [${i.priority}] ${i.title} (in ${when(i.eta_h)}): ${i.action}`).join("\n");
  return `RIPPLE ALERT: ${r.event.label}\n${short(t.people)} people across ${t.zones} areas affected; ${t.critical} critical; first impact in ${t.first_eta_h == null ? "n/a" : when(t.first_eta_h)}.\nTop actions:\n${top}`;
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast("Copy not allowed in this browser"); }
}
function speak(text) {
  if (!("speechSynthesis" in window)) return toast("Read-aloud isn't supported in this browser");
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
  const u = new SpeechSynthesisUtterance(text); u.lang = "en-IN"; u.rate = 1;
  speechSynthesis.speak(u);
}

// =================================================================== help
function openHelp() { $("#help").hidden = false; $("#help .close").focus(); }
function closeHelp() { $("#help").hidden = true; $("#open-help").focus(); }
$("#open-help").addEventListener("click", openHelp);
$("#help").addEventListener("click", (e) => { if (e.target.id === "help" || e.target.closest("[data-close]")) closeHelp(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#help").hidden) closeHelp(); });

// =================================================================== init
(async () => {
  try {
    [graph, scenarios] = await Promise.all([api("/api/graph"), api("/api/scenarios")]);
  } catch (e) {
    $("#step-1").insertAdjacentHTML("afterbegin", `<p class="err">Can't reach the Ripple server: ${esc(e.message)}. Is python app.py running?</p>`);
    return;
  }
  drawGraph(); renderStep1(); renderScenarios(); goto(1);
  setTimeout(() => map.invalidateSize(), 200);
})();
