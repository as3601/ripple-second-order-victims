// Official console: verify news reports, publish incidents, update them, file after-action reports.
const { $, $$, esc, inr, short, when, ago, TYPES, SEV, CAT, api, toast } = R;
$("#nav").innerHTML = R.nav("/official");

let depts = {}, dept = null, M = null, reports = [], incidents = [], activeForm = null, comments = {};
try { dept = sessionStorage.getItem("ripple_dept"); } catch {}

const handles = (type) => { const t = depts[dept]?.types; return t === "all" || (t || []).includes(type); };
const cleanTitle = (t) => t.replace(/^\[SIMULATED\]\s*/, "");

// ================================================================== login
async function boot() {
  depts = await api("/api/departments");
  $("#login-dept").innerHTML = Object.entries(depts).map(([k, d]) => `<option value="${k}">${esc(d.name)}</option>`).join("");
  if (R.code && dept && depts[dept]) return enter();
  $("#login-view").hidden = false;
  const hint = await api("/api/official/hint"); // public demo deployments show their code so judges can sign in
  if (hint.demo_code) {
    $("#demo-code").innerHTML = `🔑 Demo access code: <b>${esc(hint.demo_code)}</b><br><small>Type it into the box above to try the officials' console.</small>`;
    $("#demo-code").hidden = false;
  }
}
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/official/login", { code: $("#login-code").value, department: $("#login-dept").value });
    R.setCode($("#login-code").value); dept = $("#login-dept").value;
    try { sessionStorage.setItem("ripple_dept", dept); } catch {}
    enter();
  } catch (err) { $("#login-err").textContent = err.message; }
});
$("#logout").addEventListener("click", () => { R.setCode(null); try { sessionStorage.removeItem("ripple_dept"); } catch {} location.reload(); });

async function enter() {
  $("#login-view").hidden = true; $("#app-view").hidden = false; $("#who").hidden = false;
  $("#dept-badge").textContent = "🏛️ " + depts[dept].name;
  M = await R.createMap($("#map"), { onClick: onMapClick, onRoad: onMapRoad });
  renderFieldForm();
  await Promise.all([loadReports(), loadIncidents()]);
  setInterval(loadReports, 30000);
}

// =================================================================== tabs
$$(".tabs2 [data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(t) {
  $$(".tabs2 [data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === t));
  for (const s of ["reports", "incidents", "field", "training"]) $(`#tab-${s}`).hidden = s !== t;
  if (t === "training") loadTraining();
}

// ================================================================ reports
async function loadReports() {
  try {
    const d = await api(`/api/reports?department=${dept}`);
    reports = d.reports; renderScanner(d.scanner); renderReports();
  } catch (e) { if (/access code/i.test(e.message)) { R.setCode(null); location.reload(); } }
}
function renderScanner(s) {
  const dropped = Object.values(s.dropped || {}).reduce((a, b) => a + b, 0);
  $("#scanner").innerHTML = `
    <b>🛰️ Automatic news monitoring</b> scans trusted outlets (The Tribune, HT, Indian Express, PIB, …) every 15 minutes.<br>
    ${s.scanning ? "⏳ Scanning now…" : s.last_scan ? `Last scan ${ago(s.last_scan)}: <b>${s.fetched}</b> headlines checked → <b>${s.kept}</b> relevant to the tricity (${dropped} filtered out as unrelated, outside the tricity or not live).` : "No scan yet."}
    ${s.last_error ? `<br><span class="err">${esc(s.last_error)}</span>` : ""}
    <div class="actions">
      <button class="btn sm primary" type="button" id="scan-now" ${s.scanning ? "disabled" : ""}>🔄 Scan now</button>
      <label class="field inline" style="margin:0"><input type="checkbox" id="with-samples"> include <span class="sim">SIMULATED</span> demo reports</label>
    </div>`;
  $("#scan-now").addEventListener("click", scanNow);
}
async function scanNow() {
  await api("/api/news/scan", { include_samples: $("#with-samples").checked });
  toast("Scanning trusted sources…");
  const poll = async () => {
    const s = await api("/api/news/status");
    renderScanner(s);
    if (s.scanning) return setTimeout(poll, 2000);
    loadReports();
  };
  setTimeout(poll, 1200);
}

function checksHtml(v, ai) {
  const c = v.checks;
  const li = (ok, txt) => `<li class="${ok === true ? "ok" : ok === false ? "no" : "na"}">${txt}</li>`;
  return `<ul class="checks">
    ${li(c.trusted_source, "From a trusted source")}
    ${li(c.corroborated, "2+ independent sources agree")}
    ${li(c.recent, "Reported in the last 24 h")}
    ${li(c.located, "Place identified on the map")}
    ${li(c.ai_check, `Local AI check${ai?.reason ? `: <small>${esc(ai.reason)}</small>` : ""}`)}
  </ul>`;
}
function renderReports() {
  const pending = reports.filter((r) => r.status === "pending");
  $("#c-reports").textContent = pending.length; $("#c-reports").hidden = !pending.length;
  if (!reports.length) {
    $("#report-list").innerHTML = `<div class="empty"><b>📭</b>No reports for ${esc(depts[dept].name)} yet. Run a scan, or tick "include simulated demo reports" to try the workflow.</div>`;
    return;
  }
  const open = new Set($$(".rep-body:not([hidden])").map((b) => b.closest(".rep").id));
  $("#report-list").innerHTML = reports.map((r, i) => {
    const v = r.verification, T = TYPES[r.type];
    const isOpen = open.size ? open.has(r.id) : i === 0 && r.status === "pending";
    const col = v.level === "High" ? "#16a34a" : v.level === "Medium" ? "#ca8a04" : "#dc2626";
    return `<article class="rep" id="${r.id}">
      <div class="rep-head" data-toggle tabindex="0" role="button" aria-expanded="${isOpen}">
        <span class="ico">${T.ico}</span>
        <h3>${r.simulated ? '<span class="sim">SIMULATED</span>' : ""}${esc(cleanTitle(r.headline))}</h3>
        <span class="trust ${v.level}">${v.level} trust · ${Math.round(v.score * 100)}%</span>
        <span class="sub">${T.name} · 📍 ${esc(r.place)} · ${r.sources.length} source${r.sources.length > 1 ? "s" : ""} · ${ago(r.updated)} · <span class="status ${r.status}">${r.status}</span></span>
      </div>
      <div class="rep-body" ${isOpen ? "" : "hidden"}>
        <p style="margin:10px 0 4px"><b>${esc(v.note)}</b></p>
        <div class="scorebar"><i style="width:${Math.round(v.score * 100)}%;background:${col}"></i></div>
        ${checksHtml(v, r.ai)}
        <b style="font-size:13px">Sources</b>
        <ul class="srcs">${r.sources.map((s) => {
          const tier = v.sources.find((x) => x.name === s.source)?.tier || "";
          return `<li>${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(cleanTitle(s.title))}</a>` : esc(cleanTitle(s.title))}<br><small>${esc(s.source)} · ${esc(tier)} · ${ago(s.ts)}</small></li>`;
        }).join("")}</ul>
        ${r.status === "pending" ? `<div class="actions">
            <button class="btn primary" type="button" data-publish="${r.id}">✅ Verify &amp; publish</button>
            <select class="btn" data-reason="${r.id}" aria-label="Reason to reject">
              <option>Fake / rumour</option><option>Not in our area</option><option>Duplicate</option><option>Too minor to publish</option><option>Already resolved</option></select>
            <button class="btn danger" type="button" data-reject="${r.id}">✗ Reject</button></div>
          <div data-form-host="${r.id}"></div>` : ""}
        ${r.status === "published" ? `<p class="hint">Published by ${esc(r.reviewed_by)} ${ago(r.reviewed_at)}. See <b>Active incidents</b>.</p>` : ""}
        ${r.status === "rejected" ? `<p class="hint">Rejected by ${esc(r.reviewed_by)}: ${esc(r.rejected_reason)}</p>` : ""}
      </div>
    </article>`;
  }).join("");
}
$("#report-list").addEventListener("click", async (e) => {
  const head = e.target.closest("[data-toggle]");
  if (head && !e.target.closest("a")) {
    const body = head.nextElementSibling; body.hidden = !body.hidden; head.setAttribute("aria-expanded", !body.hidden);
    const r = reports.find((x) => x.id === head.parentElement.id);
    if (!body.hidden && r?.suggested) { M.reset(); M.markEvent(r.suggested); const p = M.eventPoint(r.suggested); if (p) M.map.setView(p, 13); }
    return;
  }
  const pub = e.target.closest("[data-publish]");
  if (pub) {
    const r = reports.find((x) => x.id === pub.dataset.publish);
    openPublishForm($(`[data-form-host="${r.id}"]`), { reportId: r.id, title: cleanTitle(r.headline), ev: { ...r.suggested } });
    return;
  }
  const rej = e.target.closest("[data-reject]");
  if (rej) {
    const reason = $(`[data-reason="${rej.dataset.reject}"]`).value;
    await api(`/api/reports/${rej.dataset.reject}/reject`, { reason, department: dept });
    toast(`Rejected: ${reason}. It will not reach the public.`); loadReports();
  }
});
$("#report-list").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-toggle]")) { e.preventDefault(); e.target.click(); } });

// ============================================== publish form (shared with field report)
function defaultLocation(type) {
  const ev = { type };
  if (type === "bridge_collapse" || type === "road_block") ev.edge = M.graph.edges.find((x) => x.kind === (type === "bridge_collapse" ? "bridge" : "road")).id;
  if (type === "flood" || type === "power_outage") { const c = M.map.getCenter(); ev.lat = c.lat; ev.lon = c.lng; ev.radius_km = 1.5; }
  if (type === "factory_shutdown") ev.workplace = M.graph.facilities.find((f) => f.kind === "workplace").id;
  if (type === "disease_outbreak") ev.zone = M.graph.facilities.find((f) => f.kind === "zone").id;
  return ev;
}
function locHtml(ev) {
  const opt = (v, t, sel) => `<option value="${v}"${v === sel ? " selected" : ""}>${esc(t)}</option>`;
  if (ev.type === "bridge_collapse" || ev.type === "road_block")
    return `<label class="field">Road / bridge <small class="hint">(or click it on the map)</small><select name="edge">${[...M.graph.edges].sort((a, b) => (a.kind === "road") - (b.kind === "road") || a.name.localeCompare(b.name)).map((e) => opt(e.id, (e.kind === "bridge" ? "🌉 " : e.kind === "flyover" ? "⤴️ " : "") + e.name, ev.edge)).join("")}</select></label>`;
  if (ev.type === "flood" || ev.type === "power_outage")
    return `<p class="callout ok" data-loc-text>📍 Centre ${ev.lat.toFixed(4)}, ${ev.lon.toFixed(4)}. Click the map to move it.</p>
      <label class="field">Affected radius <b data-rad-out>${ev.radius_km || 1.5} km</b><input type="range" name="radius" min="0.5" max="4" step="0.1" value="${ev.radius_km || 1.5}"></label>`;
  if (ev.type === "factory_shutdown")
    return `<label class="field">Workplace<select name="workplace">${M.graph.facilities.filter((f) => f.kind === "workplace").map((f) => opt(f.id, f.name, ev.workplace)).join("")}</select></label>`;
  return `<label class="field">Area<select name="zone">${M.graph.facilities.filter((f) => f.kind === "zone").map((f) => opt(f.id, f.name, ev.zone)).join("")}</select></label>`;
}
function openPublishForm(host, { reportId = null, title = "", ev, mode = "publish" }) {
  $$("[data-form-host]").forEach((h) => { if (h !== host) h.innerHTML = ""; });
  const f = { reportId, ev, gravity: ev.magnitude || 3, eta: ev.duration_h || 24, host, mode };
  activeForm = f;
  const draw = () => {
    host.innerHTML = `<div class="form-box">
      <h4>${mode === "field" ? "📝 New field report" : "✅ Verify &amp; publish"}</h4>
      <label class="field">Title the public will see<input type="text" name="title" value="${esc(title)}" maxlength="160" placeholder="e.g. Sukhna Choe bridge damaged, Panchkula traffic diverted"></label>
      <label class="field">What happened<select name="type">${Object.entries(TYPES).filter(([k]) => handles(k) || mode === "publish").map(([k, t]) => `<option value="${k}"${k === f.ev.type ? " selected" : ""}>${t.ico} ${t.name}</option>`).join("")}</select></label>
      ${locHtml(f.ev)}
      <fieldset class="chips-field"><legend>Gravity of the problem</legend>
        <div class="chips">${[1, 2, 3, 4, 5].map((g) => `<button type="button" class="chip" data-grav="${g}" aria-pressed="${f.gravity === g}">${g} · ${SEV[g]}</button>`).join("")}</div></fieldset>
      <fieldset class="chips-field"><legend>Time required to solve it</legend>
        <div class="chips">${[[2, "2 h"], [6, "6 h"], [12, "12 h"], [24, "1 day"], [48, "2 days"], [72, "3 days"], [168, "1 week"]].map(([h, n]) => `<button type="button" class="chip" data-eta="${h}" aria-pressed="${f.eta === h}">${n}</button>`).join("")}</div>
        <label class="field inline">or exactly <input type="number" name="eta" min="1" max="720" value="${f.eta}"> hours</label></fieldset>
      <label class="field">Advice for the public (optional)<textarea name="note" maxlength="400" placeholder="e.g. Avoid the bridge; use the Zirakpur route. Ambulances pre-positioned in Panchkula.">${esc(f.note || "")}</textarea></label>
      <div class="preview" data-preview hidden></div>
      <div class="actions">
        <button class="btn" type="button" data-act="preview">👁️ Preview impact</button>
        <button class="btn primary" type="button" data-act="publish">📢 Publish to public dashboard</button>
        ${mode === "publish" ? '<button class="btn ghost" type="button" data-act="cancel">Cancel</button>' : ""}
      </div><p class="err" data-err role="alert"></p></div>`;
    M.reset(); M.markEvent(f.ev);
  };
  const read = () => {
    f.title = $("[name=title]", host).value.trim(); f.note = $("[name=note]", host).value;
    f.eta = +$("[name=eta]", host).value || f.eta;
    for (const k of ["edge", "workplace", "zone"]) { const el = $(`[name=${k}]`, host); if (el) f.ev[k] = el.value; }
    const rad = $("[name=radius]", host); if (rad) f.ev.radius_km = +rad.value;
    return { ...f.ev, magnitude: f.gravity, duration_h: f.eta, label: f.title };
  };
  draw();
  host.onclick = async (e) => {
    const g = e.target.closest("[data-grav]"), et = e.target.closest("[data-eta]"), act = e.target.closest("[data-act]")?.dataset.act;
    if (g) { read(); f.gravity = +g.dataset.grav; title = f.title; return draw(); }
    if (et) { read(); f.eta = +et.dataset.eta; title = f.title; return draw(); }
    if (act === "cancel") { host.innerHTML = ""; activeForm = null; M.reset(); return; }
    if (act === "preview" || act === "publish") {
      const ev = read(), err = $("[data-err]", host); err.textContent = "";
      if (act === "preview") {
        try {
          const r = await api("/api/simulate", ev);
          M.paint(r);
          const top = r.impacts.slice(0, 3).map((i) => `<li>${CAT[i.category].ico} ${esc(i.title)} <small>(in ${when(i.eta_h)})</small></li>`).join("");
          const p = $("[data-preview]", host); p.hidden = false;
          p.innerHTML = `<b>If published:</b> ${short(r.totals.people)} people across ${r.totals.zones} areas, ${r.totals.critical} critical alerts.<ul class="plain">${top}</ul>`;
        } catch (x) { err.textContent = x.message; }
        return;
      }
      if (!f.title || f.title.length < 5) { err.textContent = "Give it a clear title (at least 5 characters)."; return; }
      try {
        let rid = f.reportId;
        if (f.mode === "field") rid = (await api("/api/reports/manual", { title: f.title, event: ev, department: dept })).id;
        await api("/api/incidents", { report_id: rid, title: f.title, event: ev, gravity: f.gravity, eta_resolve_h: f.eta, public_note: f.note || "", department: dept });
        toast("Published. Citizens can now see it on the public dashboard.");
        activeForm = null; host.innerHTML = "";
        if (f.mode === "field") renderFieldForm();
        await Promise.all([loadReports(), loadIncidents()]); showTab("incidents");
      } catch (x) { err.textContent = x.message; }
    }
  };
  host.onchange = (e) => {
    if (e.target.name === "type") { read(); title = f.title; f.ev = { ...defaultLocation(e.target.value) }; activeForm = f; draw(); }
    else if (["edge", "workplace", "zone"].includes(e.target.name)) { read(); M.reset(); M.markEvent(f.ev); }
  };
  host.oninput = (e) => {
    if (e.target.name === "radius") { f.ev.radius_km = +e.target.value; $("[data-rad-out]", host).textContent = `${f.ev.radius_km} km`; M.reset(); M.markEvent(f.ev); }
  };
  return f;
}
function onMapClick(ll) {
  const f = activeForm;
  if (!f || !(f.ev.type === "flood" || f.ev.type === "power_outage")) return;
  f.ev.lat = ll.lat; f.ev.lon = ll.lng;
  const t = $("[data-loc-text]", f.host); if (t) t.textContent = `📍 Centre ${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}. Click the map to move it.`;
  M.reset(); M.markEvent(f.ev);
}
function onMapRoad(e) {
  const f = activeForm;
  if (!f || !(f.ev.type === "bridge_collapse" || f.ev.type === "road_block")) return;
  f.ev.edge = e.id; const sel = $("[name=edge]", f.host); if (sel) sel.value = e.id;
  M.reset(); M.markEvent(f.ev); toast(`Location set: ${e.name}`);
}
let fieldForm = null;
function renderFieldForm() {
  const first = Object.keys(TYPES).find(handles) || "road_block";
  fieldForm = openPublishForm($("#field-form"), { mode: "field", ev: { ...defaultLocation(first), magnitude: 3, duration_h: 12 } });
  activeForm = null; // becomes the map target only while the officer is on that tab
}
$('.tabs2 [data-tab="field"]').addEventListener("click", () => { activeForm = fieldForm; M.reset(); M.markEvent(fieldForm.ev); });

// ============================================================== incidents
async function loadIncidents() {
  [incidents, comments] = await Promise.all([api("/api/incidents"), api("/api/comments")]);
  incidents = incidents.filter((i) => handles(i.event.type));
  const active = incidents.filter((i) => i.status === "active");
  $("#c-incidents").textContent = active.length; $("#c-incidents").hidden = !active.length;
  renderIncidents();
}
function renderIncidents() {
  if (!incidents.length) { $("#incident-list").innerHTML = `<div class="empty"><b>🟢</b>No incidents for your department. Publish a verified report to create one.</div>`; return; }
  $("#incident-list").innerHTML = incidents.map((i) => {
    const T = TYPES[i.event.type], end = i.created + i.eta_resolve_h * 3600, left = (end - Date.now() / 1000) / 3600;
    return `<article class="rep" id="${i.id}">
      <div class="rep-head" data-itoggle tabindex="0" role="button">
        <span class="ico">${T.ico}</span>
        <h3>${i.simulated ? '<span class="sim">SIMULATED</span>' : ""}${esc(i.title)}</h3>
        <span class="status ${i.status}">${i.status}</span>
        <span class="sub">Gravity ${i.gravity}/5 (${SEV[i.gravity]}) · ${i.status === "active" ? (left > 0 ? `about ${when(left)} left to resolve` : `<span style="color:var(--crit)">overdue by ${when(-left)}</span>`) : `resolved ${ago(i.resolved_at)}`} · ${esc(i.verified_by)}</span>
      </div>
      <div class="rep-body" hidden>
        <ul class="hist">${[...i.history].reverse().map((h) => `<li>${esc(h.note)}<small>${esc(h.by)} · ${R.clock(h.t)}</small></li>`).join("")}</ul>
        <div class="actions">
          <button class="btn" type="button" data-map="${i.id}">🗺️ Show cascade on map</button>
          <a class="btn" href="/public#${i.id}" target="_blank" rel="noopener">📢 View public page</a>
        </div>
        ${i.status === "active" ? `
        <div class="form-box" data-upd="${i.id}">
          <h4>Update the situation</h4>
          <div class="row2">
            <label class="field">Gravity<select name="gravity">${[1, 2, 3, 4, 5].map((g) => `<option value="${g}"${g === i.gravity ? " selected" : ""}>${g} · ${SEV[g]}</option>`).join("")}</select></label>
            <label class="field">Total time to resolve (h)<input type="number" name="eta" min="1" max="720" value="${i.eta_resolve_h}"></label>
          </div>
          <label class="field">Advice for the public<textarea name="pnote" maxlength="400">${esc(i.public_note)}</textarea></label>
          <label class="field">What changed (for the log)<input type="text" name="note" maxlength="300" placeholder="e.g. Second lane reopened"></label>
          <div class="actions"><button class="btn primary" type="button" data-save="${i.id}">💾 Save update</button>
            <button class="btn ok" type="button" data-resolve="${i.id}">🏁 Resolve &amp; file after-action report</button></div>
        </div>
        <div data-aar-host="${i.id}"></div>` : publicFeedback(i.id)}
      </div>
    </article>`;
  }).join("");
}
function publicFeedback(iid) {
  const cs = comments[iid] || [], vis = cs.filter((c) => !c.hidden);
  const avg = vis.length ? (vis.reduce((a, c) => a + c.rating, 0) / vis.length).toFixed(1) : null;
  return `<div class="form-box"><h4>💬 Public feedback ${avg ? `· <span class="stars">★</span> ${avg}/5 from ${vis.length}` : ""}</h4>
    ${cs.length ? [...cs].reverse().map((c) => `<div class="comment${c.hidden ? " hidden-c" : ""}">
      <div><span class="stars">${"★".repeat(c.rating)}${"☆".repeat(5 - c.rating)}</span> <b>${esc(c.name || "Anonymous")}</b>
        <small>${[c.area_name && esc(c.area_name), c.affected ? "was affected" : null, ago(c.t), c.hidden ? "hidden from public" : null].filter(Boolean).join(" · ")}</small>
        <button class="btn" type="button" style="float:right;padding:3px 9px;font-size:12px" data-hide="${iid}|${c.id}|${!c.hidden}">${c.hidden ? "Show" : "Hide"}</button></div>
      ${c.text ? `<p>${esc(c.text)}</p>` : ""}</div>`).join("") : `<p class="hint">No public feedback yet. Citizens can rate and comment on this incident from the public page.</p>`}</div>`;
}
$("#incident-list").addEventListener("click", async (e) => {
  const h = e.target.closest("[data-hide]");
  if (h) {
    const [iid, cid, hide] = h.dataset.hide.split("|");
    try {
      await api(`/api/incidents/${iid}/comments/${cid}/hide`, { hidden: hide === "true", department: dept });
      toast(hide === "true" ? "Comment hidden from the public page." : "Comment visible again.");
      await loadIncidents(); const el = $(`#${iid} .rep-body`); if (el) el.hidden = false;
    } catch (x) { toast(x.message); }
    return;
  }
  const head = e.target.closest("[data-itoggle]");
  if (head) { const b = head.nextElementSibling; b.hidden = !b.hidden; if (!b.hidden) showCascade(head.parentElement.id); return; }
  const m = e.target.closest("[data-map]"); if (m) return showCascade(m.dataset.map);
  const s = e.target.closest("[data-save]");
  if (s) {
    const box = $(`[data-upd="${s.dataset.save}"]`);
    try {
      await api(`/api/incidents/${s.dataset.save}`, { gravity: +$("[name=gravity]", box).value, eta_resolve_h: +$("[name=eta]", box).value,
        public_note: $("[name=pnote]", box).value, note: $("[name=note]", box).value, department: dept }, "PATCH");
      toast("Updated. The public page now shows the new situation.");
      await loadIncidents(); const el = $(`#${s.dataset.save} .rep-body`); if (el) el.hidden = false; showCascade(s.dataset.save);
    } catch (x) { toast(x.message); }
    return;
  }
  const r = e.target.closest("[data-resolve]"); if (r) return openAar(r.dataset.resolve);
});
async function showCascade(iid) {
  const d = await api(`/api/incidents/${iid}/cascade`);
  M.paint(d.cascade); return d.cascade;
}

// ======================================================== after-action report
async function openAar(iid) {
  const host = $(`[data-aar-host="${iid}"]`), c = await showCascade(iid);
  const preds = c.impacts.slice(0, 12);
  const answers = {};
  host.innerHTML = `<div class="form-box">
    <h4>🏁 After-action report</h4>
    <p class="hint" style="margin-top:0">What actually happened? This trains Ripple: confirmed predictions gain weight, wrong ones lose it, and the incident becomes a training drill.</p>
    <div class="row4">
      <label class="field">Deaths<input type="number" name="deaths" min="0" value="0"></label>
      <label class="field">Injured<input type="number" name="injured" min="0" value="0"></label>
      <label class="field">Evacuated<input type="number" name="evacuated" min="0" value="0"></label>
      <label class="field">People affected<input type="number" name="affected" min="0" value="0"></label>
    </div>
    <label class="field">How long did it actually take to resolve? (hours)<input type="number" name="actual" min="0" value="${Math.max(1, Math.round((Date.now() / 1000 - incidents.find((i) => i.id === iid).created) / 3600))}"></label>
    <b style="font-size:14px">Did Ripple's predictions come true?</b>
    <div>${preds.map((p, n) => `<div class="pred"><span>${CAT[p.category].ico} ${esc(p.title)}</span>
      <span class="seg" data-pred="${n}"><button type="button" class="y" data-v="1">Yes</button><button type="button" class="n" data-v="0">No</button><button type="button" class="u" data-v="u" aria-pressed="true">Not sure</button></span></div>`).join("") || '<p class="hint">No predictions to check.</p>'}</div>
    <label class="field" style="margin-top:10px">Anything that happened that Ripple did NOT predict?<textarea name="unexpected" maxlength="1000" placeholder="e.g. Lifts failed in high-rise societies; elderly stranded on upper floors"></textarea></label>
    <label class="field">Lessons learned<textarea name="lessons" maxlength="1000" placeholder="e.g. Pre-position pumps at Dhakoli underpass before forecast heavy rain"></textarea></label>
    <label class="field inline"><input type="checkbox" name="drill" checked> Add this incident to the training-drill library</label>
    <div class="actions"><button class="btn ok" type="button" data-file>📤 File report &amp; close incident</button></div>
    <p class="err" data-err role="alert"></p></div>`;
  host.onclick = async (e) => {
    const b = e.target.closest("[data-pred] button");
    if (b) { const seg = b.parentElement; answers[seg.dataset.pred] = b.dataset.v; $$("button", seg).forEach((x) => x.setAttribute("aria-pressed", x === b)); return; }
    if (!e.target.closest("[data-file]")) return;
    const num = (n) => +$(`[name=${n}]`, host).value || 0;
    const predicted = preds.map((p, n) => answers[n] === "1" || answers[n] === "0" ? { title: p.title, category: p.category, happened: answers[n] === "1" } : null).filter(Boolean);
    try {
      const res = await api(`/api/incidents/${iid}/aar`, { department: dept, deaths: num("deaths"), injured: num("injured"), evacuated: num("evacuated"),
        people_affected: num("affected"), actual_resolution_h: num("actual"), predicted, unexpected: $("[name=unexpected]", host).value,
        lessons: $("[name=lessons]", host).value, add_to_drills: $("[name=drill]", host).checked });
      toast(`Report filed. ${predicted.length} predictions fed back into the model.`);
      await loadIncidents(); showTab("training");
    } catch (x) { $("[data-err]", host).textContent = x.message; }
  };
}

// ================================================================ training
async function loadTraining() {
  const t = await api("/api/training");
  const rows = Object.entries(t.calibration);
  $("#training").innerHTML = `
    <div class="card">
      <h2>📈 How Ripple is learning</h2>
      <p class="hint" style="margin-top:0">Every after-action report checks Ripple's predictions against reality. Confirmed predictions raise that category's weight, wrong ones lower it, and the full record is saved as training data for the next model.</p>
      <div class="stats" style="margin:12px 0">
        <div class="stat"><b>${t.reports_filed}</b><span>after-action reports</span></div>
        <div class="stat"><b>${t.predictions_checked}</b><span>predictions checked</span></div>
        <div class="stat"><b>${t.predictions_confirmed}</b><span>came true</span></div>
        <div class="stat"><b>${t.precision == null ? "—" : Math.round(t.precision * 100) + "%"}</b><span>precision so far</span></div>
      </div>
      <h3>Weight per type of consequence</h3>
      ${rows.length ? `<table class="calib"><thead><tr><th>Type</th><th>Came true</th><th>Didn't</th><th>Weight now</th></tr></thead><tbody>
        ${rows.map(([k, v]) => `<tr><td>${CAT[k]?.ico || ""} ${esc(CAT[k]?.name || k)}</td><td>${v.hit}</td><td>${v.miss}</td><td><b style="color:${v.factor >= 1 ? "var(--low)" : "var(--crit)"}">×${v.factor}</b></td></tr>`).join("")}
      </tbody></table>` : '<p class="hint">No outcomes recorded yet. All weights are ×1.0.</p>'}
      <p class="hint">${t.drill_cases_from_reports} incident(s) added to the drill library.</p>
      <div class="actions"><button class="btn" type="button" id="export">⬇️ Download training dataset (JSON)</button><a class="btn" href="/drills">🎯 Open training drills</a></div>
    </div>`;
  $("#export").onclick = async () => {
    const d = await api("/api/training/export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "ripple-training-data.json" });
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
}

boot();
