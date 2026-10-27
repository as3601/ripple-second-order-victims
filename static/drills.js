// Training drills: replay a disaster as timed situation updates; the trainee picks the right action.
const { $, $$, esc, inr, short, when, TYPES, SEV, CAT, api, toast } = R;
$("#nav").innerHTML = R.nav("/drills");

const ROLES = {
  dm: { name: "Disaster Management officer", cats: null },
  police: { name: "Police & traffic", cats: ["ems", "residents", "school", "income", "food"] },
  health: { name: "Health officer", cats: ["ems", "hospital", "medicine", "cold_chain", "meals"] },
};
const PACE = [[30, "Relaxed · 30 s per decision"], [20, "Standard · 20 s"], [12, "Pressure · 12 s"]];
const KIND = { real: "📜 Real past event", after_action: "📋 From an after-action report", practice: "🧪 Practice scenario" };
const WRONG = [
  "Wait for more information before taking any action",
  "Send every available ambulance to the event site",
  "Order all schools and offices across the tricity to close",
  "Post an update on social media and wait for responses",
  "Ask residents to drive themselves to the nearest hospital",
];
const MAX_INJECTS = 8, BASE_PTS = 10, SPEED_PTS = 5;

let cases = [], kind = "real", M = null, drill = null, cascade = null, run = null;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ================================================================ library
async function loadLibrary() {
  cases = await api("/api/drills");
  renderLibrary();
}
function renderLibrary() {
  $$("#kinds [data-kind]").forEach((b) => b.setAttribute("aria-selected", b.dataset.kind === kind));
  const list = cases.filter((c) => c.kind === kind);
  $("#grid").innerHTML = list.length ? list.map((c) => `
    <button type="button" class="drill" data-id="${c.id}">
      <span class="kind ${c.kind}">${KIND[c.kind]}${c.date ? ` · ${esc(c.date)}` : ""}</span>
      <b>${TYPES[c.event.type].ico} ${esc(c.title)}</b>
      <p>${esc(c.summary)}</p>
      <span class="meta">${c.attempts ? `${c.attempts} attempt${c.attempts > 1 ? "s" : ""} · best ${c.leaderboard[0].score} pts (${esc(c.leaderboard[0].name)})` : "No attempts yet"} · Start ▶</span>
    </button>`).join("")
    : `<div class="empty" style="grid-column:1/-1"><b>📋</b>${kind === "after_action"
      ? "No after-action reports yet. When an official resolves an incident in the Official console and files its report, it appears here as a drill automatically."
      : "No drills here."}</div>`;
}
$("#kinds").addEventListener("click", (e) => { const b = e.target.closest("[data-kind]"); if (b) { kind = b.dataset.kind; renderLibrary(); } });
$("#grid").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) openDrill(b.dataset.id); });

// ================================================================== setup
async function openDrill(id) {
  drill = await api(`/api/drills/${id}`);
  cascade = await api("/api/simulate", drill.event);
  $("#library").hidden = true; $("#stage").hidden = false;
  if (!M) M = await R.createMap($("#map")); else M.map.invalidateSize();
  M.reset(); M.markEvent(drill.event);
  const p = M.eventPoint(drill.event); if (p) M.map.setView(p, 12);
  let name = ""; try { name = localStorage.getItem("ripple_trainee") || ""; } catch {}
  $("#panel").innerHTML = `
    <button class="btn sm" type="button" data-act="back">← All drills</button>
    <article class="card hero" style="margin-top:10px">
      <div class="ev">${KIND[drill.kind]}${drill.date ? ` · ${esc(drill.date)}` : ""}</div>
      <p class="headline">${TYPES[drill.event.type].ico} ${esc(drill.title)}</p>
      <p><b>Situation at the start:</b> ${esc(drill.summary)}</p>
      <p class="hint">${esc(drill.source_note)}</p>
    </article>
    <article class="card">
      <h2>Your drill</h2>
      <label class="field">Your name (for the leaderboard)<input type="text" id="t-name" maxlength="40" value="${esc(name)}" placeholder="e.g. SI Gurpreet, Sector 17 PS"></label>
      <div class="row2">
        <label class="field">Your role<select id="t-role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}">${r.name}</option>`).join("")}</select></label>
        <label class="field">Pace<select id="t-pace">${PACE.map(([s, n]) => `<option value="${s}"${s === 20 ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      </div>
      <p class="hint">You'll get up to ${MAX_INJECTS} situation updates in the order they would unfold. Each time, choose the best first action. Faster correct answers score more.</p>
      <button class="btn primary big" type="button" data-act="start">▶ Start drill</button>
    </article>
    ${boardHtml(drill.leaderboard)}`;
}
function boardHtml(board) {
  if (!board?.length) return "";
  return `<article class="card"><h2>🏆 Leaderboard</h2><table class="board"><thead><tr><th>#</th><th>Name</th><th>Role</th><th>Score</th><th>Correct</th><th>Avg time</th></tr></thead><tbody>
    ${board.map((a, n) => `<tr><td>${n + 1}</td><td>${esc(a.name)}</td><td>${esc(ROLES[a.role]?.name || a.role)}</td><td><b>${a.score}</b>/${a.max_score}</td><td>${a.correct}/${a.total}</td><td>${a.avg_response_s}s</td></tr>`).join("")}
  </tbody></table></article>`;
}
$("#panel").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "back") { stopTimer(); $("#stage").hidden = true; $("#library").hidden = false; loadLibrary(); }
  if (act === "start") start();
  if (act === "next") nextInject();
  if (act === "retry") openDrill(drill.id);
  const opt = e.target.closest("[data-opt]"); if (opt && !opt.disabled) answer(+opt.dataset.opt);
});

// =================================================================== play
function buildInjects(role) {
  const cats = ROLES[role].cats;
  let pool = cascade.impacts.filter((i) => !cats || cats.includes(i.category));
  if (pool.length < 3) pool = cascade.impacts;
  const picked = [...pool].sort((a, b) => b.score - a.score).slice(0, MAX_INJECTS).sort((a, b) => a.eta_h - b.eta_h);
  return picked.map((i) => {
    const others = shuffle(cascade.impacts.filter((o) => o.category !== i.category && o.action !== i.action).map((o) => o.action));
    const wrong = [...new Set([...others.slice(0, 1), ...shuffle([...WRONG])])].slice(0, 2);
    const options = shuffle([{ text: i.action, right: true }, ...wrong.map((t) => ({ text: t, right: false }))]);
    return { impact: i, options };
  });
}
function start() {
  const name = $("#t-name").value.trim() || "Anonymous";
  try { localStorage.setItem("ripple_trainee", name); } catch {}
  const role = $("#t-role").value;
  run = { name, role, pace: +$("#t-pace").value, injects: buildInjects(role), n: -1, score: 0, correct: 0, times: [], answers: [], revealed: new Set() };
  if (!run.injects.length) { toast("This scenario produced no situation updates. Try another drill."); return; }
  nextInject();
}
function hud() {
  const i = run.injects[run.n]?.impact;
  return `<div class="hud">
    <div><span>Clock</span><b>T+${i ? when(i.eta_h) : "0"}</b></div>
    <div><span>Update</span><b>${run.n + 1}/${run.injects.length}</b></div>
    <div><span>Score</span><b>${run.score}</b></div>
    <div><span>Correct</span><b>${run.correct}/${Math.max(0, run.answers.length)}</b></div>
  </div>`;
}
function nextInject() {
  run.n++;
  if (run.n >= run.injects.length) return finish();
  const { impact: i, options } = run.injects[run.n];
  if (i.zone) run.revealed.add(i.zone);
  M.paint(cascade, { zonesOnly: run.revealed, fit: false });
  $("#panel").innerHTML = `${hud()}
    <article class="card inject">
      <div class="tag">⚠️ SITUATION UPDATE · T+${when(i.eta_h)} after the event</div>
      <h2 style="margin-top:6px">${CAT[i.category].ico} ${esc(i.title)}</h2>
      <p>${esc(i.detail)}</p>
      <p class="hint">About ${inr(i.people)} people involved · ${i.order === 1 ? "direct effect" : i.order === 2 ? "second-order effect" : "third-order effect"}</p>
      <b>What is your first action?</b>
      <div class="options">${options.map((o, n) => `<button type="button" class="opt" data-opt="${n}">${String.fromCharCode(65 + n)}. ${esc(o.text)}</button>`).join("")}</div>
      <div class="timer" aria-hidden="true"><i id="timebar" style="width:100%"></i></div>
      <div id="verdict"></div>
    </article>
    <button class="btn sm ghost" type="button" data-act="back">✕ Quit drill</button>`;
  run.t0 = performance.now();
  stopTimer();
  run.timer = setInterval(() => {
    const left = run.pace - (performance.now() - run.t0) / 1000;
    const bar = $("#timebar"); if (bar) bar.style.width = `${Math.max(0, (left / run.pace) * 100)}%`;
    if (left <= 0) answer(-1);
  }, 200);
}
function stopTimer() { if (run?.timer) clearInterval(run.timer); }
function answer(n) {
  stopTimer();
  const inj = run.injects[run.n], secs = Math.min(run.pace, (performance.now() - run.t0) / 1000);
  const ok = n >= 0 && inj.options[n].right;
  const pts = ok ? BASE_PTS + Math.round(SPEED_PTS * (1 - secs / run.pace)) : 0;
  run.score += pts; run.correct += ok; run.times.push(secs);
  run.answers.push({ ok, timeout: n < 0, impact: inj.impact, right: inj.options.find((o) => o.right).text, secs });
  $$(".opt").forEach((b, k) => { b.disabled = true; if (inj.options[k].right) b.classList.add("right"); else if (k === n) b.classList.add("wrong"); });
  $("#verdict").innerHTML = `<div class="verdict ${ok ? "right" : "wrong"}">
    ${ok ? `✅ <b>Correct!</b> +${pts} points (${secs.toFixed(1)} s)` : n < 0 ? "⏰ <b>Time's up.</b> In a real incident, hesitation costs lives." : "❌ <b>Not the best first action.</b>"}
    ${ok ? "" : `<br><b>Best action:</b> ${esc(inj.options.find((o) => o.right).text)}`}
    <br><small>Why: ${esc(inj.impact.detail)}</small></div>
    <div class="actions"><button class="btn primary" type="button" data-act="next">${run.n + 1 < run.injects.length ? "Next update →" : "See debrief →"}</button></div>`;
  $(".hud").outerHTML = hud();
  $('[data-act="next"]').focus();
}

// ================================================================ debrief
async function finish() {
  M.paint(cascade, { fit: true });
  const max = run.injects.length * (BASE_PTS + SPEED_PTS), pct = Math.round((run.score / max) * 100);
  const avg = +(run.times.reduce((a, b) => a + b, 0) / run.times.length).toFixed(1);
  const grade = pct >= 80 ? ["🏅", "Excellent", "var(--low)"] : pct >= 60 ? ["👍", "Good", "var(--med)"] : ["📚", "Needs more practice", "var(--crit)"];
  let board = drill.leaderboard;
  try {
    board = (await api(`/api/drills/${drill.id}/attempts`, { name: run.name, role: run.role, score: run.score, max_score: max,
      correct: run.correct, total: run.injects.length, avg_response_s: avg })).leaderboard;
  } catch { toast("Couldn't save your score"); }
  const actual = drill.actual ? Object.entries({ deaths: "Deaths", injured: "Injured", evacuated: "Evacuated", people_affected: "People affected", actual_resolution_h: "Hours to resolve" })
    .map(([k, n]) => `<div class="stat"><b>${inr(drill.actual[k] || 0)}</b><span>${n}</span></div>`).join("") : "";
  $("#panel").innerHTML = `
    <article class="card hero">
      <div class="ev">Debrief · ${esc(drill.title)} · ${esc(ROLES[run.role].name)}</div>
      <p class="grade" style="color:${grade[2]};margin:6px 0">${grade[0]} ${pct}%</p>
      <p class="headline" style="margin:0 0 12px">${grade[1]}, ${esc(run.name)}.</p>
      <div class="stats">
        <div class="stat"><b>${run.score}/${max}</b><span>points</span></div>
        <div class="stat"><b>${run.correct}/${run.injects.length}</b><span>correct decisions</span></div>
        <div class="stat"><b>${avg}s</b><span>average decision time</span></div>
        <div class="stat"><b>${run.answers.filter((a) => a.timeout).length}</b><span>timed out</span></div>
      </div>
      <div class="actions"><button class="btn primary" type="button" data-act="retry">🔁 Try again</button><button class="btn" type="button" data-act="back">🎯 Other drills</button></div>
    </article>
    <article class="card"><h2>📝 Your decisions</h2><ol class="review">${run.answers.map((a) => `<li>${a.ok ? "✅" : a.timeout ? "⏰" : "❌"} <b>T+${when(a.impact.eta_h)}: ${esc(a.impact.title)}</b>${a.ok ? "" : `<br><small>Best action: ${esc(a.right)}</small>`}</li>`).join("")}</ol></article>
    ${drill.what_happened?.length || actual ? `<article class="card"><h2>📜 What actually happened</h2>
      ${actual ? `<div class="stats" style="grid-template-columns:repeat(5,1fr);margin-bottom:10px">${actual}</div>` : ""}
      <ul class="plain">${(drill.what_happened || []).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
      <p class="hint">${esc(drill.source_note)}</p></article>` : ""}
    <article class="card"><h2>🗺️ The full cascade</h2><p class="hint" style="margin-top:0">The map now shows every area Ripple predicts would be affected.</p>
      <p>${short(cascade.totals.people)} people across ${cascade.totals.zones} areas · ${cascade.totals.critical} critical effects.</p></article>
    ${boardHtml(board)}`;
}

loadLibrary();
