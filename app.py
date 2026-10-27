"""Ripple — AI for Second-Order Victims. FastAPI server: run `python app.py`."""
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import city
import engine
import feedback
import llm

app = FastAPI(title="Ripple — AI for Second-Order Victims")
STATIC = Path(__file__).parent / "static"

SCENARIOS = [
    {"id": "sukhna", "label": "Sukhna Choe Bridge collapse", "type": "bridge_collapse",
     "edge": "hb|panchkula", "magnitude": 4, "duration_h": 48},
    {"id": "patiala", "label": "Patiala-ki-Rao bridge washed away", "type": "bridge_collapse",
     "edge": "kharar|mohali7", "magnitude": 4, "duration_h": 72},
    {"id": "flood", "label": "Monsoon flood — Industrial Area / Tribune Chowk", "type": "flood",
     "lat": 30.7085, "lon": 76.7985, "radius_km": 1.8, "magnitude": 4, "duration_h": 36},
    {"id": "flyover", "label": "Tribune Chowk flyover blocked (accident)", "type": "road_block",
     "edge": "transport|tribune", "magnitude": 4, "duration_h": 6},
    {"id": "power", "label": "Grid failure — Sector 16/17", "type": "power_outage",
     "lat": 30.7440, "lon": 76.7845, "radius_km": 1.6, "magnitude": 3, "duration_h": 12},
    {"id": "factory", "label": "Industrial Area Ph-1 shutdown", "type": "factory_shutdown",
     "workplace": "w_ind", "magnitude": 3, "duration_h": 168},
    {"id": "dengue", "label": "Dengue outbreak — Burail", "type": "disease_outbreak",
     "zone": "z_burail", "magnitude": 4, "duration_h": 120},
]


class Event(BaseModel):
    type: Literal["bridge_collapse", "road_block", "flood", "power_outage",
                  "factory_shutdown", "disease_outbreak"]
    label: Optional[str] = None
    edge: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    radius_km: float = Field(1.5, ge=0.2, le=6)
    workplace: Optional[str] = None
    zone: Optional[str] = None
    magnitude: int = Field(3, ge=1, le=5)
    duration_h: float = Field(24, ge=1, le=720)


class Feedback(BaseModel):
    category: str
    happened: bool


def _validate(ev: Event):
    if ev.type in ("bridge_collapse", "road_block"):
        if not ev.edge or not engine.BASE.has_edge(*ev.edge.split("|")):
            raise HTTPException(400, "Pick a valid road segment")
    elif ev.type in ("flood", "power_outage"):
        if ev.lat is None or ev.lon is None:
            raise HTTPException(400, "Pick a location on the map")
    elif ev.type == "factory_shutdown" and ev.workplace not in city.WORKPLACES:
        raise HTTPException(400, "Pick a workplace")
    elif ev.type == "disease_outbreak" and ev.zone not in city.ZONES:
        raise HTTPException(400, "Pick a zone")


@app.get("/api/graph")
def graph():
    return engine.graph_payload()


@app.get("/api/scenarios")
def scenarios():
    return SCENARIOS


@app.post("/api/simulate")
def simulate(ev: Event):
    _validate(ev)
    return engine.run_cascade(ev.model_dump())


@app.post("/api/brief")
def brief(ev: Event):
    _validate(ev)
    return llm.brief(engine.run_cascade(ev.model_dump()))


@app.post("/api/feedback")
def give_feedback(fb: Feedback):
    if fb.category not in engine.SEVERITY:
        raise HTTPException(400, "Unknown category")
    return feedback.record(fb.category, fb.happened)


@app.get("/api/feedback")
def get_feedback():
    return feedback.stats()


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/detailed")
def detailed():
    """Guided, plain-language version of the dashboard (same API)."""
    return FileResponse(STATIC / "detailed.html")


if __name__ == "__main__":
    import threading

    import uvicorn
    threading.Thread(target=llm.warm_up, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=8000)
