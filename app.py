"""Ripple — AI for Second-Order Victims. FastAPI server: run `python app.py`."""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import engine
import feedback
import llm
import ops
from models import SCENARIOS, Event, validate_event as _validate

app = FastAPI(title="Ripple — AI for Second-Order Victims")
app.include_router(ops.router)
STATIC = Path(__file__).parent / "static"


class Feedback(BaseModel):
    category: str
    happened: bool


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


@app.get("/official")
def official_page():
    return FileResponse(STATIC / "official.html")


@app.get("/public")
def public_page():
    return FileResponse(STATIC / "public.html")


@app.get("/drills")
def drills_page():
    return FileResponse(STATIC / "drills.html")


if __name__ == "__main__":
    import os
    import threading

    import uvicorn

    import news
    threading.Thread(target=llm.warm_up, daemon=True).start()
    threading.Thread(target=news.auto_scan_forever, daemon=True).start()  # automatic news monitoring
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("RIPPLE_PORT", "8000")))
