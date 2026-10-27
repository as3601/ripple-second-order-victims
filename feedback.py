"""Feedback loop: responders confirm or reject predictions; per-category
calibration factors re-weight future impact scores."""
import json
import threading
from pathlib import Path

PATH = Path(__file__).parent / "feedback.json"
_lock = threading.Lock()


def _load():
    if PATH.exists():
        return json.loads(PATH.read_text(encoding="utf-8"))
    return {}


def record(category, happened):
    with _lock:
        data = _load()
        c = data.setdefault(category, {"hit": 0, "miss": 0})
        c["hit" if happened else "miss"] += 1
        PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return stats()


def calibration():
    """Laplace-smoothed precision mapped to a 0.6-1.4 score multiplier (1.0 = no evidence)."""
    out = {}
    for cat, c in _load().items():
        precision = (c["hit"] + 1) / (c["hit"] + c["miss"] + 2)
        out[cat] = round(0.6 + 0.8 * precision, 3)
    return out


def stats():
    data = _load()
    return {cat: {**c, "factor": calibration().get(cat, 1.0)} for cat, c in data.items()}
