"""Automatic news monitoring: find disruptions in the tricity from trusted sources, then verify them.

Pipeline
  1. Fetch    Google News RSS searches for tricity + disaster terms (covers The Tribune, HT,
              Indian Express, PIB, ...). Social media (X/Facebook) needs paid APIs: roadmap.
  2. Filter   Drop stories that aren't live disruptions (court cases, budgets, anniversaries),
              and stories with no tricity place we can pin on the map.
  3. Extract  Event type from keywords; location from a gazetteer of tricity places/roads.
  4. Cluster  Same type + same place + same day -> one report with all its sources.
  5. Verify   Trusted-source tier, independent corroboration, recency, location, local-AI check
              -> a confidence score. Nothing reaches the public until an official verifies it.
"""
import email.utils
import hashlib
import json
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

import city
import engine
import llm
import store

# Source reliability. Names as Google News reports them in <source>.
SOURCES = {
    "Press Information Bureau": ("Official", 1.0), "PIB": ("Official", 1.0),
    "NDMA": ("Official", 1.0), "India Meteorological Department": ("Official", 1.0),
    "Chandigarh Administration": ("Official", 1.0), "Chandigarh Police": ("Official", 1.0),
    "Punjab Police": ("Official", 0.95), "Haryana Police": ("Official", 0.95),
    "The Tribune": ("Established media", 0.85), "Hindustan Times": ("Established media", 0.85),
    "The Indian Express": ("Established media", 0.85), "The Times of India": ("Established media", 0.8),
    "The Hindu": ("Established media", 0.85), "NDTV": ("Established media", 0.8),
    "Press Trust of India": ("Wire agency", 0.9), "PTI": ("Wire agency", 0.9), "ANI News": ("Wire agency", 0.8),
    "India Today": ("Established media", 0.75), "Dainik Bhaskar": ("Established media", 0.7),
    "Amar Ujala": ("Established media", 0.7), "Dainik Jagran": ("Established media", 0.7),
    # Simulated sources used only by the clearly-labelled demo feed (data/sample_news.json)
    "Simulated Wire (demo)": ("Simulated trusted outlet", 0.85),
    "Simulated Daily (demo)": ("Simulated trusted outlet", 0.85),
    "Simulated Social Post (demo)": ("Simulated unvetted social media", 0.3),
}
TRUSTED = 0.7
UNKNOWN_SOURCE = ("Unknown / unvetted", 0.3)

QUERIES = [
    "(Chandigarh OR Mohali OR Panchkula OR Zirakpur OR Kharar) (flood OR waterlogging OR inundated OR \"heavy rain\")",
    "(Chandigarh OR Mohali OR Panchkula OR Zirakpur OR Kharar) (\"power cut\" OR outage OR blackout OR \"power supply\")",
    "(Chandigarh OR Mohali OR Panchkula OR Zirakpur OR Kharar) (accident OR \"road blocked\" OR \"traffic diverted\" OR collapse OR \"tree fell\")",
    "(Chandigarh OR Mohali OR Panchkula OR Zirakpur OR Kharar) (dengue OR cholera OR diarrhoea OR outbreak)",
    "(Chandigarh OR Mohali OR Panchkula OR Zirakpur OR Kharar) (factory OR industrial) (shut OR closure OR strike OR sealed)",
]

TYPE_RULES = [  # order matters: first match wins
    ("bridge_collapse", r"\bbridge\b.*\b(collaps|cave[sd]? in|caved|washed away|damaged|crack|sink)|\b(collaps|caved|washed away)\w*\b.*\bbridge\b"),
    ("flood", r"flood|waterlog|inundat|submerg|cloudburst|heavy rain|overflow|choe in spate|ghaggar"),
    ("power_outage", r"power cut|outage|blackout|without (power|electricity)|power supply|electricity supply|power poles?|transformer|tripping"),
    ("disease_outbreak", r"dengue|cholera|diarrh|jaundice|hepatitis|outbreak|malaria|gastro|typhoid"),
    ("factory_shutdown", r"(factory|industrial unit|plant|industries)\b.*\b(shut|clos|sealed|strike|lockout)"),
    ("road_block", r"accident|crash|collid|road blocked|traffic (jam|diverted|disrupted)|diversion|tree (fell|falls|uproot|collaps|topple)|tree collapses|landslide|cave-?in|protest|dharna|blockade|pile-?up"),
]
NOT_LIVE = re.compile(r"payout|compensation|\bhc\b|high court|court|verdict|bail|custody|anniversary|approval|approved|"
                      r"\bplan\b|project|crore|tender|budget|meeting|review|mock drill|years? (ago|after)|awareness|campaign|"
                      r"cover for|insurance|probe ordered|sentenced|convicted|chargesheet")
OUTSIDE = re.compile(r"himachal|shimla|manali|kullu|nuh|gurugram|gurgaon|hisar|rohtak|ludhiana|amritsar|jalandhar|"
                     r"patiala city|bathinda|delhi|karnal|ambala city|jammu|kashmir|uttarakhand|rajasthan|kerala")

# Gazetteer: phrase -> ("edge", edge_id) | ("junction", junction_id). Most specific first.
GAZETTEER = [
    ("sukhna choe", ("edge", "hb|panchkula")), ("patiala ki rao", ("edge", "kharar|mohali7")),
    ("patiala-ki-rao", ("edge", "kharar|mohali7")), ("tribune chowk", ("edge", "transport|tribune")),
    ("zirakpur flyover", ("edge", "ramdarbar|zirakpur")), ("madhya marg", ("edge", "sec10|sec7")),
    ("dakshin marg", ("edge", "sec17|tribune")), ("airport road", ("edge", "fortis|airport")),
    ("housing board", ("junction", "hb")), ("transport chowk", ("junction", "transport")),
    ("pgi", ("junction", "pgi")), ("pgimer", ("junction", "pgi")), ("gmch", ("junction", "sec32")),
    ("it park", ("junction", "itpark")), ("manimajra", ("junction", "manimajra")), ("mani majra", ("junction", "manimajra")),
    ("ram darbar", ("junction", "ramdarbar")), ("industrial area", ("junction", "industrial")),
    ("burail", ("junction", "sec35")), ("dhanas", ("junction", "dhanas")), ("isbt", ("junction", "isbt43")),
    ("dhakoli", ("junction", "zirakpur")), ("zirakpur", ("junction", "zirakpur")), ("baltana", ("junction", "zirakpur")),
    ("kharar", ("junction", "kharar")), ("landran", ("junction", "landran")), ("gharuan", ("junction", "cu")),
    ("chandigarh university", ("junction", "cu")), ("fortis", ("junction", "fortis")),
    ("panchkula", ("junction", "panchkula")), ("mohali", ("junction", "mohali7")), ("chandigarh", ("junction", "sec17")),
]
SECTOR_RANGES = [(1, 12, "sec10"), (13, 16, "sec16"), (17, 19, "sec17"), (20, 24, "sec22"), (25, 30, "transport"),
                 (31, 33, "sec32"), (34, 38, "sec35"), (39, 46, "isbt43"), (47, 56, "sec47")]
DEFAULT_DURATION = {"road_block": 6, "bridge_collapse": 72, "flood": 24, "power_outage": 8,
                    "factory_shutdown": 72, "disease_outbreak": 168}

UA = {"User-Agent": "Mozilla/5.0 (Ripple hackathon prototype)"}
_scan_lock = threading.Lock()
STATE = {"last_scan": None, "last_error": None, "scanning": False, "fetched": 0, "kept": 0}


# ------------------------------------------------------------------ fetch
def fetch_live():
    items = []
    for q in QUERIES:
        url = ("https://news.google.com/rss/search?hl=en-IN&gl=IN&ceid=IN:en&q="
               + urllib.parse.quote(q + " when:2d"))
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            root = ET.fromstring(r.read())
        for it in root.findall(".//item"):
            src = it.findtext("source") or "Unknown"
            title = re.sub(rf"\s+-\s+{re.escape(src)}$", "", it.findtext("title") or "").strip()
            try:
                ts = email.utils.parsedate_to_datetime(it.findtext("pubDate")).timestamp()
            except Exception:
                ts = time.time()
            items.append({"title": title, "link": it.findtext("link"), "source": src, "ts": ts, "sample": False})
    seen, out = set(), []
    for i in items:  # the same story shows up under several queries
        k = i["title"].lower()
        if k not in seen:
            seen.add(k); out.append(i)
    return out


def fetch_samples():
    """Clearly-labelled SIMULATED reports, so the workflow can be demoed on a day with no real disaster."""
    base = time.time()
    raw = store.load("sample_news", default=[])
    return [{**s, "ts": base - s.get("age_h", 1) * 3600, "sample": True} for s in raw]


# ---------------------------------------------------------------- extract
def _locate(text):
    for phrase, loc in GAZETTEER:
        if phrase in text:
            if loc[1] in ("sec17",):  # bare "Chandigarh": try for a sector number first
                break
            return loc, phrase
    m = re.search(r"sector[- ]?(\d{1,2})", text)
    if m:
        n = int(m.group(1))
        if "panchkula" in text:
            return ("junction", "panchkula"), f"sector {n}, panchkula"
        if "mohali" in text:
            return ("junction", "mohali7"), f"sector {n}, mohali"
        for lo, hi, jid in SECTOR_RANGES:
            if lo <= n <= hi:
                return ("junction", jid), f"sector {n}"
    if "chandigarh" in text:
        return ("junction", "sec17"), "chandigarh"
    return None, None


def extract(item):
    text = item["title"].lower()
    etype = next((t for t, rx in TYPE_RULES if re.search(rx, text)), None)
    if not etype:
        return None, "no disruption keywords"
    if NOT_LIVE.search(text):
        return None, "not a live event (court, budget, plan, ...)"
    loc, phrase = _locate(text)
    if not loc:
        return None, "no tricity location"
    if OUTSIDE.search(text) and phrase in ("chandigarh",):
        return None, "outside the tricity"
    return {"type": etype, "loc": loc, "place": phrase}, None


def _junction_of(loc):
    return loc[1].split("|")[0] if loc[0] == "edge" else loc[1]


def suggest_event(etype, loc, text):
    """Turn a located news report into an engine event the official can adjust."""
    jid = _junction_of(loc)
    _, lat, lon = city.JUNCTIONS[jid]
    mag = 3
    if re.search(r"killed|dead|deaths|died|several injured|massive|major|severe|record", text):
        mag = 4
    if re.search(r"minor|close shave|no one (was )?(hurt|injured)|partially|briefly", text):
        mag = 2
    ev = {"type": etype, "magnitude": mag, "duration_h": DEFAULT_DURATION[etype], "radius_km": 1.5}
    if etype in ("bridge_collapse", "road_block"):
        if loc[0] == "edge":
            ev["edge"] = loc[1]
        else:  # nearest road segment touching that junction (prefer bridges for bridge news)
            nbrs = sorted(engine.BASE.edges(jid, data=True),
                          key=lambda e: (etype == "bridge_collapse" and e[2]["kind"] != "bridge", e[2]["time"]))
            ev["edge"] = nbrs[0][2]["id"]
    elif etype in ("flood", "power_outage"):
        ev["lat"], ev["lon"] = lat, lon
    elif etype == "factory_shutdown":
        ev["workplace"] = min(city.WORKPLACES, key=lambda w: engine.haversine_km(
            lat, lon, *city.JUNCTIONS[city.WORKPLACES[w]["at"]][1:]))
    elif etype == "disease_outbreak":
        ev["zone"] = min(city.ZONES, key=lambda z: engine.haversine_km(
            lat, lon, *city.JUNCTIONS[city.ZONES[z]["at"]][1:]))
    return ev


# ----------------------------------------------------------------- verify
def verify(rep):
    srcs = rep["sources"]
    weights = [SOURCES.get(s["source"], UNKNOWN_SOURCE)[1] for s in srcs]
    trusted_names = {s["source"] for s, w in zip(srcs, weights) if w >= TRUSTED}
    newest_h = (time.time() - max(s["ts"] for s in srcs)) / 3600
    checks = {
        "trusted_source": max(weights) >= TRUSTED,
        "corroborated": len(trusted_names) >= 2,
        "recent": newest_h <= 24,
        "located": True,
        "ai_check": rep.get("ai", {}).get("ok"),  # None until the local AI has looked at it
    }
    score = (0.35 * max(weights) + 0.25 * min(1, (len(trusted_names) - 1) / 2 if trusted_names else 0)
             + 0.15 * checks["recent"] + 0.15 * checks["located"]
             + 0.10 * (1 if checks["ai_check"] else 0.5 if checks["ai_check"] is None else 0))
    level = "High" if score >= 0.75 else "Medium" if score >= 0.5 else "Low"
    if checks["corroborated"]:
        note = f"Corroborated by {len(trusted_names)} independent trusted sources."
    elif checks["trusted_source"]:
        note = "Single trusted source. Wait for a second source or confirm on the ground."
    else:
        note = "No trusted source. Treat as rumour until confirmed."
    rep["simulated"] = any(s["sample"] for s in srcs)
    if rep["simulated"]:
        note = "SIMULATED DEMO REPORT (not real news). " + note
    rep["verification"] = {"checks": checks, "score": round(score, 2), "level": level, "note": note,
                           "sources": [{"name": n, "tier": SOURCES.get(n, UNKNOWN_SOURCE)[0]}
                                       for n in sorted({s["source"] for s in srcs})]}
    return rep


def ai_check(rep):
    """Ask the local LLM whether the headlines describe a live disruption in the tricity."""
    heads = "\n".join(f"- {s['title']} ({s['source']})" for s in rep["sources"][:6])
    schema = {"type": "object", "properties": {"live_disruption_in_tricity": {"type": "boolean"},
              "confidence": {"type": "number"}, "reason": {"type": "string"}},
              "required": ["live_disruption_in_tricity", "confidence", "reason"]}
    prompt = ("Do these headlines describe a CURRENT disruption (flood, accident, outage, outbreak, closure) "
              "inside the Chandigarh tricity (Chandigarh, Mohali, Panchkula, Zirakpur, Kharar) that affects the "
              f"public? Answer in JSON.\n{heads}")
    try:
        r = llm._post(f"{llm.OLLAMA_URL}/api/chat", {
            "model": llm.OLLAMA_MODEL, "stream": False, "format": schema, "keep_alive": "60m",
            "options": {"temperature": 0}, "messages": [{"role": "user", "content": prompt}]}, timeout=40)
        d = json.loads(r["message"]["content"])
        return {"ok": bool(d["live_disruption_in_tricity"]) and float(d.get("confidence", 0)) >= 0.5,
                "confidence": round(float(d.get("confidence", 0)), 2), "reason": str(d.get("reason", ""))[:200]}
    except Exception as e:
        return {"ok": None, "reason": f"AI check unavailable ({type(e).__name__})"}


# ------------------------------------------------------------------- scan
def scan(include_samples=False, run_ai=True):
    if not _scan_lock.acquire(blocking=False):
        return STATE
    STATE["scanning"] = True
    try:
        items, STATE["last_error"] = [], None
        try:
            items += fetch_live()
        except Exception as e:
            STATE["last_error"] = f"Live news unreachable ({type(e).__name__})"
        if include_samples:
            items += fetch_samples()
        STATE["fetched"] = len(items)
        clusters, dropped = {}, {}
        for it in items:
            ex, why = extract(it)
            if not ex:
                dropped[why] = dropped.get(why, 0) + 1
                continue
            day = time.strftime("%Y-%m-%d", time.localtime(it["ts"]))
            key = f"{ex['type']}|{ex['loc'][1]}|{day}|{int(it['sample'])}"
            c = clusters.setdefault(key, {"type": ex["type"], "loc": ex["loc"], "place": ex["place"], "items": []})
            c["items"].append(it)
        STATE["kept"], STATE["dropped"] = sum(len(c["items"]) for c in clusters.values()), dropped

        def merge(reports):
            for key, c in clusters.items():
                rid = "rep_" + hashlib.sha1(key.encode()).hexdigest()[:10]
                rep = reports.get(rid) or {"id": rid, "status": "pending", "created": time.time()}
                known = {s["title"] for s in rep.get("sources", [])}
                rep["sources"] = rep.get("sources", []) + [
                    {k: i[k] for k in ("title", "link", "source", "ts", "sample")} for i in c["items"] if i["title"] not in known]
                rep["sources"].sort(key=lambda s: -s["ts"])
                rep.update(type=c["type"], place=c["place"], loc=list(c["loc"]),
                           headline=rep["sources"][0]["title"], updated=time.time(),
                           suggested=rep.get("suggested") or suggest_event(c["type"], c["loc"], rep["sources"][0]["title"].lower()))
                reports[rid] = verify(rep)
            return [r for r in reports.values() if r["status"] == "pending" and "ai" not in r]

        todo = store.update("reports", merge)
        if run_ai:
            for rep in todo[:8]:
                res = ai_check(rep)

                def apply(rs, rid=rep["id"], res=res):
                    if rid in rs:
                        rs[rid]["ai"] = res
                        verify(rs[rid])
                store.update("reports", apply)
        STATE["last_scan"] = time.time()
        return STATE
    finally:
        STATE["scanning"] = False
        _scan_lock.release()


def scan_async(include_samples=False):
    threading.Thread(target=scan, kwargs={"include_samples": include_samples}, daemon=True).start()


def auto_scan_forever(every_min=15):
    """Background monitor: re-scan trusted sources every few minutes without anyone asking."""
    while True:
        try:
            scan()
        except Exception as e:
            STATE["last_error"] = f"Auto-scan failed ({type(e).__name__})"
        time.sleep(every_min * 60)
