// Public dashboard: plain-language view of officially verified incidents.
// Every number here is a rounded model estimate, labelled as such, with who approved it and when.
const { $, $$, esc, when, ago, clock, TYPES, api } = R;
$("#nav").innerHTML = R.nav("/public");

const GROUPS = [
  ["direct", "🧱 Directly hit", "Damage that has already happened."],
  ["services", "🚑 Everyday services affected", "Ambulances, schools, chemists and jobs that depend on what was damaged."],
  ["later", "⏳ What could follow if it lasts", "Longer-term effects officials are preparing for. These may not happen."],
];
const STALE_H = 6; // an active incident not updated for this long gets a warning

let M, data = { active: [], resolved: [], zones: [] }, current = null, myZone = null;
try { myZone = localStorage.getItem("ripple_my_zone"); } catch {}

const hhmm = (t) => new Date(t * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const zoneName = (id) => data.zones.find((z) => z.id === id)?.name || "";
const expectedFix = (i) => i.created + i.eta_resolve_h * 3600;
const est = '<span class="est" title="Rough estimate from Ripple\'s model, not an exact count">Estimate</span>';
const callBtn = (c) => c ? `<a class="call" href="tel:${c.number}">📞 ${c.number} <span>${esc(c.label)}</span></a>` : "";

function stamp(i) {
  const stale = i.status === "active" && (Date.now() / 1000 - i.updated) / 3600 > STALE_H;
  return `<span class="status ${i.status}">${i.status === "active" ? "Ongoing" : "Resolved"}</span>
    <span>Started ${clock(i.created)}</span> · <span>Last updated ${ago(i.updated)} (${hhmm(i.updated)})</span>
    ${stale ? `<span class="stale">⚠️ No update for over ${STALE_H} hours. Information may be out of date.</span>` : ""}`;
}
function fixLine(i) {
  if (i.status === "resolved") return `Resolved ${ago(i.resolved_at)}`;
  const left = (expectedFix(i) - Date.now() / 1000) / 3600;
  return left > 0 ? `Officials expect it fixed by about <b>${clock(expectedFix(i))}</b> (in ~${when(left)})` : "<b>Taking longer than officials first expected</b>";
}
function item(x, i, showZone) {
  return `<div class="tip${x.zone && x.zone === myZone ? " mine" : ""}">
    <div class="tip-head"><b>${esc(x.headline)}</b>${showZone && i ? `<small>${esc(i.title)}</small>` : ""}</div>
    ${x.estimate || x.people ? `<div class="tip-est">${est} ${[x.estimate, x.people && `${x.people} may be affected`, x.when !== "now" && `could start ${x.when}`].filter(Boolean).map(esc).join(" · ")}</div>` : ""}
    ${x.step ? `<div class="tip-do"><span>👉 <b>What to do:</b> ${esc(x.step)}</span>${callBtn(x.call)}</div>` : ""}
  </div>`;
}

async function load() {
  data = await api("/api/public/incidents");
  $("#checked").innerHTML = `🔄 Last checked <b>${hhmm(data.checked_at)}</b>. This page refreshes every minute. Only incidents confirmed by a government official are shown.`;
  const sel = $("#my-zone");
  if (sel.options.length === 1) {
    sel.insertAdjacentHTML("beforeend", data.zones.map((z) => `<option value="${z.id}">${esc(z.name)}</option>`).join(""));
    if (myZone) sel.value = myZone;
  }
  renderAnswer();
  renderList();
  $("#map-clear").hidden = data.active.length > 0;
  const want = location.hash.slice(1) || current?.incident.id || data.active[0]?.id;
  if (want && [...data.active, ...data.resolved].some((i) => i.id === want)) select(want, false);
  else { current = null; $("#detail").innerHTML = ""; M.reset(); }
}

// ---- "Is my area affected?" answer at the top of the page
function renderAnswer() {
  const el = $("#answer");
  if (!data.active.length) {
    el.innerHTML = `<p class="verdict-box ok">✓ <b>No active incidents in the tricity right now.</b>${myZone ? ` Nothing is affecting ${esc(zoneName(myZone))}.` : ""}<br><small>Last checked ${hhmm(data.checked_at)}.</small></p>`;
    return;
  }
  if (!myZone) {
    el.innerHTML = `<p class="hint">Choose your area, or tap “Use my location”, to get a clear yes/no answer and what to do. ${data.active.length} active incident${data.active.length > 1 ? "s" : ""} in the tricity.</p>`;
    return;
  }
  const hits = data.active.flatMap((i) => i.citizen.filter((x) => x.zone === myZone && x.group !== "direct").map((x) => [x, i]));
  if (!hits.length) {
    el.innerHTML = `<p class="verdict-box ok">✓ <b>${esc(zoneName(myZone))} is not expected to be affected right now.</b>
      ${data.active.length} incident${data.active.length > 1 ? "s" : ""} elsewhere in the tricity are listed below.<br><small>Last checked ${hhmm(data.checked_at)}.</small></p>`;
    return;
  }
  const incs = [...new Set(hits.map(([, i]) => i))];
  el.innerHTML = `<p class="verdict-box warn">⚠️ <b>Yes, ${esc(zoneName(myZone))} is likely to be affected</b> by ${incs.length > 1 ? `${incs.length} incidents` : esc(incs[0].title)}.</p>
    ${hits.slice(0, 5).map(([x, i]) => item(x, i, incs.length > 1)).join("")}
    <p class="source">${est} Rough figures from Ripple's model to help you plan, not exact counts. Approved by <b>${incs.map((i) => esc(i.verified_by)).join(", ")}</b> · updated ${incs.map((i) => hhmm(i.updated)).join(", ")}.</p>`;
}

function renderList() {
  $("#list").innerHTML = data.active.length ? data.active.map((i) => {
    const T = TYPES[i.type];
    return `<button type="button" class="inc-card" data-id="${i.id}" aria-pressed="${current?.incident.id === i.id}">
      <span class="ico">${T.ico}</span>
      <b>${i.simulated ? '<span class="sim">SIMULATED</span>' : ""}${esc(i.title)}</b>
      <span></span>
      <small class="stamps">${stamp(i)}</small>
      <small>✅ Approved by ${esc(i.verified_by)} · ${fixLine(i)}</small>
    </button>`;
  }).join("") : `<div class="card empty-state">
      <b>🟢</b><h3>No active incidents</h3>
      <p>Nothing has been confirmed by officials right now. Last checked <b>${hhmm(data.checked_at)}</b>; this page checks again every minute.</p>
      <p class="links"><a class="btn" href="/drills">🎯 Training drills</a><a class="btn" href="/official">🏛️ Officials' console</a></p>
    </div>`;
  $("#resolved").innerHTML = data.resolved.length ? `<h3>Recently resolved</h3>` + data.resolved.map((i) =>
    `<button type="button" class="inc-card done" data-id="${i.id}"><span class="ico">✅</span><b>${esc(i.title)}</b><span></span><small class="stamps">${stamp(i)}</small><small>${fixLine(i)}</small></button>`).join("") : "";
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
  const { incident: i, cascade: c, citizen } = current, T = TYPES[i.type];
  const src = i.verification.sources?.length ? i.verification.sources.map((s) => esc(s.name)).join(", ") : "Government field report";
  const mineFirst = (a, b) => (b.zone === myZone) - (a.zone === myZone);
  const hosp = [...c.hospital_load].sort((a, b) => b.ratio - a.ratio);

  $("#detail").innerHTML = `
    <article class="card hero" style="margin-top:6px">
      <div class="ev">${T.ico} ${T.name}</div>
      <p class="headline">${i.simulated ? '<span class="sim">SIMULATED DEMO</span>' : ""}${esc(i.title)}</p>
      <p class="stamps">${stamp(i)}</p>
      <p class="hint" style="margin:4px 0 0">${fixLine(i)}. This time is the official's estimate.</p>
      ${i.public_note ? `<p class="callout">📣 <b>Official advice:</b> ${esc(i.public_note)}</p>` : ""}
      <p class="source">✅ Approved by <b>${esc(i.verified_by)}</b> · confirmed by: ${src}<br>
        ${est} Times and numbers below are rough estimates from Ripple's model to help you plan. They are not exact counts.</p>
    </article>

    ${GROUPS.map(([g, title, sub]) => {
      const items = citizen.filter((x) => x.group === g).sort(mineFirst);
      if (!items.length) return "";
      return `<article class="card"><h2>${title}</h2><p class="hint" style="margin-top:-6px">${sub}</p>${items.map((x) => item(x)).join("")}</article>`;
    }).join("")}

    <article class="card"><h2>🏥 Hospital emergency wards</h2>
      <p class="hint" style="margin-top:-6px">${est} How busy each ward is expected to get. In a life-threatening emergency, always go to the nearest one.</p>
      ${hosp.map((h) => {
        const p = Math.round(h.ratio * 100), col = p >= 95 ? "#dc2626" : p >= 85 ? "#ea580c" : "#16a34a";
        return `<div class="hosp"><div class="top-row"><b>${esc(h.name)}</b><span style="color:${col};font-weight:600">${p >= 95 ? "Very busy" : p >= 85 ? "Busy" : "Normal"}</span></div>
          <div class="track"><i style="width:${Math.min(100, p)}%;background:${col}"></i><em></em></div></div>`;
      }).join("")}</article>

    <article class="card"><h2>🕒 Official updates</h2>
      <ul class="hist">${[...i.history].reverse().map((h) => `<li>${esc(h.note)}<small>${esc(h.by)} · ${clock(h.t)}</small></li>`).join("")}</ul></article>`;
}

function setZone(id) {
  myZone = id || null;
  try { myZone ? localStorage.setItem("ripple_my_zone", myZone) : localStorage.removeItem("ripple_my_zone"); } catch {}
  $("#my-zone").value = myZone || "";
  renderAnswer();
  if (current) renderDetail();
  const z = data.zones.find((x) => x.id === myZone);
  if (z) M.map.setView([z.lat, z.lon], 13);
}
$("#my-zone").addEventListener("change", (e) => setZone(e.target.value));

$("#locate").addEventListener("click", () => {
  if (!navigator.geolocation) return R.toast("Location isn't available in this browser. Please choose your area from the list.");
  $("#locate").disabled = true;
  navigator.geolocation.getCurrentPosition((pos) => {
    $("#locate").disabled = false;
    const { latitude: la, longitude: lo } = pos.coords;
    const km = (z) => Math.hypot((z.lat - la) * 111, (z.lon - lo) * 111 * Math.cos(la * Math.PI / 180));
    const near = [...data.zones].sort((a, b) => km(a) - km(b))[0];
    if (km(near) > 15) return R.toast("You seem to be outside the Chandigarh tricity. Choose an area from the list instead.");
    setZone(near.id);
    R.toast(`Showing results for ${near.name}, the nearest area to you.`);
  }, () => { $("#locate").disabled = false; R.toast("Couldn't get your location. Please choose your area from the list."); },
  { timeout: 10000, maximumAge: 600000 });
});

(async () => {
  M = await R.createMap($("#map"));
  await load();
  setInterval(load, 60000);
})();
