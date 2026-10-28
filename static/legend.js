// Map key shared by every Ripple map: what each line, dot and circle means.
// Usage: addMapLegend(leafletMap) on light pages, addMapLegend(leafletMap, DARK_LEGEND) on the control room.
(function () {
  const LIGHT = {
    dark: false,
    road: "#64748b", bridge: "#0284c7", flyover: "#4f46e5",
    cut: "#dc2626", slowed: "#f59e0b", jam: "#eab308", eventArea: "#dc2626",
    kinds: { hospital: ["#dc2626", "Hospital"], ambulance: ["#111827", "Ambulance base"], depot: ["#059669", "Medicine depot"],
             workplace: ["#eab308", "Workplace"], school: ["#7c3aed", "School"] },
    zone: "#2563eb", pri: { Critical: "#dc2626", High: "#ea580c", Medium: "#ca8a04", Low: "#16a34a" },
  };
  window.DARK_LEGEND = {
    dark: true,
    road: "#5a6789", bridge: "#4cc9f0", flyover: "#7aa2ff",
    cut: "#ff4d6d", slowed: "#ff9f1c", jam: "#ffd166", eventArea: "#ff4d6d",
    kinds: { hospital: ["#ff4d6d", "Hospital"], ambulance: ["#ffffff", "Ambulance base"], depot: ["#06d6a0", "Medicine depot"],
             workplace: ["#ffd166", "Workplace"], school: ["#c77dff", "School"] },
    zone: "#4cc9f0", pri: { Critical: "#ff4d6d", High: "#ff9f1c", Medium: "#ffd166", Low: "#6ee7b7" },
  };

  const css = `
  .map-key { background: #fffffff2; color: #0f172a; border-radius: 10px; box-shadow: 0 2px 10px #0f172a26; font: 12px/1.45 system-ui, sans-serif;
    max-width: 230px; max-height: min(400px, 55vh); overflow: auto; }
  .map-key.dark { background: #121a2ef2; color: #e6ebf5; box-shadow: 0 2px 10px #0008; }
  .map-key summary { cursor: pointer; padding: 7px 10px; font-weight: 700; list-style: none; user-select: none; }
  .map-key summary::-webkit-details-marker { display: none; }
  .map-key summary::after { content: " ▾"; opacity: .6; }
  .map-key:not([open]) summary::after { content: " ▸"; }
  .map-key .body { padding: 0 10px 8px; }
  .map-key h4 { margin: 6px 0 2px; font-size: 10.5px; letter-spacing: .6px; text-transform: uppercase; opacity: .65; }
  .map-key div.row { display: flex; align-items: center; gap: 7px; }
  .map-key svg { flex: none; }
  .map-key small { display: block; opacity: .7; margin: 1px 0 2px 29px; }`;

  function line(color, dash, w) {
    return `<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="${color}" stroke-width="${w || 3}"
      ${dash ? `stroke-dasharray="${dash}"` : ""} stroke-linecap="round"/></svg>`;
  }
  function dot(color, r, ring) {
    return `<svg width="22" height="14" aria-hidden="true"><circle cx="11" cy="7" r="${r || 5}" fill="${color}" stroke="${ring}" stroke-width="1.5"/></svg>`;
  }
  function area(color, fill, dash) {
    return `<svg width="22" height="16" aria-hidden="true"><circle cx="11" cy="8" r="6.5" fill="${fill}" stroke="${color}" stroke-width="1.5"
      ${dash ? 'stroke-dasharray="3 2"' : ""}/></svg>`;
  }
  const row = (icon, text) => `<div class="row">${icon}<span>${text}</span></div>`;

  window.addMapLegend = function (map, p = LIGHT) {
    if (!document.getElementById("map-key-css")) {
      const s = document.createElement("style");
      s.id = "map-key-css"; s.textContent = css;
      document.head.appendChild(s);
    }
    const ring = p.dark ? "#121a2e" : "#ffffff";
    const ctl = L.control({ position: "bottomleft" });
    ctl.onAdd = () => {
      const d = L.DomUtil.create("details", "map-key" + (p.dark ? " dark" : ""));
      if (window.innerWidth >= 900) d.open = true; // folded on phones so it doesn't cover the map
      d.innerHTML = `<summary>🗺️ Map key</summary><div class="body">
        <h4>Roads</h4>
        ${row(line(p.road), "Road")}${row(line(p.bridge, null, 5), "Bridge")}${row(line(p.flyover, null, 5), "Flyover")}
        <h4>After the event</h4>
        ${row(line(p.cut, "5 4", 4), "Closed (cut off)")}
        ${row(line(p.slowed, null, 4), "Slowed down")}
        ${row(line(p.jam, "1.5 4", 4), "Jammed by diverted traffic")}
        ${row('<svg width="22" height="16" aria-hidden="true"><text x="4" y="13" font-size="13">📍</text></svg>', "Where the event happened")}
        ${row(area(p.eventArea, "transparent", true), "Flood or power-cut area")}
        <h4>Places</h4>
        ${Object.entries(p.kinds).map(([k, [c, label]]) => row(dot(c, k === "hospital" ? 6 : 5, ring), label)).join("")}
        <small>A bigger hospital dot = emergency ward over capacity</small>
        <h4>Residential areas</h4>
        ${row(area(p.zone, p.zone + "22"), "Not affected")}
        ${Object.entries(p.pri).map(([k, c]) => row(area(c, c + "55"), `${k} alert`)).join("")}
        <small>Colour = the worst predicted effect there</small>
      </div>`;
      L.DomEvent.disableClickPropagation(d);
      L.DomEvent.disableScrollPropagation(d);
      return d;
    };
    ctl.addTo(map);
    return ctl;
  };
})();
