"""Distil a Note into proposals for the user's own classes.

The pipeline spec section 6 describes, with nothing about the user's data
hardcoded: the classes come from the database (schema_builder), the notes are
whatever the app wrote, and the model only ever fills in fields the user
defined.

Two behaviours carried over from the local-GLiNER2 harness, both earned rather
than assumed (see findings.md):

  1. Paragraph chunking. Extracting a whole note at once collapses several
     distinct objects into one merged object.
  2. A post-pass. Raw output repeats near-identical objects and invents one from
     a bare date header, so low-confidence rows are dropped and duplicates are
     collapsed.

Nothing here writes into a user class. Distillation only ever produces
parallax_proposal rows with status="pending"; review.py commits them.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import extractor as extractor_mod  # noqa: E402
import schema_builder  # noqa: E402

PROPOSAL_TABLE = "parallax_proposal"
PROPOSAL_SCHEMA = Path(__file__).parent / "proposals.surql"

# Confidence floor. Tuned on the local model, where the date-header artefact
# scored 0.5 and genuine objects scored 0.9+. Objects between roughly 0.5 and
# 0.8 are unstable run to run, so this is a threshold, not a guarantee.
CONF_FLOOR = 0.60


def ensure_proposal_table(db):
    """Idempotent, like the app's ensureNoteClass."""
    db.query(PROPOSAL_SCHEMA.read_text(encoding="utf-8"))


# --- chunking ---------------------------------------------------------------


def chunk_with_offsets(text: str):
    """Split on blank lines, keeping each chunk's start offset in the full text.

    The offset is what makes provenance work: the model sees one paragraph and
    reports positions within it, but a proposal must point into the whole note.
    """
    chunks = []
    for match in re.finditer(r"[^\n](?:[^\n]|\n(?!\s*\n))*", text):
        raw = match.group()
        stripped = raw.strip()
        if not stripped:
            continue
        chunks.append((stripped, match.start() + (len(raw) - len(raw.lstrip()))))
    return chunks


# --- extraction -------------------------------------------------------------


def _value_of(cell):
    """A field's text, whether the backend returned a dict or a bare string."""
    if isinstance(cell, dict):
        return cell.get("text")
    if isinstance(cell, str):
        return cell
    return None


def _confidence_of(obj):
    """Mean confidence across the fields that reported one.

    Objects are scored as a whole because the post-pass drops or keeps a whole
    object; per-field scores are kept in provenance for the review UI.
    """
    scores = []
    for cell in obj.values():
        cells = cell if isinstance(cell, list) else [cell]
        for item in cells:
            if isinstance(item, dict) and isinstance(item.get("confidence"), (int, float)):
                scores.append(float(item["confidence"]))
    return sum(scores) / len(scores) if scores else 1.0


def extract_from_note(model, content, classes):
    """Run the extractor per paragraph. Returns rows with global offsets."""
    structures = schema_builder.build_structures(classes)
    if not structures:
        return []

    rows = []
    for para_index, (para, para_start) in enumerate(chunk_with_offsets(content)):
        result = model.extract(para, structures)

        for class_name, objects in result.items():
            for obj in objects:
                payload, provenance = {}, {}

                for field, cell in obj.items():
                    cells = cell if isinstance(cell, list) else [cell]
                    texts, spans = [], []
                    for item in cells:
                        text = _value_of(item)
                        if not text:
                            continue
                        texts.append(text)
                        if isinstance(item, dict) and item.get("start") is not None:
                            spans.append(
                                {
                                    "start": para_start + item["start"],
                                    "end": para_start + item["end"],
                                    "confidence": item.get("confidence"),
                                }
                            )
                    if not texts:
                        continue
                    # A list-valued field keeps every value; a scalar keeps one.
                    payload[field] = texts if isinstance(cell, list) else texts[0]
                    if spans:
                        provenance[field] = spans if isinstance(cell, list) else spans[0]

                if payload:
                    rows.append(
                        {
                            "para_index": para_index,
                            "class_name": class_name,
                            "payload": payload,
                            "provenance": provenance,
                            "confidence": _confidence_of(obj),
                        }
                    )
    return rows


# --- post-pass --------------------------------------------------------------


def _identity(row):
    """Values that make two extractions 'the same object'.

    Uses every scalar field rather than a chosen key field, because the user's
    classes have no notion of a primary field and we must not invent one.
    """
    parts = []
    for field in sorted(row["payload"]):
        value = row["payload"][field]
        if isinstance(value, str):
            parts.append(f"{field}={re.sub(r'\\s+', ' ', value.strip()).lower()}")
    return (row["para_index"], row["class_name"], tuple(parts))


def post_pass(rows, floor=CONF_FLOOR):
    """Drop low-confidence rows, then collapse duplicates keeping the fullest."""
    kept = [r for r in rows if r["confidence"] >= floor]

    best = {}
    for row in kept:
        key = _identity(row)
        rank = (len(row["payload"]), row["confidence"])
        if key not in best or rank > best[key][0]:
            best[key] = (rank, row)
    return [row for _, row in best.values()]


# --- proposals --------------------------------------------------------------

_CREATE = f"""
CREATE {PROPOSAL_TABLE} SET
    note = $note, class_name = $class_name, payload = $payload,
    provenance = $provenance, unparsed = {{}}, confidence = $confidence,
    status = "pending", extractor = $extractor;
"""


def distill_note(db, note_id, model=None, classes=None):
    """Extract from one stored Note and write pending proposals."""
    model = model or extractor_mod.load()
    classes = classes if classes is not None else schema_builder.load_classes(db)

    rows = db.query("SELECT content FROM $note;", {"note": note_id})
    if not rows:
        raise ValueError(f"no such note: {note_id}")
    content = rows[0]["content"]

    ensure_proposal_table(db)

    # Re-distilling replaces, not appends: drop this note's still-pending
    # proposals from a previous run so repeated Distil clicks do not stack
    # duplicates. Approved/rejected proposals stay as the audit trail.
    db.query(
        f"DELETE {PROPOSAL_TABLE} WHERE note = $note AND status = 'pending';",
        {"note": note_id},
    )

    proposals = []
    for row in post_pass(extract_from_note(model, content, classes)):
        created = db.query(
            _CREATE,
            {
                "note": note_id,
                "class_name": row["class_name"],
                "payload": row["payload"],
                "provenance": row["provenance"],
                "confidence": float(row["confidence"]),
                "extractor": model.name,
            },
        )
        proposals.append(created[0])
    return proposals


def list_notes(db, limit=20):
    return db.query(
        f"SELECT id, created, content FROM Note ORDER BY created DESC LIMIT {int(limit)}"
    ) or []
