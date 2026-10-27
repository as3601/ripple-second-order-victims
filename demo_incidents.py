"""Add (or remove) clearly-labelled SIMULATED incidents so the public page has something to show in a demo.

    python demo_incidents.py           # add the demo incidents (replaces any earlier demo ones)
    python demo_incidents.py --remove  # remove them again

They are marked simulated, so the public page shows a SIMULATED badge on each.
"""
import sys
import time

import ops
import store
from models import SCENARIOS, Event, validate_event

MIN, HOUR = 60, 3600
DEMO = [
    # scenario, department, gravity, hours to resolve, started (s ago), public note, later updates [(s ago, note)]
    ("sukhna", "pwd", 4, 48, 50 * MIN,
     "Avoid the Sukhna Choe crossing between Manimajra and Panchkula. Use Madhya Marg instead.",
     [(20 * MIN, "Diversion set up via Madhya Marg. NDRF team on site inspecting the damage.")]),
    ("flood", "flood", 4, 36, 2 * HOUR + 10 * MIN,
     "Avoid Tribune Chowk and Purv Marg. Do not drive or walk through standing water.",
     [(75 * MIN, "Water level rising near Industrial Area Ph-1; two pumps deployed."),
      (15 * MIN, "Rain easing. Pumping continues; expected to take most of tomorrow.")]),
    ("power", "power", 3, 12, 3 * HOUR,
     "Power cut in Sectors 16–17. Traffic signals are off: drive slowly at junctions.",
     [(40 * MIN, "Fault traced to a substation transformer. Replacement on the way.")]),
    ("dengue", "health", 3, 120, 26 * HOUR,
     "Dengue cases rising in Burail. Remove standing water at home and use mosquito nets.",
     [(5 * HOUR, "Fogging drive started in Burail and Sector 45."),
      (2 * HOUR, "Extra fever clinic opened at GMCH-32.")]),
]


def remove():
    gone = []
    store.update("incidents", lambda d: [gone.append(d.pop(k)) for k in [k for k, v in d.items() if v.get("demo")]])
    return len(gone)


def add():
    removed = remove()
    now = time.time()
    scen = {s["id"]: s for s in SCENARIOS}
    for sid, dept_id, gravity, eta_h, ago, note, updates in DEMO:
        s, dept = scen[sid], ops.DEPARTMENTS[dept_id]
        ev = Event(**{k: v for k, v in s.items() if k not in ("id", "label")})
        validate_event(ev)
        start = now - ago
        iid = store.new_id("inc")
        inc = {"id": iid, "report_id": None, "title": s["label"].replace(" — ", ": "),
               "event": ev.model_dump(exclude_none=True), "gravity": gravity, "eta_resolve_h": eta_h,
               "public_note": note, "department": dept_id, "verified_by": dept["name"], "status": "active",
               "created": start, "updated": now - (updates[-1][0] if updates else ago),
               "verification": {"level": "Official", "note": "Simulated demo incident.",
                                "sources": [{"name": "Demo field report (simulated)"}]},
               "simulated": True, "demo": True,
               "history": [{"t": start, "by": dept["name"],
                            "note": f"Verified and published. Gravity {gravity}/5, expected to take {eta_h:g} h to resolve."}]
                          + [{"t": now - t, "by": dept["name"], "note": n} for t, n in updates]}
        store.update("incidents", lambda d: d.__setitem__(iid, inc))
        print("added:", inc["title"])
    if removed:
        print(f"(replaced {removed} earlier demo incident(s))")


if __name__ == "__main__":
    if "--remove" in sys.argv:
        print(f"removed {remove()} demo incident(s)")
    else:
        add()
