"""Operations API: news reports -> official verification -> public alerts -> after-action -> training & drills.

Flow
  1. news.py finds candidate reports (or an official files a field report)       status: pending
  2. A department official verifies it, sets gravity + time-to-resolve, publishes  -> incident (active)
  3. The public page shows only published incidents and their cascades
  4. When resolved, the official files an after-action report (casualties, which predictions came true)
     -> re-weights the model (feedback.py), becomes training data, and becomes a drill case.
"""
import os
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

import engine
import feedback
import news
import store
from models import SCENARIOS, Event, validate_event

router = APIRouter()
OFFICIAL_CODE = os.environ.get("RIPPLE_OFFICIAL_CODE", "ripple2026")  # demo access code; change for real use

DEPARTMENTS = {
    "dm": {"name": "District Disaster Management Cell", "types": "all"},
    "pwd": {"name": "Roads & Bridges (PWD)", "types": ["bridge_collapse", "road_block"]},
    "traffic": {"name": "Traffic Police", "types": ["road_block", "bridge_collapse", "flood"]},
    "flood": {"name": "Flood Control & Municipal Corporation", "types": ["flood"]},
    "power": {"name": "Electricity Department", "types": ["power_outage"]},
    "health": {"name": "Health Department", "types": ["disease_outbreak", "flood"]},
    "industry": {"name": "Industries & Labour Department", "types": ["factory_shutdown"]},
}
FIELD_SOURCE = "Field report (verified official)"
news.SOURCES[FIELD_SOURCE] = ("Official", 1.0)


def official(x_official_code: Optional[str] = Header(None)):
    if x_official_code != OFFICIAL_CODE:
        raise HTTPException(401, "Official access code required")


def _dept(did):
    if did not in DEPARTMENTS:
        raise HTTPException(400, "Unknown department")
    return DEPARTMENTS[did]


def _handles(did, etype):
    t = _dept(did)["types"]
    return t == "all" or etype in t


def incident_event(inc):
    """The official's gravity and time-to-resolve drive the cascade."""
    return {**inc["event"], "magnitude": inc["gravity"], "duration_h": inc["eta_resolve_h"], "label": inc["title"]}


# ------------------------------------------------------------- officials
class Login(BaseModel):
    code: str
    department: str


@router.get("/api/departments")
def departments():
    return DEPARTMENTS


@router.post("/api/official/login")
def login(body: Login):
    if body.code != OFFICIAL_CODE:
        raise HTTPException(401, "Wrong access code")
    return {"ok": True, "department": body.department, **_dept(body.department)}


@router.get("/api/reports", dependencies=[Depends(official)])
def list_reports(department: str = "dm"):
    reps = [r for r in store.load("reports").values() if _handles(department, r["type"])]
    order = {"pending": 0, "published": 1, "rejected": 2}
    reps.sort(key=lambda r: (order.get(r["status"], 3), -r["verification"]["score"], -r["updated"]))
    return {"reports": reps, "scanner": news.STATE}


class ScanReq(BaseModel):
    include_samples: bool = False


@router.post("/api/news/scan", dependencies=[Depends(official)])
def scan(req: ScanReq):
    news.scan_async(include_samples=req.include_samples)
    return news.STATE


@router.get("/api/news/status", dependencies=[Depends(official)])
def scan_status():
    return news.STATE


class FieldReport(BaseModel):
    title: str = Field(..., min_length=5, max_length=200)
    event: Event
    department: str


@router.post("/api/reports/manual", dependencies=[Depends(official)])
def field_report(body: FieldReport):
    validate_event(body.event)
    _dept(body.department)
    rid = store.new_id("rep")
    rep = {"id": rid, "status": "pending", "created": time.time(), "updated": time.time(),
           "type": body.event.type, "place": "reported by official", "loc": None,
           "headline": body.title, "suggested": body.event.model_dump(exclude_none=True),
           "ai": {"ok": True, "reason": "Filed directly by a verified official."},
           "sources": [{"title": body.title, "link": None, "source": FIELD_SOURCE, "ts": time.time(), "sample": False}]}
    news.verify(rep)
    store.update("reports", lambda rs: rs.__setitem__(rid, rep))
    return rep


class Reject(BaseModel):
    reason: str = Field(..., max_length=200)
    department: str


@router.post("/api/reports/{rid}/reject", dependencies=[Depends(official)])
def reject(rid: str, body: Reject):
    def fn(rs):
        if rid not in rs:
            raise HTTPException(404, "No such report")
        rs[rid].update(status="rejected", rejected_reason=body.reason,
                       reviewed_by=_dept(body.department)["name"], reviewed_at=time.time())
        return rs[rid]
    return store.update("reports", fn)


class Publish(BaseModel):
    report_id: Optional[str] = None
    title: str = Field(..., min_length=5, max_length=160)
    event: Event
    gravity: int = Field(..., ge=1, le=5)
    eta_resolve_h: float = Field(..., ge=1, le=720)
    public_note: str = Field("", max_length=400)
    department: str


@router.post("/api/incidents", dependencies=[Depends(official)])
def publish(body: Publish):
    validate_event(body.event)
    dept = _dept(body.department)
    reps = store.load("reports")
    rep = reps.get(body.report_id) if body.report_id else None
    iid = store.new_id("inc")
    inc = {"id": iid, "report_id": body.report_id, "title": body.title,
           "event": body.event.model_dump(exclude_none=True), "gravity": body.gravity,
           "eta_resolve_h": body.eta_resolve_h, "public_note": body.public_note,
           "department": body.department, "verified_by": dept["name"], "status": "active",
           "created": time.time(), "updated": time.time(),
           "verification": rep["verification"] if rep else {"level": "Official", "note": "Verified directly by an official."},
           "simulated": bool(rep and rep.get("simulated")),
           "history": [{"t": time.time(), "by": dept["name"],
                        "note": f"Verified and published. Gravity {body.gravity}/5, expected to take {body.eta_resolve_h:g} h to resolve."}]}
    store.update("incidents", lambda d: d.__setitem__(iid, inc))
    if rep:
        def mark(rs):
            rs[body.report_id].update(status="published", incident_id=iid, reviewed_by=dept["name"], reviewed_at=time.time())
        store.update("reports", mark)
    return inc


@router.get("/api/incidents", dependencies=[Depends(official)])
def list_incidents():
    inc = list(store.load("incidents").values())
    inc.sort(key=lambda i: (i["status"] != "active", -i["updated"]))
    return inc


class IncidentUpdate(BaseModel):
    gravity: Optional[int] = Field(None, ge=1, le=5)
    eta_resolve_h: Optional[float] = Field(None, ge=1, le=720)
    public_note: Optional[str] = Field(None, max_length=400)
    note: str = Field("", max_length=300)
    department: str


@router.patch("/api/incidents/{iid}", dependencies=[Depends(official)])
def update_incident(iid: str, body: IncidentUpdate):
    dept = _dept(body.department)

    def fn(d):
        if iid not in d:
            raise HTTPException(404, "No such incident")
        inc, changes = d[iid], []
        if body.gravity is not None and body.gravity != inc["gravity"]:
            changes.append(f"gravity {inc['gravity']}→{body.gravity}"); inc["gravity"] = body.gravity
        if body.eta_resolve_h is not None and body.eta_resolve_h != inc["eta_resolve_h"]:
            changes.append(f"time to resolve {inc['eta_resolve_h']:g}h→{body.eta_resolve_h:g}h"); inc["eta_resolve_h"] = body.eta_resolve_h
        if body.public_note is not None:
            inc["public_note"] = body.public_note
        inc["updated"] = time.time()
        inc["history"].append({"t": time.time(), "by": dept["name"], "note": "; ".join(changes + ([body.note] if body.note else [])) or "Updated"})
        return inc
    return store.update("incidents", fn)


class Prediction(BaseModel):
    title: str
    category: str
    happened: bool


class AfterAction(BaseModel):
    department: str
    deaths: int = Field(0, ge=0)
    injured: int = Field(0, ge=0)
    evacuated: int = Field(0, ge=0)
    people_affected: int = Field(0, ge=0)
    actual_resolution_h: float = Field(..., ge=0, le=2000)
    predicted: List[Prediction] = []
    unexpected: str = Field("", max_length=1000)
    lessons: str = Field("", max_length=1000)
    add_to_drills: bool = True


@router.post("/api/incidents/{iid}/aar", dependencies=[Depends(official)])
def after_action(iid: str, body: AfterAction):
    dept = _dept(body.department)
    incs = store.load("incidents")
    if iid not in incs:
        raise HTTPException(404, "No such incident")
    for p in body.predicted:  # each confirmed/denied prediction re-weights that category
        if p.category in engine.SEVERITY:
            feedback.record(p.category, p.happened)
    aar = {"incident_id": iid, "filed_by": dept["name"], "filed_at": time.time(), **body.model_dump(exclude={"department"})}
    store.update("aars", lambda d: d.__setitem__(iid, aar))

    def close(d):
        inc = d[iid]
        inc.update(status="resolved", resolved_at=time.time(), updated=time.time())
        inc["history"].append({"t": time.time(), "by": dept["name"],
                               "note": f"Resolved. After-action report filed: {body.deaths} deaths, {body.injured} injured, "
                                       f"took {body.actual_resolution_h:g} h."})
        return inc
    return {"incident": store.update("incidents", close), "aar": aar, "calibration": feedback.stats()}


# ----------------------------------------------------------------- public
def _public_view(inc, with_totals=True):
    out = {k: inc.get(k) for k in ("id", "title", "gravity", "eta_resolve_h", "public_note", "verified_by",
                                   "status", "created", "updated", "resolved_at", "simulated")}
    out["type"] = inc["event"]["type"]
    v = inc.get("verification") or {}
    out["verification"] = {"level": v.get("level"), "note": v.get("note"), "sources": v.get("sources", [])}
    out["history"] = [{"t": h["t"], "by": h["by"], "note": h["note"]} for h in inc["history"]]
    if with_totals:
        out["totals"] = engine.run_cascade(incident_event(inc))["totals"]
    return out


@router.get("/api/public/incidents")
def public_incidents():
    incs = sorted(store.load("incidents").values(), key=lambda i: -i["updated"])
    return {"active": [_public_view(i) for i in incs if i["status"] == "active"],
            "resolved": [_public_view(i, with_totals=False) for i in incs if i["status"] == "resolved"][:5]}


@router.get("/api/incidents/{iid}/cascade")
def incident_cascade(iid: str):
    inc = store.load("incidents").get(iid)
    if not inc:
        raise HTTPException(404, "No such incident")
    return {"incident": _public_view(inc, with_totals=False), "cascade": engine.run_cascade(incident_event(inc))}


# --------------------------------------------------------------- training
@router.get("/api/training", dependencies=[Depends(official)])
def training():
    aars = store.load("aars")
    preds = [p for a in aars.values() for p in a["predicted"]]
    hit = sum(p["happened"] for p in preds)
    return {"reports_filed": len(aars), "predictions_checked": len(preds), "predictions_confirmed": hit,
            "precision": round(hit / len(preds), 2) if preds else None,
            "calibration": feedback.stats(), "drill_cases_from_reports": sum(a.get("add_to_drills") for a in aars.values())}


@router.get("/api/training/export", dependencies=[Depends(official)])
def training_export():
    incs, aars = store.load("incidents"), store.load("aars")
    rows = []
    for iid, a in aars.items():
        inc = incs.get(iid)
        if inc:
            rows.append({"incident_id": iid, "title": inc["title"], "event": incident_event(inc),
                         "verification": inc.get("verification", {}).get("level"), "outcome": a})
    return {"format": "ripple-training-v1", "records": rows}


# ----------------------------------------------------------------- drills
def _all_drills():
    cases = [{**c, "kind": "real"} for c in store.load("drill_cases", default=[])]
    incs = store.load("incidents")
    for iid, a in store.load("aars").items():
        inc = incs.get(iid)
        if inc and a.get("add_to_drills"):
            cases.append({"id": f"aar_{iid}", "kind": "after_action", "title": inc["title"],
                          "date": time.strftime("%d %b %Y", time.localtime(inc["created"])),
                          "summary": f"Handled by {inc['verified_by']}. {inc.get('public_note') or ''}".strip(),
                          "what_happened": [h["note"] for h in inc["history"]] + ([f"Unexpected: {a['unexpected']}"] if a["unexpected"] else [])
                                           + ([f"Lessons: {a['lessons']}"] if a["lessons"] else []),
                          "actual": {k: a[k] for k in ("deaths", "injured", "evacuated", "people_affected", "actual_resolution_h")},
                          "source_note": "From an after-action report filed in Ripple." + (" (Simulated demo incident.)" if inc.get("simulated") else ""),
                          "event": incident_event(inc)})
    for s in SCENARIOS:
        ev = {k: v for k, v in s.items() if k not in ("id", "label")}
        cases.append({"id": f"practice_{s['id']}", "kind": "practice", "title": s["label"], "date": None,
                      "summary": "Hypothetical practice scenario modelled by Ripple.", "what_happened": [],
                      "source_note": "Hypothetical: not a real event.", "event": {**ev, "label": s["label"]}})
    return cases


def _board(did, n):
    atts = store.load("drill_attempts").get(did, [])
    return sorted(atts, key=lambda a: (-a["score"], a["avg_response_s"]))[:n], len(atts)


@router.get("/api/drills")
def drills():
    out = []
    for c in _all_drills():
        board, n = _board(c["id"], 3)
        out.append({**c, "leaderboard": board, "attempts": n})
    return out


@router.get("/api/drills/{did}")
def drill(did: str):
    c = next((c for c in _all_drills() if c["id"] == did), None)
    if not c:
        raise HTTPException(404, "No such drill")
    board, n = _board(did, 10)
    return {**c, "leaderboard": board, "attempts": n}


class Attempt(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    role: str = Field(..., max_length=40)
    score: int = Field(..., ge=0)
    max_score: int = Field(..., ge=1)
    correct: int = Field(..., ge=0)
    total: int = Field(..., ge=1)
    avg_response_s: float = Field(..., ge=0)


@router.post("/api/drills/{did}/attempts")
def record_attempt(did: str, body: Attempt):
    if not any(c["id"] == did for c in _all_drills()):
        raise HTTPException(404, "No such drill")
    att = {**body.model_dump(), "t": time.time()}
    store.update("drill_attempts", lambda d: d.setdefault(did, []).append(att))
    board, n = _board(did, 10)
    return {"leaderboard": board, "attempts": n}
