"""Distillation extractor: Note.content -> reviewable Proposals.

Implements the pipeline spec section 6 describes, using GLiNER2 as the extraction
model. Carries the two findings from experiments/gliner2-smoke/findings.md:

  1. Paragraph chunking is mandatory. Whole-note structured extraction collapses
     several distinct events into one merged object.
  2. A dedup + confidence-threshold post-pass is required. Raw model output
     contains duplicate objects and a spurious event built from the date header.

Nothing here writes Person/Event rows: distillation only ever produces Proposals
with status="pending". Committing is review.py's job (spec section 6, review
before commit).
"""

import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from gliner2 import GLiNER2  # noqa: E402

MODEL_ID = "fastino/gliner2-base-v1"

# Confidence floor. Tuned to the smoke-test finding that the "Saturday 22 August"
# header artefact scored 0.58 while every genuine event scored >= 0.87.
CONF_FLOOR = 0.60

EVENT_SCHEMA = {
    "event": [
        "name::str::Short name of the activity or occasion, e.g. breakfast, picnic, climbing",
        "location::str::The place where it happened",
        "people::list::Names of people present",
        "time::str::Clock time or day it happened",
    ]
}

_model_cache = {}


def load_model(model_id: str = MODEL_ID):
    """Load GLiNER2 once per process (weights are ~450MB)."""
    if model_id not in _model_cache:
        _model_cache[model_id] = GLiNER2.from_pretrained(model_id)
    return _model_cache[model_id]


# --- chunking ---------------------------------------------------------------


def chunk_with_offsets(text: str):
    """Split on blank lines, keeping each chunk's start offset in the full text.

    The offset is what makes provenance work: the model sees a paragraph and
    reports positions within it, but a Proposal must point into the whole note.
    """
    chunks = []
    for match in re.finditer(r"[^\n](?:[^\n]|\n(?!\s*\n))*", text):
        raw = match.group()
        stripped = raw.strip()
        if not stripped:
            continue
        start = match.start() + (len(raw) - len(raw.lstrip()))
        chunks.append((stripped, start))
    return chunks


# --- normalisation / entity resolution --------------------------------------

_POSSESSIVE = re.compile(r"[’']s$")


def normalise_person(raw: str) -> str:
    """Canonical form of a person mention.

    Entity resolution is not provided by any extraction model - GLiNER2 returns
    spans (Mei's, Mei), not identities. This is the minimum viable collapse:
    strip possessives and leading articles, squash whitespace, capitalise.
    """
    name = raw.strip().strip(".,;:")
    name = _POSSESSIVE.sub("", name)
    name = re.sub(r"^(?:my|the|a)\s+", "", name, flags=re.I)
    name = re.sub(r"\s+", " ", name)
    return name[:1].upper() + name[1:] if name else name


def normalise_event(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.strip().strip(".,;:")).lower()


# --- extraction -------------------------------------------------------------


def _field(obj, key):
    """Pull a scalar field from GLiNER2 output, tolerating nulls."""
    val = obj.get(key)
    if not val or not isinstance(val, dict):
        return None, None, None
    return val.get("text"), val.get("start"), val.get("end")


def extract_events(model, content: str):
    """Run GLiNER2 per paragraph and return event dicts with global offsets."""
    events = []
    for para_index, (para, para_start) in enumerate(chunk_with_offsets(content)):
        out = model.extract_json(
            para, EVENT_SCHEMA, include_confidence=True, include_spans=True
        )

        def glob(v):
            """Local paragraph offset -> global note offset."""
            return None if v is None else para_start + v

        for obj in out.get("event", []):
            name, n_start, n_end = _field(obj, "name")
            if not name:
                continue

            loc, l_start, l_end = _field(obj, "location")
            when, t_start, t_end = _field(obj, "time")

            people = []
            for person in obj.get("people") or []:
                text = person.get("text")
                if not text:
                    continue
                people.append(
                    {
                        "name": normalise_person(text),
                        "mention": text,
                        "confidence": float(person.get("confidence", 0.0)),
                        "start": glob(person.get("start")),
                        "end": glob(person.get("end")),
                    }
                )

            events.append(
                {
                    "para_index": para_index,
                    "name": name,
                    "location": loc,
                    "time": when,
                    "people": people,
                    "confidence": float(obj["name"].get("confidence", 0.0)),
                    "provenance": {
                        "name": {"start": glob(n_start), "end": glob(n_end)},
                        "location": {"start": glob(l_start), "end": glob(l_end)},
                        "time": {"start": glob(t_start), "end": glob(t_end)},
                    },
                }
            )
    return events


# --- post-pass --------------------------------------------------------------


def post_pass(events):
    """Drop low-confidence artefacts and collapse duplicates.

    Raw GLiNER2 output repeats near-identical objects (the smoke test returned
    breakfast and stats problem set twice each) and invents an event from a bare
    date header. Both are fixed deterministically, not by the model.
    """
    kept = [e for e in events if e["confidence"] >= CONF_FLOOR]

    best = {}
    for event in kept:
        key = (event["para_index"], normalise_event(event["name"]))
        filled = sum(1 for f in ("location", "time") if event.get(f))
        rank = (filled + len(event["people"]), event["confidence"])
        if key not in best or rank > best[key][0]:
            best[key] = (rank, event)

    return sorted(
        (event for _, event in best.values()),
        key=lambda e: (e["provenance"]["name"]["start"] is None,
                       e["provenance"]["name"]["start"]),
    )


# --- proposals --------------------------------------------------------------

_CREATE_PROPOSAL = """
CREATE Proposal SET
    note = $note,
    class_name = $class_name,
    payload = $payload,
    confidence = $confidence,
    provenance = $provenance,
    status = "pending";
"""


def distill(db, note_id, model=None):
    """Extract from a stored Note and write pending Proposals. Returns them."""
    model = model or load_model()

    rows = db.query("SELECT content FROM $note;", {"note": note_id})
    if not rows:
        raise ValueError(f"no such note: {note_id}")
    content = rows[0]["content"]

    events = post_pass(extract_events(model, content))

    # Person proposals: one per canonical name across all events.
    people = {}
    for event in events:
        for person in event["people"]:
            entry = people.setdefault(
                person["name"], {"confidence": 0.0, "mentions": [], "provenance": []}
            )
            entry["confidence"] = max(entry["confidence"], person["confidence"])
            if person["mention"] not in entry["mentions"]:
                entry["mentions"].append(person["mention"])
            entry["provenance"].append({"start": person["start"], "end": person["end"]})

    proposals = []

    for name, entry in people.items():
        proposals.append(
            db.query(
                _CREATE_PROPOSAL,
                {
                    "note": note_id,
                    "class_name": "Person",
                    "payload": {
                        "name": name,
                        "aliases": [m for m in entry["mentions"] if m != name],
                    },
                    "confidence": entry["confidence"],
                    "provenance": {"mentions": entry["provenance"]},
                },
            )[0]
        )

    for event in events:
        proposals.append(
            db.query(
                _CREATE_PROPOSAL,
                {
                    "note": note_id,
                    "class_name": "Event",
                    "payload": {
                        "name": event["name"],
                        "location": event["location"],
                        "time": event["time"],
                        "people": [p["name"] for p in event["people"]],
                    },
                    "confidence": event["confidence"],
                    "provenance": event["provenance"],
                },
            )[0]
        )

    return proposals
