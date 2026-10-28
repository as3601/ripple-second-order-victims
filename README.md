# Ripple — AI for Second-Order Victims

**Code Yudh · Chandigarh University · Track: Smart Cities & Disaster Response**

**Live demo:** https://ripple-2vx1.onrender.com/public (free hosting: the first visit after a quiet spell takes about a minute to wake up)

> Disaster tools map the *damage*. Ripple maps the *consequences* — and answers the question
> nobody answers in the first hours after an event: **"Who will be affected next, and when?"**

Feed Ripple a disruptive event (bridge collapse, flood, road blockage, power outage, factory
shutdown, disease outbreak). It spreads the disruption through a cross-domain dependency graph of the
Chandigarh tricity (roads, hospitals, ambulance bases, medicine depots, schools, workplaces,
residential zones) and returns a **ranked, time-ordered list of first-, second- and third-order human
consequences**, each with a plain-language suggested intervention.

## Run it (≈1 minute)

```bash
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:8000 and click any scenario on the left. The map tiles and Leaflet load
from a CDN, so you need internet.

## Live operations: news → officials → public → training

Ripple is more than a simulator. It runs a full incident workflow:

| Page | Who it's for | What it does |
|---|---|---|
| **/official** | Government officials (sign in by department) | Incoming reports from automatic news monitoring, with a verification checklist. Verify & publish (set **gravity** and **time required to solve it**), post updates, then file an **after-action report** (deaths, injured, evacuated, which predictions came true). |
| **/public** | Citizens | Only **officially verified** incidents, in plain language (see below). Citizens can rate and comment on **resolved** incidents. |
| **/drills** | Police, disaster-management and health trainees | Replays **real past tricity disasters** (Feb 2022 power strike, July 2023 floods), incidents from our own after-action reports, and practice scenarios as timed situation updates. Score, leaderboard, and "what actually happened". |

Official access code: on the **live demo** it is **`codeyudh2026`**, also printed under the sign-in box. Locally the default is
`ripple2026`; change it with the `RIPPLE_OFFICIAL_CODE` environment variable. `RIPPLE_SHOW_CODE=1` prints the code on the
sign-in page (for public demos only).

### The public page, designed for citizens
- **Plain words.** "1st/2nd/3rd-order victims" become **Directly hit**, **Everyday services affected** and
  **What could follow if it lasts**. Warnings read like "Ambulances will take longer to reach Manimajra".
- **No false precision.** Every figure is rounded ("roughly 15–20 min longer", "around 8,600 people") and tagged
  **ESTIMATE**, with the approving department and the time it was last updated.
- **"Is my area affected?" first.** Pick an area or tap *Use my location* and get a clear yes/no at the top,
  with only the warnings that apply to you.
- **One action per warning.** Each warning pairs a concrete step (nearest hospital you can still reach, roads still
  open, a less crowded hospital, "buy 2–3 days of medicines") with a tap-to-call number (112 / 108 / 101 / 1077).
- **Status and freshness.** Every incident shows *Ongoing* or *Resolved*, when it started, when it was last updated
  and when officials expect it fixed. Incidents not updated for 6 hours get an "information may be out of date" warning.
- **Clear empty state.** "No active incidents. Last checked 10:09 pm", with links to the other pages.
- **Public feedback.** On resolved incidents citizens give a 1–5 star rating of how it was handled, say whether they
  were affected, and leave an optional comment (anonymous by default, rate-limited). Officials see all feedback in
  their console and can hide abusive comments.

### How Ripple makes sure the news is accurate
1. **Trusted sources only.** Every outlet has a reliability tier: official (PIB, police, administration) 1.0,
   wire agencies 0.9, established media (Tribune, HT, Indian Express, …) 0.7–0.85, unknown 0.3.
2. **Independent corroboration.** Reports of the same event type at the same place on the same day are
   clustered, and 2+ independent trusted outlets are required for "High trust".
3. **Live and local filters.** Court cases, budgets, anniversaries and stories outside the tricity are dropped
   automatically (e.g. one real scan: 50 headlines → 1 relevant).
4. **Local-AI check.** Qwen (Ollama) reads the headlines and judges whether they describe a current tricity disruption.
5. **Human in the loop.** **Nothing reaches the public until a department official verifies it.** Rumours can be
   rejected with a reason.

News comes from Google News RSS searches (which index The Tribune, HT, Indian Express, PIB and others). Monitoring
runs automatically every 15 minutes, plus a "Scan now" button. X/Facebook need paid APIs, so they're on the
roadmap. Tick "include SIMULATED demo reports" to demo the workflow on a day with no real disaster; those are
clearly labelled and never shown as real news.

### How it learns
After-action reports re-weight each consequence type (confirmed predictions gain weight, wrong ones lose it),
are exportable as a training dataset (JSON, including the public feedback summary) for a future ML model, and
automatically become new training drills.

### Demo data

The public page is empty until an official publishes something. For a demo, run:

```bash
python demo_incidents.py           # adds 4 active + 1 resolved incident, all labelled SIMULATED
python demo_incidents.py --remove  # removes them again
```

Re-running it refreshes the "started … ago" times. Choose **Manimajra** under "Is my area affected?" to see a
"Yes" answer, and open the resolved *Tribune Chowk flyover* incident to leave feedback.

### Simulator views

Two "what if?" simulators run on the same engine. They aren't linked from the menu, but open directly:

- **http://127.0.0.1:8000/**: the classic control-room dashboard (dark, everything on one screen).
- **http://127.0.0.1:8000/detailed**: a **guided view** for non-experts. Step by step (what
  happened → where → how bad → who's affected), with a time-bucketed action checklist, filters by
  type and area, cause chains for every alert, read-aloud and copy for the briefing, and
  print/PDF export. It works on a phone too.

Both use the same API and engine.

### Host it online (free, permanent link)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/as3601/ripple-second-order-victims)

`render.yaml` deploys Ripple on Render's free plan at a permanent `https://….onrender.com` link that doesn't need
your laptop. The official access code there is `codeyudh2026` and is shown on the sign-in page, so judges can try the
officials' console; the demo incidents load at startup. Free-plan limits:
- It sleeps after 15 minutes without visitors; the first visit afterwards takes about a minute to wake it.
- Its disk is temporary: incidents, comments and drill scores reset when it restarts or redeploys.
- There's no Ollama in the cloud, so AI briefings use the built-in template unless you add a free `GROQ_API_KEY`.

### Share with your team from your laptop (temporary link)

Double-click **`share.bat`**. It starts Ripple and opens a free Cloudflare tunnel, then prints a public
`https://….trycloudflare.com` link anyone can open, phones included. It also generates a **private official
access code** (saved in `team_access_code.txt`, never committed) and uses it in place of the public demo code.
Keep the window open while your team uses it. The link changes every time you run it.
Needs `cloudflared`, installed once with `winget install Cloudflare.cloudflared`.
The tunnel uses HTTP/2 over TCP (`--protocol http2`) rather than the default UDP (QUIC), which some Wi-Fi networks
drop. Either way, cloudflared must reach Cloudflare on port 7844. Some campus networks block that port completely,
and the link then dies within minutes. If that happens, connect the laptop to a phone hotspot. Keep the laptop
awake and online.

### AI briefing (free)

The plain-language briefing and the "hidden dependencies" come from a **free, local LLM via
[Ollama](https://ollama.com)**, so it works offline with no API key:

```bash
ollama pull qwen2.5:3b
```

Keep Ollama running and start `python app.py`. The model loads at startup, and each briefing takes
about 6s on a 4 GB laptop GPU. Use `RIPPLE_OLLAMA_MODEL=qwen2.5:7b` for better wording, but it
takes about 20s.

Free cloud alternatives, used only if Ollama isn't running: set `GROQ_API_KEY` (free key from
console.groq.com) or `GEMINI_API_KEY` (free key from aistudio.google.com). `ANTHROPIC_API_KEY` (Claude,
paid) is also supported. If no provider answers, Ripple falls back to a deterministic template,
so the demo never breaks. The badge next to the briefing shows which provider answered.

### Real-world data (OpenStreetMap)

`python fetch_osm.py` (about 1 minute, needs internet) pulls live data into `osm_cache.json`:
- **Locations** from the OSM **Nominatim** geocoder: 16 of 27 junctions and facilities (PGIMER,
  Fortis, Civil Hospital Panchkula, ISBT-43, Tribune Chowk, Chandigarh University and others). Any
  match more than 3 km from the expected spot is rejected, and the curated value is kept.
- **Road travel times** from **OSRM** routing over the OSM road network: all 36 road segments,
  with real driving distance and time × 1.4 for city traffic.

The cache is committed, so the demo runs offline. The map shows a "Live data: OpenStreetMap"
badge, and hovering a road shows its OSRM time.

## The five-stage pipeline (as in our proposal)

| Stage | Where | What it does |
|---|---|---|
| 1. Event ingestion | `app.py` (`/api/simulate`), left panel | 7 scripted scenarios, or a custom event: pick a road/bridge on the map, click an epicentre for a flood or outage, or choose a workplace/zone. Magnitude and duration are adjustable. |
| 2. Dependency graph | `city.py`, `engine.build_graph` | NetworkX graph of 27 junctions and 36 road segments (bridges and flyovers included), plus 6 hospitals, 4 ambulance bases, 2 drug depots, 6 schools, 4 workplaces and 11 residential zones with population, elderly %, children %, low-income % and daily-wage %. Every zone depends on emergency care, a school, a workplace and a medicine supply line. |
| 3. Cascade engine | `engine.run_cascade` | Applies the event (cuts or slows edges, adds spill-over congestion on diverted roads, cuts hospital capacity, closes facilities, adds casualty or outbreak surges). Then reruns Dijkstra on the damaged graph and compares each dependency with the baseline. **2nd order:** ambulance response delay, school-bus routes cut, pharmacy restock delayed, commutes broken, cold chain at risk. **3rd order:** patients rerouted to other hospitals overload their ERs, elderly miss chronic medicines after the ~12h stock buffer runs out, low-income children miss mid-day meals, daily-wage income is lost (₹), households become food-insecure. |
| 4. Impact scoring | `engine.score` | Score = severity × reach (log of people affected) × vulnerability (elderly, low-income, children) × urgency (how soon it lands) × feedback calibration. Bands: Critical / High / Medium / Low. |
| 5. Alert dashboard + feedback loop | `static/`, `feedback.py`, `llm.py` | Map (cut, slowed and congested roads; zones coloured by their worst alert; overloaded hospitals enlarged), ranked alerts with suggested actions and alternate routes, a cascade tree, a timeline and hospital load. Responders mark each alert ✓/✗. Per-category precision then re-weights future scores. A local LLM (Ollama, free) writes the briefing and lists hidden dependencies the graph doesn't model. |

## Demo script (3 minutes)

1. **Sukhna Choe Bridge collapse.** The first-order effect is just one bridge. Ripple shows ambulance
   response for Panchkula going +30 min, Manimajra +19 min, and GMCH-32's ER going over capacity
   because rerouted patients pile in. *None of these are on the bridge.*
2. **Cascade map tab.** Event → what broke → who depends on it → who is hurt next.
3. **Timeline tab.** The order responders should act in: ambulances now, hospitals within ~1.5h,
   pharmacies within 6h, elderly medicines at 12h, mid-day meals the next day.
4. **Monsoon flood** at Industrial Area / Tribune Chowk: 6 zones. Ram Darbar Colony (62% low-income)
   ranks first because vulnerability is part of the score.
5. **Industrial Area shutdown, 7 days.** A purely economic cascade: wage loss in ₹ lakh, then food
   insecurity after 72h.
6. Click **✓ Happened** on an alert and watch that category's weight change in the feedback panel.

**Live workflow (3 more minutes):**

7. **/official** → sign in → **News inbox** → scan with *include SIMULATED demo reports*. Trusted, corroborated
   stories score High; the fake viral social post scores Low and is labelled a rumour.
8. Publish one with a gravity and a time to resolve. It appears on **/public** within a minute.
9. On **/public**, pick an affected area: a clear "Yes", what to do and who to call.
10. Back in **/official**, resolve it and file the after-action report. Calibration updates, and the incident
    becomes a new drill.
11. On **/public**, rate and comment on the resolved incident. The feedback shows up in the official console.
12. **/drills**: play a real past disaster against the clock and land on the leaderboard.

## API

Simulation
- `GET  /api/graph`: nodes, edges and facilities
- `GET  /api/scenarios`: the scripted events
- `POST /api/simulate`: event JSON → `{first_order, impacts[], hospital_load, totals, graph_state}`
- `POST /api/brief`: event JSON → plain-language briefing (Ollama / Groq / Gemini / Claude, or a template fallback)
- `POST /api/feedback`: `{category, happened}` → calibration stats

Operations (🔒 = needs the `X-Official-Code` header)
- `GET  /api/departments`, `POST /api/official/login`
- 🔒 `GET /api/reports`, `POST /api/news/scan`, `GET /api/news/status`, `POST /api/reports/manual`, `POST /api/reports/{id}/reject`
- 🔒 `POST /api/incidents` (publish), `GET /api/incidents`, `PATCH /api/incidents/{id}`, `POST /api/incidents/{id}/aar`
- `GET  /api/public/incidents`: verified incidents, with the plain-language citizen view and feedback summaries
- `GET  /api/incidents/{id}/cascade`: cascade + citizen view for one incident
- `GET/POST /api/incidents/{id}/comments`: public feedback on a resolved incident
- 🔒 `GET /api/comments`, `POST /api/incidents/{id}/comments/{cid}/hide`
- 🔒 `GET /api/training`, `GET /api/training/export`
- `GET  /api/drills`, `GET /api/drills/{id}`, `POST /api/drills/{id}/attempts`

## What is real and what is simulated

| Real | Estimated | Simulated (labelled in the app) |
|---|---|---|
| Junction locations (OSM Nominatim), road distances and times (OSRM), map tiles (OSM), live news (Google News RSS), local AI (Ollama/Qwen), the cascade calculations, the full official → public → after-action workflow, the two historical drill events | Area populations and their elderly / children / low-income / daily-wage shares, hospital emergency beds and normal load, model constants (₹600 daily wage, ~12 h pharmacy stock, ~3 days of household food savings) | Demo incidents (`demo_incidents.py`), demo news and the fake social post (`data/sample_news.json`), the casualty and patient numbers inside the drills |

## Honest limitations / next steps

- Locations and road times come from OpenStreetMap and OSRM (`fetch_osm.py`). The road
  *topology* (which junctions connect) is still a curated 36-segment network, and populations and
  hospital capacities are illustrative. Next step: the full OSMnx street graph, GTFS bus routes, and
  census and data.gov.in figures for populations and bed counts.
- The rules are deterministic and the thresholds come from domain heuristics. Next step: fit
  severity and ETA from the outcome logs that the feedback loop collects (scikit-learn), and add
  agent-based traffic (Mesa).
- Feedback, incidents and comments are stored in JSON files. Production would use PostgreSQL + PostGIS.
- Social media (X, Facebook, Instagram) isn't scanned yet: their APIs are paid or restricted. Only Google News RSS
  is live; the "social post" in the demo is simulated.
- "Learning" re-weights each consequence type from officials' outcomes. It is not yet a trained ML model.
- Officials share one access code per deployment. Production would use per-person accounts.

## Team
Keep It Simple: Aditya Sharma (tech lead), Bhavya (research & content), Arnav Baheti (team lead).
