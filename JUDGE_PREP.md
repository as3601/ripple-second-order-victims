# Ripple: complete guide and judge prep

## 1. The one-line pitch
> "Disaster tools map the **damage**. Ripple maps the **consequences**. Give it one broken bridge
> and it tells you which ambulance will be late, which hospital will overflow, and which elderly
> person runs out of insulin, **before** it happens."

## 2. The problem (in your own words)
When a bridge collapses, everyone looks at the bridge. But that bridge was also an ambulance route,
a school-bus route, a medicine supply line and a commute. The people hurt by those *dependencies*
are the **second-order victims**. Today they're discovered only after the harm: the ambulance is
already stuck and the hospital is already overflowing. Traffic, hospitals, schools and suppliers each
see only their own piece. Nobody answers **"who is affected next?"**

## 3. What Ripple does
Input: **one event** (type, location, magnitude 1–5, duration in hours).
Output: a **ranked, time-ordered list of human consequences**:

| Order | Meaning | Examples Ripple produces |
|---|---|---|
| 1st | What physically broke | Bridge cut, roads submerged, factory shut, hospital ground floor flooded |
| 2nd | Who depended on it | Ambulance response +26 min, school-bus route cut, pharmacy restock delayed, commute broken, vaccine cold chain at risk |
| 3rd | Who gets hurt next | GMCH-32 ER at 145%, elderly miss BP/diabetes meds after 12h, children miss mid-day meals, ₹ lakh of daily wages lost, households become food-insecure after 3 days |

Each alert has: priority (Critical/High/Medium/Low), score, **number of people**, **how soon (ETA)**,
vulnerability %, an explanation, and a **concrete suggested action** with an alternate route.

## 4. How to use it
**Start:** make sure Ollama is running, then:
```
cd C:\Users\Asus\Documents\cascade-sentinel
python app.py
```
Open http://127.0.0.1:8000.

**Screen layout:**
- **Left: event input.** Click one of 7 scenarios, or build a custom event: pick a road or bridge
  (or click it on the map), click the map to set a flood or power-cut epicentre, or pick a workplace
  or area. Set magnitude and duration, then click **Predict cascade**.
- **Top bar:** people affected downstream · critical alerts · zones hit · time until the first impact.
- **Map:** red dashed = cut, orange = slowed, yellow dotted = jammed by diverted traffic. Circles
  are residential areas, coloured by their worst alert. A hospital dot grows when its ER is
  overloaded. Hover over a road to see its real OSRM drive time.
- **Right: briefing.** A plain-English summary written by a local AI.
- **Tabs:** *Ranked alerts* · *Cascade map* (event → 1st → 2nd → 3rd order + AI hidden risks) ·
  *Timeline* (when each problem lands) · *Hospitals* (ER load bars).
- **Feedback:** click ✓ Happened / ✗ Didn't happen on any alert. The bottom-left panel shows that
  category's weight changing.

**3-minute demo**
1. **Sukhna Choe Bridge collapse.** "One bridge broke, but Panchkula's ambulances are 26 minutes
   late and GMCH-32 is at 145%. None of them are on the bridge."
2. **Cascade map tab:** the chain from event to 1st, 2nd and 3rd order.
3. **Timeline tab:** "Ambulances now, hospitals in 1.5h, medicines at 12h, meals tomorrow."
4. **Monsoon flood:** Ram Darbar Colony ranks first because it is 62% low-income. Vulnerability
   changes the priority.
5. **Industrial Area shutdown (7 days):** no physical damage at all, just an economic cascade (wages,
   then food insecurity).
6. Click **✓ Happened** to show the feedback loop.

## 5. How it works (the 5-stage pipeline)

### Stage 1: Event ingestion (`app.py`)
A FastAPI server. `POST /api/simulate` takes the event as JSON, validated with Pydantic. Six event
types: bridge collapse, road blockage, flood, power outage, factory shutdown, disease outbreak.

### Stage 2: Dependency graph (`city.py`, `engine.build_graph`)
- A **NetworkX graph** with 27 junctions and 36 road segments (normal roads, 2 bridges, 2 flyovers).
  Each edge weight is its **travel time in minutes**.
- Attached facilities: 6 hospitals (PGIMER, GMCH-32, GMSH-16, Fortis, Civil Panchkula, Civil
  Kharar) with ER bed counts, 4 ambulance (108) bases, 2 medicine depots, 6 schools,
  4 workplaces, and **11 residential zones**. Each zone has its population, % elderly, % children,
  % low-income, % workers and % daily-wage workers.
- Each zone **depends on** four things: emergency care (nearest ambulance + nearest hospital), its
  school, its workplace and its medicine depot. These dependency links are what make the graph
  "cross-domain".
- **Real data:** `fetch_osm.py` geocoded 16 of 27 locations with **OpenStreetMap Nominatim** and
  routed all 36 roads with **OSRM** (real driving distance and time, × 1.4 for city traffic).
  Results are cached in `osm_cache.json`, so it works offline. Any geocode more than 3 km from the
  expected place is rejected.

### Stage 3: Cascade engine (`engine.run_cascade`)
1. **Apply the event to a copy of the graph:**
   - Bridge or road: remove the edge. **Diverted traffic** slows the neighbouring roads by
     ×(1 + 0.35 × magnitude). A collapse also adds 6 × magnitude casualties to the nearest hospital.
   - Flood: roads within 60% of the radius are removed; the rest of the radius is slowed.
     Hospitals inside lose 40% of ER capacity, and residents inside are displaced.
   - Power outage: traffic signals go dark (roads ×1.6 slower). Hospitals on diesel backup lose
     30% capacity if the outage lasts more than 8h. Workplaces inside shut.
   - Factory shutdown: that workplace closes. Outbreak: extra ER cases plus local school closure.
2. **Recompute every dependency** with **Dijkstra shortest paths** on the damaged graph and
   compare it with the normal graph:
   - Ambulance response + hospital transport worse by **≥ 4 min** → emergency-access alert.
   - School route worse by **≥ 15 min** (or school closed) → school-transport alert.
   - Depot → pharmacy worse by **≥ 20 min** → medicine-supply alert.
   - Home → work worse by **≥ 20 min** (or workplace closed) → livelihood alert.
3. **Third-order rules:**
   - Patients whose nearest hospital changed are **re-routed** there. That hospital's ER
     occupancy is recomputed, and **≥ 95%** means an overload alert.
   - Medicine cut for **> 12h** (the pharmacy stock buffer) → elderly miss chronic medicines.
   - School cut for **≥ 24h** in poorer zones → children miss PM-POSHAN mid-day meals.
   - Work lost → wage loss in ₹ (₹600/day). Lost for **≥ 72h** → household food insecurity.
   - Power cut for **> 4h** → vaccine and insulin cold chain at risk.
4. **Suggested actions** use the *new* shortest path, e.g. "route via Manimajra Road → Madhya Marg".

The whole cascade runs in about **2 milliseconds**.

### Stage 4: Impact scoring (`engine.score`)
```
score = 100 × severity × (0.35 + 0.65 × reach) × (0.7 + 0.5 × vulnerability) × urgency × calibration
```
- **severity:** per category (ambulance 1.0, hospital 0.92, cold chain 0.88, medicine 0.82, …, school 0.5)
- **reach:** log10(people + 1) / 5, capped at 1. Log scale, so 100,000 people don't automatically
  outrank 100 patients.
- **vulnerability:** elderly × 2 + low-income × 0.6 + children × 0.4, capped at 1
- **urgency:** 1 / √(1 + ETA hours / 12). Sooner means higher.
- **calibration:** from the feedback loop
- Score ≥ 55 is Critical, ≥ 40 High, ≥ 25 Medium, otherwise Low.

### Stage 5: Dashboard, AI and feedback (`static/`, `llm.py`, `feedback.py`)
- **Frontend:** plain HTML/CSS/JavaScript with **Leaflet** for the map (OpenStreetMap tiles).
- **AI layer:** the top predictions go to a **local LLM (Qwen 2.5 3B via Ollama)**. It writes a
  short control-room briefing and suggests 3–5 **hidden dependencies** the graph doesn't model
  (mandis, ASHA workers, PDS, …). The output is forced into a JSON schema, and it runs offline and
  free in about 6s. Fallbacks: free Groq or Gemini keys, Claude, then a fixed template.
- **Feedback loop:** each ✓/✗ is stored per category. precision = (hits + 1)/(total + 2) (Laplace
  smoothing), and weight = 0.6 + 0.8 × precision. So 0.6×–1.4×, with 1.0 meaning no evidence yet.

## 6. Tech stack and files
| Layer | Used |
|---|---|
| Backend | Python 3.12, FastAPI, Uvicorn, Pydantic |
| Graph / routing | NetworkX (Dijkstra), OSRM, OSM Nominatim |
| AI | Ollama + Qwen 2.5 (local), optional Groq / Gemini / Claude |
| Frontend | HTML, CSS, JavaScript, Leaflet, OpenStreetMap tiles |
| Storage | JSON files (feedback, OSM cache) |

| File | What's in it |
|---|---|
| `app.py` | API endpoints, scenarios, input validation |
| `city.py` | The city: junctions, roads, hospitals, zones, OSM overrides |
| `engine.py` | Graph building, event application, cascade, scoring, hidden-risk heuristics |
| `llm.py` | AI briefing with provider fallbacks |
| `feedback.py` | Feedback loop and calibration |
| `fetch_osm.py` | Pulls real OSM/OSRM data into the cache |
| `static/` | The dashboard |

About 1,500 lines of code in total.

## 7. How we built it (the story)
1. Started from the problem statement and picked **one city (Chandigarh tricity)** and three core
   verticals (roads, healthcare, school transport), then added medicine, livelihoods and power.
2. Modelled the city as a graph, because "what depends on what" *is* a graph problem: second-order
   effects are just paths through it.
3. Wrote the cascade as **"break the graph, re-route everything, compare"**. That way nothing about
   the consequences is hard-coded; it falls out of the network.
4. Added India-specific consequences (daily wages, mid-day meals, ASHA workers, PDS), because
   that's where the invisible victims are.
5. Added scoring that weights the **vulnerable**, then the dashboard, then the local LLM, the
   feedback loop and real OSM data.

## 8. Questions judges will ask, with answers

**Q: Is the data real?**
Partly. Locations (16/27) and all road travel times are real OpenStreetMap/OSRM data, and the map
badge shows it. Which roads connect where is a curated 36-segment network. Populations and bed
counts are realistic estimates, not official figures. Next step: the full OSMnx street network and
census / data.gov.in numbers.

**Q: Where is the AI?**
In three places. (1) The **cascade engine** is graph-based reasoning: shortest paths and
propagation over a dependency network. (2) An **LLM** writes plain-language briefings and finds
*hidden* dependencies the graph doesn't contain. (3) The **feedback loop** learns from outcomes
and re-weights predictions. With real outcome data, the next step is a trained severity model.

**Q: Why not just use ChatGPT?**
An LLM alone makes up numbers and can't compute that Panchkula's ambulance takes 26 minutes longer.
The graph engine does the **verifiable maths**: every number comes from a real route. The LLM only
**explains** the results and suggests extra risks, which are clearly labelled "unverified". It's
told not to invent figures.

**Q: How accurate is it? How did you validate it?**
Be honest: it hasn't been validated against a real incident yet, since that needs historical
disaster data. The design is built for validation, though. Every prediction is a checkable claim
("ambulance +26 min", "GMCH at 145%"), and the feedback loop records whether each one came true and
adjusts the weights. A pilot with one disaster-management cell would produce that data.

**Q: Why these thresholds (4 min, 12h, 95%)?**
They're domain heuristics: a few minutes matters for cardiac and trauma cases, pharmacies hold
about a day of stock with less for critical items, and ERs fail above about 95% occupancy. They're
constants in `engine.py`, so experts can tune them, and the feedback loop corrects them over time.

**Q: What makes this different from Google Maps or GIS disaster tools?**
Those are first-order: they show the jam or map the damaged area. None of them connect domains.
Ripple asks what depends on the broken thing, two and three steps out, across traffic, health,
schools, supply and livelihoods.

**Q: Does it scale to a real city?**
Yes. Dijkstra is O(E log V). The cascade runs in about 2 ms on this graph, and a full city graph of
around 50,000 nodes would still take seconds. The data pipeline (OSM, OSRM) is already automated,
and the same code works for any city once the OSM data is pulled.

**Q: Real-time?**
The engine is fast enough for real time. Today events come in by hand. The next step is reading
news feeds, sensor alerts and traffic APIs automatically.

**Q: Why does a smaller group sometimes rank above a bigger one?**
On purpose. Reach is on a log scale and vulnerability is multiplied in, so 130 ER patients or a
62% low-income colony can outrank 100,000 inconvenienced commuters.

**Q: What about false alarms?**
Each alert shows how many people, how soon and why. Responders can reject it, which lowers that
category's weight for next time. Hidden dependencies are labelled "unverified".

**Q: Who would use it?**
District disaster-management control rooms, hospitals and 108 ambulance services, school transport,
pharma distributors, NGOs and city planners. It could also be used before monsoon season to find
fragile bridges (run the scenario and see the damage).

**Q: Privacy?**
It uses only aggregate area-level data (population, % elderly), no personal data. The AI runs
locally, so nothing leaves the machine.

**Q: Cost?**
Free and open source throughout: OSM, OSRM, NetworkX, FastAPI, Leaflet, and a local LLM with no
API fees. It runs on a normal laptop.

**Q: What happens if a place is completely cut off?**
The engine detects that no path exists. The alert says "cut off", and the action switches to
airlift, NDRF boat or a mobile pharmacy van.

**Q: What would you build next?**
Read the slide 10 roadmap: (1) city pilot with live data and one disaster cell, (2) full street
network, GTFS buses, census data, (3) probabilistic simulation (confidence % per alert), automatic
news and sensor ingestion, ML severity model trained on feedback, (4) a plug-in early-warning
service for agencies, hospitals and NGOs.

**Q: What did you build during the hackathon vs. before?**
Answer truthfully for your team.

## 9. Honest limitations (say them before a judge finds them)
- The road network is curated (36 segments), not the full street map.
- Populations and capacities are estimates.
- Rules are deterministic: there are no probabilities or agent-based simulation yet.
- The severity weights are hand-set, not a trained model.
- Events are entered by hand; there's no live news or sensor feed yet.
- Feedback is stored in a JSON file; production would use PostgreSQL + PostGIS.
- The frontend is plain JS, not React (it looks the same; React was the planned production stack).


## 10. New: live news, officials, public, drills (answers)
**Q: Does it find disasters by itself?** Yes. It scans trusted news every 15 minutes (Google News RSS covering
The Tribune, HT, Indian Express, PIB, …), extracts the type and place, and queues a report for officials.

**Q: How do you stop fake news?** Five layers: source reliability tiers; 2+ independent trusted sources for
"High trust"; filters for not-live and outside-the-tricity stories; a local-AI check; and mandatory official
verification before anything is public. A viral social post scores "Low: treat as rumour".

**Q: Why not Twitter/X?** Its API is paid and rate-limited. Official handles are on the roadmap. News outlets and
government releases are more reliable for verification anyway.

**Q: How does it get more accurate?** Officials file an after-action report with real casualties and tick which
predictions came true. Ripple re-weights itself, stores the record as training data (exportable JSON), and
the incident becomes a training drill.

**Q: How do drills work?** A past disaster is replayed hour by hour in the order Ripple's cascade predicts. The
trainee picks the best first action from three options against a timer, then sees the debrief, what actually
happened, and a leaderboard. Drills are role-specific: Disaster Management, Police & traffic, Health.

**Q: Are the historical drills accurate?** The event descriptions come from public reports (Feb 2022 Chandigarh
power-strike blackout, July 2023 floods). The numbers inside a drill are Ripple's simulation, and each drill
says so. Drills built from after-action reports use the real outcomes officials entered.
