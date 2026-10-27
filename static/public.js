// Public dashboard: read-only view of officially verified incidents and their cascades.
const { $, $$, esc, inr, short, when, ago, TYPES, SEV, CAT, api } = R;
$("#nav").innerHTML = R.nav("/public");

const ADVICE = {
  ems: "In a medical emergency, call <b>108</b> or <b>112</b> right away and give your exact location. Ambulances may take longer in the affected areas.",
  hospital: null, // filled in from live hospital load
  medicine: "If you or an elderly neighbour takes daily medicines (BP, diabetes, insulin), get 2–3 days' supply now. Local pharmacies may run short.",
  cold_chain: "Keep insulin and vaccines cool. Vaccination sessions in the affected area may be rescheduled.",
  residents: "If water is entering your home, move to an upper floor, switch off the electricity at the mains, and call <b>112</b>. Help elderly and disabled neighbours first.",
  school: "School buses may be delayed or cancelled in the affected areas. Check with your school before sending children.",
  meals: "School mid-day meals may be disrupted. Anganwadi centres may hand out take-home rations instead.",
  income: "Daily-wage workers who lose work can contact the Labour Department or the district helpline <b>1077</b> about relief.",
  food: "Community kitchens and ration distribution may be set up. Follow official announcements.",
};
const ORDERS = [
  [1, "1️⃣ What broke", "The direct, visible damage"],
  [2, "2️⃣ Who depends on it", "Second-order victims: people who rely on what broke"],
  [3, "3️⃣ Who may be hurt next", "Third-order victims: the knock-on effects that follow"],
];

let M, data = { active: [], resolved: [] }, current = null, myZone = null;
try { myZone = localStorage.getItem("ripple_my_zone"); } catch {}

async function load() {
  data = await api("/api/public/incidents");
  $("#refreshed").textContent = ` Updated ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}; refreshes every minute.`;
  renderList();
  const want = location.hash.slice(1) || current?.incident.id || data.active[0]?.id;
  if (want && [...data.active, ...data.resolved].some((i) => i.id === want)) select(want, false);
  else if (!data.active.length) { $("#detail").innerHTML = ""; M.reset(); }
}
function remaining(i) { return (i.created + i.eta_resolve_h * 3600 - Date.now() / 1000) / 3600; }

function renderList() {
  $("#list").innerHTML = data.active.length ? data.active.map((i) => {
    const T = TYPES[i.type], left = remaining(i);
    return `<button type="button" class="inc-card" data-id="${i.id}" aria-pressed="${current?.incident.id === i.id}">
      <span class="ico">${T.ico}</span>
      <b>${i.simulated ? '<span class="sim">SIMULATED</span>' : ""}${esc(i.title)}</b>
      <span class="grav g${i.gravity}">${SEV[i.gravity]}</span>
      <small>✅ Verified by ${esc(i.verified_by)} · updated ${ago(i.updated)}</small>
      <small>${i.totals.people ? `~${short(i.totals.people)} people affected downstream · ` : ""}${left > 0 ? `expected to be fixed in about ${when(left)}` : "taking longer than expected"}</small>
    </button>`;
  }).join("") : `<div class="empty"><b>🟢</b>No active incidents right now. All clear in the tricity.</div>`;
  $("#resolved").innerHTML = data.resolved.length ? `<h3>Recently resolved</h3>` + data.resolved.map((i) =>
    `<button type="button" class="inc-card" data-id="${i.id}" style="opacity:.75"><span class="ico">✅</span><b>${esc(i.title)}</b><span></span><small>Resolved ${ago(i.resolved_at)}</small></button>`).join("") : "";
}
document.addEventListener("click", (e) => { const b = e.target.closest(".inc-card"); if (b) select(b.dataset.id, true); });

async function select(id, scroll) {
  const d = await api(`/api/incidents/${id}/cascade`);
  const changed = current?.incident.id !== id;
  current = d; history.replaceState(null, "", "#" + id);
  $$(".inc-card").forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === id));
  M.paint(d.cascade, { fit: changed }); // don't yank the map around on the 1-minute refresh
  renderDetail();
  if (scroll) $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDetail() {
  const { incident: i, cascade: c } = current, T = TYPES[i.type];
  const zones = M.graph.facilities.filter((f) => f.kind === "zone");
  const mine = myZone ? c.impacts.filter((x) => x.zone === myZone) : [];
  const src = i.verification.sources?.length ? i.verification.sources.map((s) => esc(s.name)).join(", ") : "Government field report";
  const left = remaining(i);
  const byOrder = (o) => c.impacts.filter((x) => x.order === o).sort((a, b) => a.eta_h - b.eta_h);
  const row = (x) => `<div class="vic${x.zone && x.zone === myZone ? " mine" : ""}"><span class="ico">${CAT[x.category].ico}</span>
      <span>${esc(x.title)}</span><small>about ${inr(x.people)} people · ${x.order === 1 ? "now" : `expected within ${when(x.eta_h)}`}</small></div>`;
  const cats = [...new Set(c.impacts.map((x) => x.category))];
  const hl = [...c.hospital_load].sort((a, b) => a.ratio - b.ratio);
  const busy = hl.filter((h) => h.ratio >= 0.95);
  const adv = cats.map((k) => k === "hospital"
    ? (busy.length ? `Emergency wards at <b>${busy.map((h) => esc(h.name)).join(", ")}</b> are expected to be over capacity. For non-critical cases, consider <b>${esc(hl[0].name)}</b>.` : null)
    : ADVICE[k]).filter(Boolean);

  $("#detail").innerHTML = `
    <article class="card hero" style="margin-top:6px">
      <div class="ev">${T.ico} ${T.name} · gravity ${i.gravity}/5 (${SEV[i.gravity]})${i.status === "resolved" ? " · RESOLVED" : ""}</div>
      <p class="headline">${i.simulated ? '<span class="sim">SIMULATED DEMO</span>' : ""}${esc(i.title)}</p>
      ${i.public_note ? `<p class="callout">📣 <b>Official advice:</b> ${esc(i.public_note)}</p>` : ""}
      <p class="hint" style="margin:0">✅ Verified by <b>${esc(i.verified_by)}</b> · confirmed by: ${src} · ${i.status === "resolved" ? `resolved ${ago(i.resolved_at)}` : left > 0 ? `expected to be fixed in about <b>${when(left)}</b>` : "<b>taking longer than first expected</b>"}</p>
      <div class="stats" style="margin-top:12px">
        <div class="stat"><b>${short(c.totals.people)}</b><span>people affected downstream</span></div>
        <div class="stat crit"><b>${c.totals.critical}</b><span>serious knock-on effects</span></div>
        <div class="stat"><b>${c.totals.zones}</b><span>areas affected</span></div>
        <div class="stat"><b>${c.totals.first_eta_h == null ? "—" : when(c.totals.first_eta_h)}</b><span>until the first effects</span></div>
      </div>
    </article>

    <article class="card">
      <h2>📍 Is my area affected?</h2>
      <label class="field">Choose where you live or work
        <select id="my-zone"><option value="">Select your area…</option>${zones.map((z) => `<option value="${z.id}"${z.id === myZone ? " selected" : ""}>${esc(z.name)}</option>`).join("")}</select></label>
      ${myZone ? (mine.length
        ? `<p class="callout" style="background:#fff7d6;color:#713f12">⚠️ <b>Yes.</b> ${mine.length} effect${mine.length > 1 ? "s" : ""} expected in ${esc(zones.find((z) => z.id === myZone).name)}. They're highlighted in yellow below.</p>`
        : `<p class="callout ok">✓ No knock-on effects are predicted for ${esc(zones.find((z) => z.id === myZone).name)} right now.</p>`) : ""}
    </article>

    ${ORDERS.map(([o, title, sub]) => {
      const items = byOrder(o);
      const extra = o === 1 ? c.first_order.map((f) => `<div class="vic"><span class="ico">🧱</span><span>${esc(f.what)}</span><small>direct damage</small></div>`).join("") : "";
      if (!items.length && !extra) return "";
      return `<article class="card order-sec"><h2>${title}</h2><p class="hint" style="margin-top:-6px">${sub}</p>${extra}${items.map(row).join("")}</article>`;
    }).join("")}

    ${adv.length ? `<article class="card"><h2>🛟 What you can do</h2><ul class="advice">${adv.map((a) => `<li>${a}</li>`).join("")}</ul>
      <p class="hint">Emergency: <b>112</b> · Ambulance: <b>108</b> · Fire: <b>101</b> · Disaster helpline: <b>1077</b></p></article>` : ""}

    <article class="card"><h2>🏥 Hospital emergency wards</h2>
      ${[...c.hospital_load].sort((a, b) => b.ratio - a.ratio).map((h) => {
        const p = Math.round(h.ratio * 100), col = p >= 95 ? "#dc2626" : p >= 85 ? "#ea580c" : "#16a34a";
        return `<div class="hosp"><div class="top-row"><b>${esc(h.name)}</b><span style="color:${col};font-weight:600">${p >= 95 ? "Very busy" : p >= 85 ? "Busy" : "Normal"}</span></div>
          <div class="track"><i style="width:${Math.min(100, p)}%;background:${col}"></i><em></em></div></div>`;
      }).join("")}</article>

    <article class="card"><h2>🕒 Official updates</h2>
      <ul class="hist">${[...i.history].reverse().map((h) => `<li>${esc(h.note)}<small>${esc(h.by)} · ${R.clock(h.t)}</small></li>`).join("")}</ul></article>`;

  $("#my-zone").addEventListener("change", (e) => {
    myZone = e.target.value || null;
    try { myZone ? localStorage.setItem("ripple_my_zone", myZone) : localStorage.removeItem("ripple_my_zone"); } catch {}
    renderDetail();
    if (myZone) { const z = zones.find((x) => x.id === myZone); M.map.setView([z.lat, z.lon], 13); }
  });
}

(async () => {
  M = await R.createMap($("#map"));
  await load();
  setInterval(load, 60000);
})();
