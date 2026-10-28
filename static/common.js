// Shared helpers for the official, public and drill pages.
window.R = (() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const inr = (n) => Math.round(n).toLocaleString("en-IN");
  const short = (n) => n >= 1e7 ? (n / 1e7).toFixed(1) + " crore" : n >= 1e5 ? (n / 1e5).toFixed(1) + " lakh" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n));
  const when = (h) => h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${+h.toFixed(1)} h` : `${Math.round(h / 24)} days`;
  const ago = (t) => { const m = (Date.now() / 1000 - t) / 60; return m < 1 ? "just now" : m < 60 ? `${Math.round(m)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const clock = (t) => new Date(t * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const TYPES = {
    bridge_collapse: { ico: "🌉", name: "Bridge collapse" }, road_block: { ico: "🚧", name: "Road blocked / accident" },
    flood: { ico: "🌊", name: "Flood / waterlogging" }, power_outage: { ico: "⚡", name: "Power outage" },
    factory_shutdown: { ico: "🏭", name: "Workplace shutdown" }, disease_outbreak: { ico: "🦠", name: "Disease outbreak" },
  };
  const SEV = ["", "Minor", "Moderate", "Serious", "Severe", "Extreme"];
  const CAT = {
    ems: { ico: "🚑", name: "Emergency care" }, hospital: { ico: "🏥", name: "Hospitals" }, medicine: { ico: "💊", name: "Medicines" },
    cold_chain: { ico: "🧊", name: "Vaccines & insulin" }, residents: { ico: "🏠", name: "Residents" }, income: { ico: "💼", name: "Jobs & wages" },
    food: { ico: "🍚", name: "Food security" }, school: { ico: "🎒", name: "Schools" }, meals: { ico: "🍱", name: "Mid-day meals" },
  };
  const PRI = { Critical: "#dc2626", High: "#ea580c", Medium: "#ca8a04", Low: "#16a34a" };

  let code = null;
  try { code = sessionStorage.getItem("ripple_code"); } catch {}
  const setCode = (c) => { code = c; try { c ? sessionStorage.setItem("ripple_code", c) : sessionStorage.removeItem("ripple_code"); } catch {} };

  async function api(path, body, method) {
    const headers = { "Content-Type": "application/json" };
    if (code) headers["X-Official-Code"] = code;
    const r = await fetch(path, { method: method || (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const d = data.detail;
      throw new Error(Array.isArray(d) ? d.map((x) => `${x.loc?.slice(-1)[0]}: ${x.msg}`).join("; ") : d || r.statusText);
    }
    return data;
  }

  function toast(msg) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800);
  }

  function nav(active) {
    const links = [["/public", "📢 Public alerts"], ["/official", "🏛️ Official console"], ["/drills", "🎯 Training drills"]];
    return `<nav class="appnav" aria-label="Ripple pages">${links.map(([h, t]) => `<a href="${h}"${h === active ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>`;
  }

  // -------------------------------------------------------------- map
  const baseStyle = (e) => ({ color: e.kind === "bridge" ? "#0284c7" : e.kind === "flyover" ? "#4f46e5" : "#64748b", weight: e.kind === "road" ? 3.5 : 5.5, opacity: 0.85, dashArray: null });
  const KIND = { hospital: "#dc2626", ambulance: "#111827", depot: "#059669", workplace: "#eab308", school: "#7c3aed" };

  async function createMap(el, { onClick, onRoad } = {}) {
    const graph = await api("/api/graph");
    const map = L.map(el).setView([30.72, 76.77], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 18 }).addTo(map);
    addMapLegend(map);
    const nodes = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
    const edges = {}, zones = {}, facs = {};
    for (const e of graph.edges) {
      const ll = [[nodes[e.a].lat, nodes[e.a].lon], [nodes[e.b].lat, nodes[e.b].lon]];
      const line = L.polyline(ll, { ...baseStyle(e), interactive: !!onRoad }).addTo(map);
      line.bindTooltip(`<b>${esc(e.name)}</b> · ${e.km} km`, { sticky: true });
      if (onRoad) line.on("click", (ev) => { L.DomEvent.stopPropagation(ev); onRoad(e); });
      edges[e.id] = { line, e };
    }
    for (const f of graph.facilities) {
      if (f.kind === "zone") {
        zones[f.id] = L.circle([f.lat, f.lon], { radius: Math.sqrt(f.pop) * 2.4, color: "#2563eb", weight: 1, fillOpacity: 0.07, interactive: false }).addTo(map);
      } else {
        facs[f.id] = L.circleMarker([f.lat, f.lon], { radius: f.kind === "hospital" ? 7 : 5, color: "#fff", weight: 1.5, fillColor: KIND[f.kind], fillOpacity: 1 })
          .bindTooltip(`<b>${esc(f.name)}</b>`).addTo(map);
      }
    }
    if (onClick) map.on("click", (ev) => onClick(ev.latlng));
    let marks = [];
    const clearMarks = () => { marks.forEach((m) => map.removeLayer(m)); marks = []; };

    function reset() {
      clearMarks();
      for (const { line, e } of Object.values(edges)) line.setStyle(baseStyle(e));
      for (const z of Object.values(zones)) z.setStyle({ color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.07, weight: 1 });
      for (const [id, m] of Object.entries(facs)) if (id.startsWith("h_")) m.setRadius(7);
    }
    function markEvent(ev) {
      clearMarks();
      if (ev.edge && edges[ev.edge]) marks.push(L.polyline(edges[ev.edge].line.getLatLngs(), { color: "#2563eb", weight: 14, opacity: 0.3, interactive: false }).addTo(map));
      if (ev.lat != null && (ev.type === "flood" || ev.type === "power_outage"))
        marks.push(L.circle([ev.lat, ev.lon], { radius: (ev.radius_km || 1.5) * 1000, color: "#dc2626", dashArray: "6 6", weight: 2, fillOpacity: 0.08, interactive: false }).addTo(map));
      const pt = eventPoint(ev);
      if (pt) marks.push(L.marker(pt, { title: "Event location" }).addTo(map));
    }
    function eventPoint(ev) {
      if (ev.edge && edges[ev.edge]) return edges[ev.edge].line.getBounds().getCenter();
      if (ev.lat != null) return L.latLng(ev.lat, ev.lon);
      const f = graph.facilities.find((x) => x.id === (ev.zone || ev.workplace));
      return f ? L.latLng(f.lat, f.lon) : null;
    }
    function paint(r, { zonesOnly = null, fit = true } = {}) {
      const gs = r.graph_state;
      for (const { line, e } of Object.values(edges)) {
        if (gs.removed.includes(e.id)) line.setStyle({ color: "#dc2626", weight: 7, dashArray: "8 8" });
        else if (gs.slowed.includes(e.id)) line.setStyle({ color: "#f59e0b", weight: 6, dashArray: null });
        else if (gs.congested.includes(e.id)) line.setStyle({ color: "#eab308", weight: 5, dashArray: "2 7" });
        else line.setStyle(baseStyle(e));
      }
      const worst = {};
      for (const i of r.impacts) if (i.zone && (!zonesOnly || zonesOnly.has(i.zone)) && (!worst[i.zone] || worst[i.zone].score < i.score)) worst[i.zone] = i;
      const pts = [];
      for (const [zid, c] of Object.entries(zones)) {
        const w = worst[zid];
        c.setStyle(w ? { color: PRI[w.priority], fillColor: PRI[w.priority], fillOpacity: 0.25, weight: 2 } : { color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.07, weight: 1 });
        if (w) pts.push(c.getLatLng());
      }
      for (const h of r.hospital_load) { facs[h.id].setRadius(h.ratio >= 0.95 ? 13 : 7); if (h.ratio >= 0.95) pts.push(facs[h.id].getLatLng()); }
      markEvent(r.event);
      const ep = eventPoint(r.event); if (ep) pts.push(ep);
      if (fit && pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 13 });
    }
    setTimeout(() => map.invalidateSize(), 200);
    return { map, graph, edges, zones, facs, paint, reset, markEvent, eventPoint };
  }

  return { $, $$, esc, inr, short, when, ago, clock, TYPES, SEV, CAT, PRI, api, toast, nav, createMap, setCode, get code() { return code; } };
})();
