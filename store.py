"""Tiny JSON-file store for reports, incidents, after-action reports and drill attempts.

Prototype only: one file per collection under data/. Production would use PostgreSQL + PostGIS.
"""
import json
import threading
import time
import uuid
from pathlib import Path

DATA = Path(__file__).parent / "data"
DATA.mkdir(exist_ok=True)
_lock = threading.RLock()


def _path(name):
    return DATA / f"{name}.json"


def load(name, default=None):
    with _lock:
        p = _path(name)
        if not p.exists():
            return {} if default is None else default
        return json.loads(p.read_text(encoding="utf-8"))


def save(name, data):
    with _lock:
        tmp = _path(name).with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_path(name))


def update(name, fn):
    """Load, mutate with fn(data) -> result, save, return result. Atomic under the lock."""
    with _lock:
        data = load(name)
        out = fn(data)
        save(name, data)
        return out


def new_id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def now():
    return time.time()
