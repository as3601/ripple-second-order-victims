"""Cascade engine: event -> first, second and third-order human consequences."""
import math

import networkx as nx

import city
import feedback

SPEED_KMH = {"road": 32, "bridge": 38, "flyover": 45}
DETOUR = 1.3  # straight-line -> road distance (fallback when no OSRM data)
TRAFFIC_FACTOR = 1.4  # OSRM gives free-flow times; daytime city traffic is slower

# Thresholds (minutes of added travel time) that turn a delay into a consequence
EMS_DELAY_MIN = 4
SCHOOL_DELAY_MIN = 15
SUPPLY_DELAY_MIN = 20
COMMUTE_DELAY_MIN = 20

ER_BEDS_PER_PERSON = 0.00025   # emergency-bed demand generated per resident per day
DAILY_WAGE_INR = 600

SEVERITY = {
    "ems": 1.0, "hospital": 0.92, "cold_chain": 0.88, "medicine": 0.82,
    "residents": 0.75, "income": 0.62, "food": 0.7, "school": 0.5, "meals": 0.6,
}

CATEGORY_LABEL = {
    "ems": "Emergency access", "hospital": "Hospital overload", "cold_chain": "Cold-chain loss",
    "medicine": "Medicine supply", "residents": "Displaced residents", "income": "Livelihoods",
    "food": "Food security", "school": "School transport", "meals": "Mid-day meals",
}


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def edge_id(a, b):
    return "|".join(sorted((a, b)))


def build_graph():
    g = nx.Graph()
    for jid, (name, lat, lon) in city.JUNCTIONS.items():
        g.add_node(jid, name=name, lat=lat, lon=lon)
    for a, b, kind, name in city.ROADS:
        eid = edge_id(a, b)
        osm = city.OSM["edges"].get(eid)
        if osm:  # real OSRM drive time over OSM roads, scaled for typical city traffic
            km, minutes = osm["km"], osm["min"] * TRAFFIC_FACTOR
        else:
            ja, jb = city.JUNCTIONS[a], city.JUNCTIONS[b]
            km = haversine_km(ja[1], ja[2], jb[1], jb[2]) * DETOUR
            minutes = km / SPEED_KMH[kind] * 60
        g.add_edge(a, b, id=eid, kind=kind, name=name, km=round(km, 2), time=minutes,
                   source="OSRM" if osm else "estimate")
    return g


BASE = build_graph()


def graph_payload():
    nodes = [{"id": n, **d} for n, d in BASE.nodes(data=True)]
    edges = [{"a": a, "b": b, **d} for a, b, d in BASE.edges(data=True)]
    facilities = []
    for kind, table in (("hospital", city.HOSPITALS), ("ambulance", city.AMBULANCE_BASES),
                        ("depot", city.DEPOTS), ("workplace", city.WORKPLACES),
                        ("school", city.SCHOOLS), ("zone", city.ZONES)):
        for fid, f in table.items():
            j = city.JUNCTIONS[f["at"]]
            facilities.append({"id": fid, "kind": kind, "lat": j[1], "lon": j[2], **f})
    data = {"junctions_osm": len(city.OSM["junctions"]), "junctions": len(city.JUNCTIONS),
            "edges_osrm": len(city.OSM["edges"]), "edges": len(city.ROADS),
            "fetched": city.OSM.get("fetched")}
    for n in nodes:
        n["osm"] = n["id"] in city.OSM["junctions"]
    return {"nodes": nodes, "edges": edges, "facilities": facilities, "data": data}


# ---------------------------------------------------------------- stage 1: event

def _near(jid, lat, lon, radius):
    j = city.JUNCTIONS[jid]
    return haversine_km(j[1], j[2], lat, lon) <= radius


def _edge_mid_dist(a, b, lat, lon):
    ja, jb = city.JUNCTIONS[a], city.JUNCTIONS[b]
    return haversine_km((ja[1] + jb[1]) / 2, (ja[2] + jb[2]) / 2, lat, lon)


def apply_event(ev):
    """Return the disrupted graph and the first-order effects of the event."""
    g = BASE.copy()
    t = ev["type"]
    mag = ev.get("magnitude", 3)
    lat, lon, radius = ev.get("lat"), ev.get("lon"), ev.get("radius_km", 1.5)
    first, closed, cap_loss, surge = [], set(), {}, {}
    congested = set()
    g.graph["congested"] = congested

    def cut(a, b, why):
        d = g.edges[a, b]
        first.append({"what": f"{d['name']} {why}", "kind": "road", "edge": d["id"]})
        g.remove_edge(a, b)
        # Diverted traffic spills onto the neighbouring segments
        for u in (a, b):
            for v in g.neighbors(u):
                n = g.edges[u, v]
                if n["id"] not in congested:
                    n["time"] *= 1 + 0.35 * mag
                    congested.add(n["id"])

    def slow(a, b, factor, why):
        d = g.edges[a, b]
        d["time"] *= factor
        first.append({"what": f"{d['name']} {why} (x{factor:.1f} travel time)", "kind": "road",
                      "edge": d["id"], "partial": True})

    if t in ("bridge_collapse", "road_block"):
        a, b = ev["edge"].split("|")
        if t == "road_block" and mag < 3:
            slow(a, b, 1 + mag, "partially blocked")
        else:
            cut(a, b, "collapsed" if t == "bridge_collapse" else "fully blocked")
        if t == "bridge_collapse":
            ja, jb = city.JUNCTIONS[a], city.JUNCTIONS[b]
            lat, lon = (ja[1] + jb[1]) / 2, (ja[2] + jb[2]) / 2
            surge["casualties"] = {"beds": 6 * mag, "lat": lat, "lon": lon}

    elif t == "flood":
        for a, b in list(g.edges):
            d = _edge_mid_dist(a, b, lat, lon)
            if d <= radius * 0.6:
                cut(a, b, "submerged")
            elif d <= radius:
                slow(a, b, 1 + mag * 0.5, "waterlogged")
        for hid, h in city.HOSPITALS.items():
            if _near(h["at"], lat, lon, radius):
                cap_loss[hid] = 0.4
                first.append({"what": f"{h['name']} ground floor flooded (-40% ER capacity)",
                              "kind": "hospital"})
        for zid, z in city.ZONES.items():
            if _near(z["at"], lat, lon, radius):
                first.append({"what": f"{z['name']} inundated", "kind": "zone", "zone": zid})
        surge["casualties"] = {"beds": 4 * mag, "lat": lat, "lon": lon}

    elif t == "power_outage":
        for a, b in list(g.edges):
            if _edge_mid_dist(a, b, lat, lon) <= radius:
                slow(a, b, 1.6, "signals dark")
        for hid, h in city.HOSPITALS.items():
            if _near(h["at"], lat, lon, radius) and ev.get("duration_h", 6) > 8:
                cap_loss[hid] = 0.3
                first.append({"what": f"{h['name']} on diesel backup; runs out after ~8h",
                              "kind": "hospital"})
        for wid, w in city.WORKPLACES.items():
            if _near(w["at"], lat, lon, radius):
                closed.add(wid)
                first.append({"what": f"{w['name']} shut (no power)", "kind": "workplace"})

    elif t == "factory_shutdown":
        wid = ev["workplace"]
        closed.add(wid)
        first.append({"what": f"{city.WORKPLACES[wid]['name']} shut down", "kind": "workplace"})

    elif t == "disease_outbreak":
        z = city.ZONES[ev["zone"]]
        beds = round(z["pop"] * 0.0004 * mag)
        surge["outbreak"] = {"beds": beds, "zone": ev["zone"]}
        first.append({"what": f"Outbreak cluster in {z['name']} (~{beds} ER cases/day)",
                      "kind": "zone", "zone": ev["zone"]})
        for sid, s in city.SCHOOLS.items():
            if s["at"] == z["at"]:
                closed.add(sid)

    return g, first, closed, cap_loss, surge


# ------------------------------------------------------------ stage 3: cascade

def _dist(g, src):
    return nx.single_source_dijkstra_path_length(g, src, weight="time")


def _route_names(g, a, b):
    try:
        path = nx.dijkstra_path(g, a, b, weight="time")
    except nx.NetworkXNoPath:
        return []
    names = []
    for u, v in zip(path, path[1:]):
        n = g.edges[u, v]["name"]
        if n not in names:
            names.append(n)
    return names[:4]


def _ems(g, zone_at):
    """Ambulance response + transport time to nearest hospital. Returns (minutes, hospital)."""
    d = _dist(g, zone_at)
    resp = min((d[b["at"]] for b in city.AMBULANCE_BASES.values() if b["at"] in d), default=None)
    best = None
    for hid, h in city.HOSPITALS.items():
        if h["at"] in d and (best is None or d[h["at"]] < best[1]):
            best = (hid, d[h["at"]])
    if resp is None or best is None:
        return None, None
    return resp + best[1], best[0]


def _travel(g, a, b):
    try:
        return nx.dijkstra_path_length(g, a, b, weight="time")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None


def _vulnerability(z):
    return round(min(1.0, z["elderly"] * 2 + z["low_income"] * 0.6 + z["children"] * 0.4), 2)


def _impact(order, cat, title, people, eta_h, vuln, detail, action, zone=None, parent=None,
            facility=None, facts=None):
    """`facts` keeps raw values (delay, alternate hospital/route...) for the plain-language public view."""
    return {"order": order, "category": cat, "label": CATEGORY_LABEL[cat], "title": title,
            "people": int(people), "eta_h": round(eta_h, 1), "vulnerability": vuln,
            "detail": detail, "action": action, "zone": zone, "parent": parent,
            "facility": facility, "facts": facts or {}}


def _delay(base, new):
    if base is None:
        return 0
    return float("inf") if new is None else new - base


def _fmt_delay(d):
    return "cut off" if d == float("inf") else f"+{d:.0f} min"


def run_cascade(ev):
    g, first, closed, cap_loss, surge = apply_event(ev)
    dur = ev.get("duration_h", 24)
    days = max(1, math.ceil(dur / 24))
    impacts = []
    hosp_extra = {hid: 0.0 for hid in city.HOSPITALS}
    hosp_sources = {hid: [] for hid in city.HOSPITALS}

    for zid, z in city.ZONES.items():
        zn, at, vuln = z["name"], z["at"], _vulnerability(z)
        ems_base, h_base = _ems(BASE, at)
        ems_new, h_new = _ems(g, at)

        # Direct first-order residents in flood zone
        for f in first:
            if f.get("zone") == zid and ev["type"] == "flood":
                impacts.append(_impact(1, "residents", f"{zn}: residents displaced / stranded",
                               z["pop"] * 0.15 * ev.get("magnitude", 3) / 3, 0.5, vuln,
                               "Homes and ground floors in the inundation radius.",
                               f"Open relief camp near {zn}; prioritise elderly & disabled evacuation.",
                               zone=zid))

        # 2nd order: emergency access
        d = _delay(ems_base, ems_new)
        if d >= EMS_DELAY_MIN:
            patients = z["pop"] * 0.0006 * max(dur, 6) / 24
            alt = _route_names(g, at, city.HOSPITALS[h_new]["at"]) if h_new else []
            impacts.append(_impact(
                2, "ems", f"{zn}: ambulance response {_fmt_delay(d)}", patients, 0.3, vuln,
                f"Emergency trip now {'impossible by road' if h_new is None else f'{ems_new:.0f} min (was {ems_base:.0f})'}; "
                f"{z['elderly'] * 100:.0f}% elderly residents.",
                (f"Pre-position an ambulance inside {zn}; route to {city.HOSPITALS[h_new]['name']} via "
                 + " → ".join(alt)) if h_new else f"Airlift / NDRF boat standby for {zn}; set up field triage.",
                zone=zid, facts={"minutes": None if d == float("inf") else round(d), "hospital": city.HOSPITALS[h_new]["name"] if h_new else None,
                                 "route": alt}))

        # Patients reassigned to a different hospital feed 3rd-order overload
        if h_new and h_base and h_new != h_base:
            beds = z["pop"] * ER_BEDS_PER_PERSON
            hosp_extra[h_new] += beds
            hosp_sources[h_new].append(zn)

        # 2nd order: school transport
        s = city.SCHOOLS[z["school"]]
        sd = 0 if z["school"] in closed else _delay(_travel(BASE, at, s["at"]), _travel(g, at, s["at"]))
        if z["school"] in closed or sd >= SCHOOL_DELAY_MIN:
            students = z["pop"] * z["children"] * 0.35
            why = "school closed" if z["school"] in closed else f"bus route {_fmt_delay(sd)}"
            impacts.append(_impact(
                2, "school", f"{zn}: students cut off from {s['name']} ({why})", students, 2, vuln,
                "School-bus path depends on the disrupted corridor.",
                f"Notify {s['name']}; switch to online classes or alternate bus via "
                + (" → ".join(_route_names(g, at, s["at"])) or "nearest open school") + ".",
                zone=zid, facts={"school": s["name"], "closed": z["school"] in closed,
                                 "minutes": None if z["school"] in closed else None if sd == float("inf") else round(sd),
                                 "route": [] if z["school"] in closed else _route_names(g, at, s["at"])}))
            if dur >= 24 and z["low_income"] > 0.25:
                impacts.append(_impact(
                    3, "meals", f"{zn}: low-income children miss mid-day meals", students * z["low_income"],
                    26, vuln, f"PM-POSHAN meal is the main meal for many of these {students * z['low_income']:.0f} children.",
                    "Run take-home ration distribution through anganwadi centres.", zone=zid,
                    parent="school", facts={"school": s["name"]}))

        # 2nd order: medicine supply to neighbourhood pharmacies
        dep = city.DEPOTS[z["depot"]]
        md = _delay(_travel(BASE, dep["at"], at), _travel(g, dep["at"], at))
        if md >= SUPPLY_DELAY_MIN:
            chronic = z["pop"] * z["elderly"] * 0.55
            other = [k for k in city.DEPOTS if k != z["depot"]][0]
            alt_ok = _travel(g, city.DEPOTS[other]["at"], at) is not None
            impacts.append(_impact(
                2, "medicine", f"{zn}: pharmacy restock delayed ({_fmt_delay(md)})", chronic, 6, vuln,
                f"Pharmacies hold ~12h of insulin & critical meds; supplied from {dep['name']}.",
                (f"Re-source from {city.DEPOTS[other]['name']} via " + " → ".join(_route_names(g, city.DEPOTS[other]["at"], at)))
                if alt_ok else f"Dispatch mobile pharmacy van / drone drop to {zn}.",
                zone=zid, facts={"minutes": None if md == float("inf") else round(md)}))
            if dur > 12:
                impacts.append(_impact(
                    3, "medicine", f"{zn}: elderly miss chronic medicines (BP, diabetes, insulin)",
                    chronic, 12, min(1.0, vuln + 0.2),
                    "Stock buffer runs out ~12h after supply line breaks.",
                    f"Door-step delivery via ASHA workers; list of {chronic:.0f} high-risk elderly from PHC registry.",
                    zone=zid, parent="medicine"))

        # Power outage: cold chain at local pharmacies / PHCs
        if ev["type"] == "power_outage" and _near(at, ev["lat"], ev["lon"], ev.get("radius_km", 1.5)) and dur > 4:
            impacts.append(_impact(
                2, "cold_chain", f"{zn}: vaccine & insulin cold-chain at risk", z["pop"] * 0.02, 4, vuln,
                "Pharmacy / PHC refrigerators without backup lose safe temperature in ~4h.",
                f"Move vaccines to ice-lined refrigerators at nearest powered PHC; send DG set to {zn} PHC.",
                zone=zid))

        # 2nd order: commute / livelihoods
        w = city.WORKPLACES[z["work"]]
        wd = _delay(_travel(BASE, at, w["at"]), _travel(g, at, w["at"]))
        workers = z["pop"] * z["workers"]
        wage_workers = workers * z["daily_wage"]
        if z["work"] in closed:
            impacts.append(_impact(
                2, "income", f"{zn}: {wage_workers:.0f} daily-wage workers lose work at {w['name']}",
                wage_workers, 10, vuln,
                f"Estimated wage loss ₹{wage_workers * DAILY_WAGE_INR * days / 1e5:.1f} lakh over {days} day(s).",
                "Register affected workers with Labour Dept; trigger emergency wage support / MGNREGA-style work.",
                zone=zid, facts={"workplace": w["name"], "closed": True}))
            if dur >= 72:
                impacts.append(_impact(
                    3, "food", f"{zn}: households slip into food insecurity", wage_workers * 3.5, 72,
                    min(1.0, vuln + 0.15), "No savings buffer beyond ~3 days for daily-wage households.",
                    "Activate PDS / community kitchen with NGOs in this zone.", zone=zid, parent="income"))
        elif wd >= COMMUTE_DELAY_MIN:
            impacts.append(_impact(
                2, "income", f"{zn}: commute to {w['name']} {_fmt_delay(wd)}", workers, 10, vuln,
                f"{wage_workers:.0f} of these are daily-wage workers with no paid leave.",
                f"Run shuttle buses via " + (" → ".join(_route_names(g, at, w["at"])) or "alternate route")
                + "; ask employers not to dock wages.", zone=zid,
                facts={"workplace": w["name"], "minutes": None if wd == float("inf") else round(wd), "route": _route_names(g, at, w["at"])}))
            if wd == float("inf") or dur >= 12:
                impacts.append(_impact(
                    3, "income", f"{zn}: daily-wage income lost", wage_workers, 14, vuln,
                    f"≈ ₹{wage_workers * DAILY_WAGE_INR * days / 1e5:.1f} lakh lost over {days} day(s).",
                    "Pre-register for relief payout; coordinate with contractors for attendance waiver.",
                    zone=zid, parent="income"))

    # Event-driven hospital surges
    if "casualties" in surge:
        c = surge["casualties"]
        near = min(city.HOSPITALS, key=lambda h: haversine_km(c["lat"], c["lon"],
                   city.JUNCTIONS[city.HOSPITALS[h]["at"]][1], city.JUNCTIONS[city.HOSPITALS[h]["at"]][2]))
        hosp_extra[near] += c["beds"]
        hosp_sources[near].append("event casualties")
    if "outbreak" in surge:
        o = surge["outbreak"]
        _, h = _ems(g, city.ZONES[o["zone"]]["at"])
        if h:
            hosp_extra[h] += o["beds"]
            hosp_sources[h].append("outbreak cases")

    # 3rd order: hospital overload
    load_out = []
    for hid, h in city.HOSPITALS.items():
        cap = h["er_beds"] * (1 - cap_loss.get(hid, 0))
        occ = h["er_beds"] * h["baseline_load"] + hosp_extra[hid]
        ratio = occ / cap
        load_out.append({"id": hid, "name": h["name"], "ratio": round(ratio, 2),
                         "extra": round(hosp_extra[hid], 1), "sources": hosp_sources[hid]})
        if ratio >= 0.95:
            others = sorted((x for x in city.HOSPITALS if x != hid),
                            key=lambda x: (city.HOSPITALS[x]["baseline_load"]
                                           + hosp_extra[x] / city.HOSPITALS[x]["er_beds"]))
            impacts.append(_impact(
                3, "hospital", f"{h['name']} ER over capacity ({ratio * 100:.0f}%)",
                occ, max(1.5, 6 - hosp_extra[hid] / 5), 0.8,
                f"Extra load from: {', '.join(hosp_sources[hid]) or 'capacity loss'}. "
                f"{occ:.0f} patients for {cap:.0f} usable beds.",
                f"Alert {h['name']} now: open surge beds, call in off-duty staff; divert stable cases to "
                f"{city.HOSPITALS[others[0]]['name']}.", facility=hid, parent="ems",
                facts={"hospital": h["name"], "alternative": city.HOSPITALS[others[0]]["name"]}))

    hidden = hidden_dependencies(ev)
    ranked = score(impacts)
    return {
        "event": ev,
        "first_order": first,
        "impacts": ranked,
        "hospital_load": load_out,
        "hidden_links": hidden,
        "totals": {
            "people": sum(i["people"] for i in ranked),
            "critical": sum(1 for i in ranked if i["priority"] == "Critical"),
            "zones": len({i["zone"] for i in ranked if i["zone"]}),
            "first_eta_h": min((i["eta_h"] for i in ranked), default=None),
        },
        "graph_state": {"removed": [f["edge"] for f in first if f.get("edge") and not f.get("partial")],
                        "slowed": [f["edge"] for f in first if f.get("edge") and f.get("partial")],
                        "congested": sorted(g.graph["congested"])},
    }


# -------------------------------------------------------------- stage 4: score

def score(impacts):
    calib = feedback.calibration()
    for i in impacts:
        reach = min(1.0, math.log10(i["people"] + 1) / 5)
        urgency = 1 / math.sqrt(1 + i["eta_h"] / 12)
        s = 100 * SEVERITY[i["category"]] * (0.35 + 0.65 * reach) * (0.7 + 0.5 * i["vulnerability"]) * urgency
        s *= calib.get(i["category"], 1.0)
        i["score"] = round(min(100, s), 1)
        i["priority"] = ("Critical" if s >= 55 else "High" if s >= 40 else "Medium" if s >= 25 else "Low")
    return sorted(impacts, key=lambda i: -i["score"])


# ------------------------------------------------- hidden-dependency heuristics

HIDDEN = {
    "bridge_collapse": [
        "Milk & vegetable trucks to the local mandi use this crossing before 5 AM",
        "Blood-bank transfers between hospitals on either side of the bridge",
        "Dialysis patients with fixed-slot sessions across the river",
        "Exam-day students and job-interview candidates on the far bank",
    ],
    "flood": [
        "Sewage overflow raises diarrhoea / leptospirosis risk 3-7 days later",
        "Ration shops' stock on ground floors spoils",
        "Mobile towers on battery backup die after ~6h, cutting 112 calls",
        "Street vendors lose both stock and the day's income",
    ],
    "road_block": [
        "Gas-cylinder delivery rounds for the area skip a day",
        "Garbage collection skipped, raising disease risk",
        "Last-mile e-commerce & medicine delivery riders lose shifts",
    ],
    "power_outage": [
        "Home oxygen concentrators for COPD patients stop",
        "Water pumps stop -> high-rise residents lose water supply",
        "Lifts stop: elderly & disabled residents in high-rises are stranded",
        "ATMs and UPI merchants go offline; cash-only economy hits migrants",
    ],
    "factory_shutdown": [
        "Dhabas, tea stalls and auto drivers around the factory lose customers",
        "Rent defaults in worker colonies within a month",
        "Children pulled out of school to work",
    ],
    "disease_outbreak": [
        "Health workers fall sick, reducing staff in nearby PHCs",
        "Domestic workers barred from housing societies lose income",
        "Routine immunisation sessions get postponed",
    ],
}


def hidden_dependencies(ev):
    return [{"text": t, "source": "heuristic"} for t in HIDDEN.get(ev["type"], [])]
