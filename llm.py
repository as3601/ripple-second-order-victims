"""LLM layer: plain-language control-room briefing + AI-suggested hidden dependencies.

Uses Claude when credentials are available (ANTHROPIC_API_KEY or `ant auth login`);
otherwise falls back to a deterministic template so the demo never breaks.
"""
import json
import os

MODEL = os.environ.get("RIPPLE_MODEL", "claude-opus-5-5")

SCHEMA = {
    "type": "object",
    "properties": {
        "briefing": {"type": "string"},
        "hidden_links": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["briefing", "hidden_links"],
    "additionalProperties": False,
}

SYSTEM = (
    "You support a city emergency control room in the Chandigarh tricity, India. "
    "Given a disruptive event and the cascade engine's ranked predictions, write a briefing "
    "of at most 5 short sentences in plain language for the duty officer: who will be affected "
    "next, when, and the 2-3 actions to take first. Use the numbers given; do not invent new figures. "
    "Then list 3-5 plausible hidden second-order dependencies the engine did NOT model "
    "(specific to Indian cities: informal workers, mandis, ASHA workers, PDS, etc.), one line each."
)


def template_brief(result):
    ev, imps = result["event"], result["impacts"]
    if not imps:
        return "No downstream human consequences predicted above threshold for this event."
    label = ev.get("label") or ev["type"].replace("_", " ").title()
    lines = [f"{label}: {result['totals']['people']:,} people across {result['totals']['zones']} zones "
             f"face knock-on effects; {result['totals']['critical']} alerts are critical."]
    for i in sorted(imps[:4], key=lambda i: i["eta_h"]):
        lines.append(f"T+{i['eta_h']}h: {i['title']}.")
    lines.append(f"Act first: {imps[0]['action'].split(';')[0]}.")
    return " ".join(lines)


def brief(result):
    try:
        import anthropic
        client = anthropic.Anthropic()
        payload = {
            "event": result["event"],
            "first_order": [f["what"] for f in result["first_order"]],
            "top_predictions": [{k: i[k] for k in ("order", "label", "title", "people", "eta_h",
                                                     "priority", "action")} for i in result["impacts"][:12]],
            "hospital_load": result["hospital_load"],
        }
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=2000,
            system=SYSTEM,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            betas=["server-side-fallback-2026-07-01"],
            extra_body={"fallbacks": "default"},
            messages=[{"role": "user", "content": json.dumps(payload)}],
        )
        if resp.stop_reason == "refusal":
            raise RuntimeError("refusal")
        text = "".join(b.text for b in resp.content if b.type == "text")
        data = json.loads(text)
        return {"briefing": data["briefing"],
                "hidden_links": [{"text": t, "source": "claude"} for t in data["hidden_links"]],
                "source": "claude"}
    except Exception as e:  # no credentials, offline, etc. -> deterministic fallback
        return {"briefing": template_brief(result), "hidden_links": [], "source": "template",
                "note": type(e).__name__}
