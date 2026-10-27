# Ripple — AI for Second-Order Victims

**Code Yudh · Chandigarh University · Track: Smart Cities & Disaster Response**

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

Optional: set `ANTHROPIC_API_KEY` to get a Claude-written control-room briefing and extra
AI-suggested hidden dependencies. Without a key Ripple uses a deterministic template, so the demo
never breaks.

## The five-stage pipeline (as in our proposal)

| Stage | Where | What it does |
|---|---|---|
| 1. Event ingestion | `app.py` (`/api/simulate`), left panel | 7 scripted scenarios, or a custom event: pick a road/bridge on the map, click an epicentre for a flood or outage, or choose a workplace/zone. Magnitude and duration are adjustable. |
| 2. Dependency graph | `city.py`, `engine.build_graph` | NetworkX graph of 26 junctions and 36 road segments (bridges and flyovers included), plus 6 hospitals, 4 ambulance bases, 2 drug depots, 6 schools, 4 workplaces and 11 residential zones with population, elderly %, children %, low-income % and daily-wage %. Every zone depends on emergency care, a school, a workplace and a medicine supply line. |
| 3. Cascade engine | `engine.run_cascade` | Applies the event (cuts or slows edges, adds spill-over congestion on diverted roads, cuts hospital capacity, closes facilities, adds casualty or outbreak surges). Then reruns Dijkstra on the damaged graph and compares each dependency with the baseline. **2nd order:** ambulance response delay, school-bus routes cut, pharmacy restock delayed, commutes broken, cold chain at risk. **3rd order:** patients rerouted to other hospitals overload their ERs, elderly miss chronic medicines after the ~12h stock buffer runs out, low-income children miss mid-day meals, daily-wage income is lost (₹), households become food-insecure. |
| 4. Impact scoring | `engine.score` | Score = severity × reach (log of people affected) × vulnerability (elderly, low-income, children) × urgency (how soon it lands) × feedback calibration. Bands: Critical / High / Medium / Low. |
| 5. Alert dashboard + feedback loop | `static/`, `feedback.py`, `llm.py` | Map (cut, slowed and congested roads; zones coloured by their worst alert; overloaded hospitals enlarged), ranked alerts with suggested actions and alternate routes, a cascade tree, a timeline and hospital load. Responders mark each alert ✓/✗. Per-category precision then re-weights future scores. Claude (optional) writes the briefing and lists hidden dependencies the graph doesn't model. |

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

## API

- `GET  /api/graph`: nodes, edges and facilities
- `GET  /api/scenarios`: the scripted events
- `POST /api/simulate`: event JSON → `{first_order, impacts[], hospital_load, totals, graph_state}`
- `POST /api/brief`: event JSON → plain-language briefing (Claude, or a template fallback)
- `POST /api/feedback`: `{category, happened}` → calibration stats

## Honest limitations / next steps

- City data is hand-curated for the prototype. Coordinates are approximate and populations and
  capacities are illustrative. Next step: rebuild `city.py` automatically from OpenStreetMap
  (OSMnx), GTFS feeds and data.gov.in facility registries, and route with OSRM.
- The rules are deterministic and the thresholds come from domain heuristics. Next step: fit
  severity and ETA from the outcome logs that the feedback loop collects (scikit-learn), and add
  agent-based traffic (Mesa).
- Feedback is stored in a JSON file. Production would use PostgreSQL + PostGIS.

## Team
Keep It Simple: Aditya Sharma (tech lead), Bhavya (research & content), Arnav Baheti (team lead).
