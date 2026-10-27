const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => n >= 1e5 ? (n / 1e5).toFixed(1) + " L" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
const PRI_COLOR = { Critical: "#ff4d6d", High: "#ff9f1c", Medium: "#ffd166", Low: "#6ee7b7" };
const KIND_STYLE = {
  hospital: { color: "#ff4d6d", r: 7, label: "Hospital" },
  ambulance: { color: "#ffffff", r: 5, label: "Ambulance base" },
  depot: { color: "#06d6a0", r: 6, label: "Medicine depot" },
  workplace: { color: "#ffd166", r: 6, label: "Workplace" },
  school: { color: "#c77dff", r: 5, label: "School" },
};

let graph, edgeLayers = {}, zoneLayers = {}, facLayers = {}, epicentre, current, lastEvent;

const map = L.map("map", { zoomControl: true }).setView([30.72, 76.76], 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors", maxZoom: 18,
}).addTo(map);

const legend = L.control({ position: "bottomleft" });
legend.onAdd = () => {
  const d = L.DomUtil.create("div", "legend");
  d.innerHTML = `<b style="background:#ff4d6d"></b>Cut (1st order)<br><b style="background:#ff9f1c"></b>Slowed<br>
    <b style="background:#ffd166"></b>Diverted-traffic congestion<br>` +
    Object.values(KIND_STYLE).map((k) => `<s style="background:${k.color}"></s>${k.label}`).join("<br>") +
    `<br><s style="background:#4cc9f055;border:1px solid #4cc9f0"></s>Residential zone (colour = worst alert)`;
  return d;
};
legend.addTo(map);

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
  return r.json();
}

// ------------------------------------------------------------------ map setup
function drawGraph() {
  for (const e of graph.edges) {
    const a = graph.nodes.find((n) => n.id === e.a), b = graph.nodes.find((n) => n.id === e.b);
    const line = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], baseStyle(e)).addTo(map);
    line.bindTooltip(`${e.name} · ${e.kind} · ${e.km} km`, { sticky: true });
    line.on("click", (ev) => {
      L.DomEvent.stopPropagation(ev);
      const t = $("#ev-type").value;
      if (t !== "bridge_collapse" && t !== "road_block") $("#ev-type").value = e.kind === "bridge" ? "bridge_collapse" : "road_block";
      $("#ev-edge").value = e.id; syncForm();
    });
    edgeLayers[e.id] = { line, e };
  }
  for (const f of graph.facilities) {
    if (f.kind === "zone") {
      const c = L.circle([f.lat, f.lon], { radius: Math.sqrt(f.pop) * 2.4, color: "#4cc9f0", weight: 1, fillOpacity: 0.12 }).addTo(map);
      c.bindTooltip(`<b>${f.name}</b><br>${f.pop.toLocaleString()} residents · ${Math.round(f.elderly * 100)}% elderly · ${Math.round(f.low_income * 100)}% low-income`);
      zoneLayers[f.id] = c;
    } else {
      const s = KIND_STYLE[f.kind];
      const m = L.circleMarker([f.lat, f.lon], { radius: s.r, color: "#0b1020", weight: 1.5, fillColor: s.color, fillOpacity: 1 }).addTo(map);
      m.bindTooltip(`<b>${f.name}</b><br>${s.label}`);
      facLayers[f.id] = m;
    }
  }
}
const baseStyle = (e) => ({ color: e.kind === "bridge" ? "#4cc9f0" : e.kind === "flyover" ? "#7aa2ff" : "#5a6789", weight: e.kind === "road" ? 3 : 5, opacity: 0.85, dashArray: null });

map.on("click", (ev) => {
  const t = $("#ev-type").value;
  if (t !== "flood" && t !== "power_outage") return;
  setEpicentre(ev.latlng.lat, ev.latlng.lng);
});
function setEpicentre(lat, lon) {
  if (epicentre) map.removeLayer(epicentre);
  epicentre = L.circle([lat, lon], { radius: +$("#ev-radius").value * 1000, color: "#ff4d6d", dashArray: "6 6", fillOpacity: 0.08 }).addTo(map);
  epicentre.ll = { lat, lon };
  $("#loc-hint").textContent = `Epicentre ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

// ---------------------------------------------------------------- event form
function syncForm() {
  const t = $("#ev-type").value;
  $("#f-edge").hidden = !(t === "bridge_collapse" || t === "road_block");
  $("#f-loc").hidden = !(t === "flood" || t === "power_outage");
  $("#f-work").hidden = t !== "factory_shutdown";
  $("#f-zone").hidden = t !== "disease_outbreak";
  if (t === "bridge_collapse" || t === "road_block") highlightPick($("#ev-edge").value);
}
function highlightPick(id) {
  if (current) return;
  for (const { line, e } of Object.values(edgeLayers)) line.setStyle(e.id === id ? { color: "#ffffff", weight: 7 } : baseStyle(e));
}
function readForm() {
  const t = $("#ev-type").value;
  const ev = { type: t, magnitude: +$("#ev-mag").value, duration_h: +$("#ev-dur").value, radius_km: +$("#ev-radius").value };
  if (t === "bridge_collapse" || t === "road_block") { ev.edge = $("#ev-edge").value; ev.label = `${t === "bridge_collapse" ? "Collapse" : "Blockage"}: ${edgeLayers[ev.edge].e.name}`; }
  if (t === "flood" || t === "power_outage") { if (!epicentre) throw new Error("Click the map to set the epicentre"); Object.assign(ev, epicentre.ll); ev.label = t === "flood" ? "Flood" : "Power outage"; }
  if (t === "factory_shutdown") { ev.workplace = $("#ev-work").value; ev.label = "Shutdown: " + $("#ev-work").selectedOptions[0].text; }
  if (t === "disease_outbreak") { ev.zone = $("#ev-zone").value; ev.label = "Outbreak: " + $("#ev-zone").selectedOptions[0].text; }
  return ev;
}
function loadIntoForm(s) {
  $("#ev-type").value = s.type; $("#ev-mag").value = s.magnitude; $("#o-mag").value = s.magnitude; $("#ev-dur").value = s.duration_h;
  if (s.edge) $("#ev-edge").value = s.edge;
  if (s.workplace) $("#ev-work").value = s.workplace;
  if (s.zone) $("#ev-zone").value = s.zone;
  if (s.radius_km) { $("#ev-radius").value = s.radius_km; $("#o-radius").value = s.radius_km; }
  if (s.lat) setEpicentre(s.lat, s.lon); else if (epicentre) { map.removeLayer(epicentre); epicentre = null; }
  syncForm();
}

// ----------------------------------------------------------------- simulation
async function run(ev) {
  $("#err").textContent = "";
  lastEvent = ev;
  try {
    current = await api("/api/simulate", ev);
  } catch (e) { $("#err").textContent = e.message; return; }
  render(current);
  $("#brief").textContent = "Generating plain-language briefing…";
  $("#brief-src").textContent = "";
  api("/api/brief", ev).then((b) => {
    if (lastEvent !== ev) return;
    $("#brief").textContent = b.briefing;
    $("#brief-src").textContent = b.source === "claude" ? "Claude · AI briefing" : "template briefing";
    if (b.hidden_links?.length) { current.hidden_links = [...b.hidden_links, ...current.hidden_links]; renderCascade(current); }
  }).catch(() => { $("#brief").textContent = "Briefing unavailable."; });
}

function render(r) {
  const t = r.totals;
  $("#k-people").textContent = fmt(t.people);
  $("#k-critical").textContent = t.critical;
  $("#k-zones").textContent = t.zones;
  $("#k-eta").textContent = t.first_eta_h == null ? "—" : t.first_eta_h < 1 ? Math.round(t.first_eta_h * 60) + " min" : t.first_eta_h + " h";

  const gs = r.graph_state;
  for (const { line, e } of Object.values(edgeLayers)) {
    if (gs.removed.includes(e.id)) line.setStyle({ color: "#ff4d6d", weight: 7, dashArray: "8 8" });
    else if (gs.slowed.includes(e.id)) line.setStyle({ color: "#ff9f1c", weight: 6, dashArray: null });
    else if (gs.congested.includes(e.id)) line.setStyle({ color: "#ffd166", weight: 5, dashArray: "2 6" });
    else line.setStyle(baseStyle(e));
  }
  const worst = {};
  for (const i of r.impacts) if (i.zone && (!worst[i.zone] || worst[i.zone].score < i.score)) worst[i.zone] = i;
  for (const [zid, c] of Object.entries(zoneLayers)) {
    const w = worst[zid];
    c.setStyle(w ? { color: PRI_COLOR[w.priority], fillColor: PRI_COLOR[w.priority], fillOpacity: 0.28, weight: 2 } : { color: "#4cc9f0", fillColor: "#4cc9f0", fillOpacity: 0.12, weight: 1 });
    const zoneImps = r.impacts.filter((i) => i.zone === zid);
    if (zoneImps.length) c.bindPopup(`<b>${esc(graph.facilities.find((f) => f.id === zid).name)}</b><br>` + zoneImps.map((i) => `• [${i.priority}] ${esc(i.title)}`).join("<br>"));
  }
  for (const h of r.hospital_load) {
    const m = facLayers[h.id];
    m.setRadius(h.ratio >= 0.95 ? 12 : 7);
    m.setTooltipContent(`<b>${h.name}</b><br>ER load ${Math.round(h.ratio * 100)}%${h.extra ? ` (+${h.extra} beds)` : ""}`);
  }
  renderAlerts(r); renderCascade(r); renderTimeline(r); renderHospitals(r);
}

function renderAlerts(r) {
  const el = $("#tab-alerts");
  if (!r.impacts.length) { el.innerHTML = `<p class="hint">No downstream consequences above threshold. First-order only: ${r.first_order.map((f) => esc(f.what)).join("; ")}</p>`; return; }
  el.innerHTML = r.impacts.map((i, idx) => `
    <div class="alert ${i.priority}">
      <div class="top"><span class="pill ${i.priority}">${i.priority.toUpperCase()}</span>
        <span class="ord o${i.order}">${["", "1st", "2nd", "3rd"][i.order]} order</span>
        <span class="pill">${esc(i.label)}</span><span class="score">${i.score}</span></div>
      <h3>${esc(i.title)}</h3>
      <div class="meta">👥 ${i.people.toLocaleString()} people · ⏱ in ~${i.eta_h < 1 ? Math.round(i.eta_h * 60) + " min" : i.eta_h + " h"} · vulnerability ${Math.round(i.vulnerability * 100)}%</div>
      <div class="meta">${esc(i.detail)}</div>
      <div class="act"><b>Suggested action:</b> ${esc(i.action)}</div>
      <div class="fb"><button data-i="${idx}" data-h="1">✓ Happened</button><button data-i="${idx}" data-h="0">✗ Didn't happen</button></div>
    </div>`).join("");
}
$("#tab-alerts").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-i]");
  if (!b) return;
  const i = current.impacts[+b.dataset.i];
  await api("/api/feedback", { category: i.category, happened: b.dataset.h === "1" });
  b.classList.add("done"); b.textContent += " — logged";
  loadCalib();
});

function renderCascade(r) {
  const col = (title, items, cls) => `<div class="col"><h4>${title}</h4>${items.length ? items.map((x) => `<div class="node ${cls}">${esc(x)}</div>`).join("") : '<div class="hint">none</div>'}</div>`;
  const by = (o) => [...new Set(r.impacts.filter((i) => i.order === o).map((i) => i.title))];
  const firstItems = [...r.first_order.map((f) => f.what), ...by(1)];
  $("#tab-cascade").innerHTML = `<div class="cascade">
    ${col("Event", [r.event.label || r.event.type], "o0")}<div class="arrow">↓</div>
    ${col("First order — what broke", firstItems, "o1")}<div class="arrow">↓</div>
    ${col("Second order — who depends on it", by(2), "o2")}<div class="arrow">↓</div>
    ${col("Third order — who is hurt next", by(3), "o3")}<div class="arrow">↓</div>
    <div class="col"><h4>AI-suggested hidden dependencies (unverified)</h4>${r.hidden_links.map((h) => `<div class="node ai">${h.source === "claude" ? "✦ " : ""}${esc(h.text)}</div>`).join("")}</div>
  </div>`;
}

function renderTimeline(r) {
  const items = [...r.impacts].sort((a, b) => a.eta_h - b.eta_h);
  const max = Math.max(24, ...items.map((i) => i.eta_h));
  const pos = (h) => (Math.log(1 + h) / Math.log(1 + max)) * 100;
  const ticks = [0, 1, 3, 6, 12, 24, 72, 168].filter((t) => t <= max);
  $("#tab-timeline").innerHTML = `<p class="hint">When each consequence lands after the event (log scale).</p>
    <div class="tl-axis" style="position:relative;height:14px">${ticks.map((t) => `<span style="position:absolute;left:${pos(t)}%;transform:translateX(-50%)">${t}h</span>`).join("")}</div>` +
    items.map((i) => `<div class="tl-row"><span><b style="color:${PRI_COLOR[i.priority]}">T+${i.eta_h}h</b> ${esc(i.title)}</span>
      <div class="tl-bar"><i style="left:${pos(i.eta_h)}%;background:${PRI_COLOR[i.priority]}"></i></div></div>`).join("");
}

function renderHospitals(r) {
  $("#tab-hospitals").innerHTML = `<p class="hint">Projected emergency-department load after patients re-route.</p>` +
    [...r.hospital_load].sort((a, b) => b.ratio - a.ratio).map((h) => {
      const p = Math.round(h.ratio * 100), c = p >= 95 ? "#ff4d6d" : p >= 85 ? "#ff9f1c" : "#6ee7b7";
      return `<div class="hosp"><b>${esc(h.name)}</b> — <span style="color:${c}">${p}%</span>
        ${h.extra ? `<span class="hint"> +${h.extra} beds from ${esc(h.sources.join(", "))}</span>` : ""}
        <div class="bar"><i style="width:${Math.min(100, p)}%;background:${c}"></i></div></div>`;
    }).join("");
}

async function loadCalib() {
  const s = await api("/api/feedback");
  const rows = Object.entries(s);
  $("#calib").innerHTML = rows.length ? rows.map(([k, v]) => `<div><span>${k}</span><span>✓${v.hit} ✗${v.miss} → weight ×${v.factor}</span></div>`).join("") : '<p class="hint">No feedback yet — all weights ×1.0</p>';
}

// ----------------------------------------------------------------------- init
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + b.dataset.tab));
}));
$("#ev-type").addEventListener("change", syncForm);
$("#ev-edge").addEventListener("change", () => highlightPick($("#ev-edge").value));
$("#ev-mag").addEventListener("input", (e) => ($("#o-mag").value = e.target.value));
$("#ev-radius").addEventListener("input", (e) => { $("#o-radius").value = e.target.value; if (epicentre) epicentre.setRadius(e.target.value * 1000); });
$("#run").addEventListener("click", () => { try { document.querySelectorAll(".scn").forEach((x) => x.classList.remove("on")); current = null; run(readForm()); } catch (e) { $("#err").textContent = e.message; } });

(async () => {
  graph = await api("/api/graph");
  const opt = (v, t) => `<option value="${v}">${esc(t)}</option>`;
  $("#ev-edge").innerHTML = [...graph.edges].sort((a, b) => (a.kind === "road") - (b.kind === "road") || a.name.localeCompare(b.name))
    .map((e) => opt(e.id, `${e.kind === "road" ? "" : e.kind === "bridge" ? "🌉 " : "⤴ "}${e.name}`)).join("");
  $("#ev-work").innerHTML = graph.facilities.filter((f) => f.kind === "workplace").map((f) => opt(f.id, f.name)).join("");
  $("#ev-zone").innerHTML = graph.facilities.filter((f) => f.kind === "zone").map((f) => opt(f.id, f.name)).join("");
  drawGraph(); syncForm(); loadCalib();
  const scns = await api("/api/scenarios");
  $("#scenarios").innerHTML = scns.map((s, i) => `<button class="scn" data-i="${i}">${esc(s.label)}<small>${s.type.replace(/_/g, " ")} · ${s.duration_h}h · magnitude ${s.magnitude}</small></button>`).join("");
  $("#scenarios").addEventListener("click", (e) => {
    const b = e.target.closest(".scn"); if (!b) return;
    document.querySelectorAll(".scn").forEach((x) => x.classList.toggle("on", x === b));
    const s = scns[+b.dataset.i]; current = null; loadIntoForm(s); run(s);
  });
  document.querySelector(".scn").click();
})();
