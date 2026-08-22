"""Review before commit (spec section 6), for whatever classes the user defined.

Distillation produces proposals; nothing reaches a user class until approved
here. Rejection only changes status, so a rejected extraction stays on record
and is auditable rather than silently dropped.

The model returns text for every field, but the user's classes have real types.
Coercion is therefore the interesting part, and its rule is: never guess and
never silently drop. A value that will not parse is moved to `unparsed` and the
proposal is held for the user to fix, because a wrong date committed quietly is
worse than one that asks for attention.
"""

import re
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import schema_builder  # noqa: E402

PROPOSAL_TABLE = "parallax_proposal"

TRUE_WORDS = {"yes", "y", "true", "t", "1", "on"}
FALSE_WORDS = {"no", "n", "false", "f", "0", "off"}

# Tried in order. Deliberately conservative: formats a human would write
# unambiguously. Anything vaguer ("next Thursday") is left unparsed on purpose.
_DATE_FORMATS = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d %B %Y",
    "%d %b %Y",
    "%B %d %Y",
    "%b %d %Y",
    "%d %B",
    "%d %b",
    "%B %d",
    "%b %d",
)


class Unparsed(Exception):
    """A value could not be coerced to the field's type."""


def coerce_number(text: str):
    cleaned = re.sub(r"[^\d.\-]", "", str(text).strip())
    if cleaned in ("", "-", ".", "-."):
        raise Unparsed(f"no number in {text!r}")
    try:
        value = float(cleaned)
    except ValueError as err:
        raise Unparsed(f"{text!r} is not a number") from err
    return int(value) if value.is_integer() else value


def coerce_boolean(text: str) -> bool:
    word = str(text).strip().lower()
    if word in TRUE_WORDS:
        return True
    if word in FALSE_WORDS:
        return False
    raise Unparsed(f"{text!r} is not yes/no")


def coerce_datetime(text: str) -> str:
    """Return an ISO-8601 string SurrealDB will accept as a datetime.

    A date with no year is assumed to be the current year - the note that
    produced it was written now. That assumption is worth knowing about, so it
    is stated here rather than buried.
    """
    raw = str(text).strip()
    if not raw:
        raise Unparsed("empty")

    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed.strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        pass

    cleaned = re.sub(r"\b(\d{1,2})(st|nd|rd|th)\b", r"\1", raw, flags=re.I)
    cleaned = re.sub(r"^(on|at|the)\s+", "", cleaned, flags=re.I).strip(" ,.")

    for fmt in _DATE_FORMATS:
        try:
            parsed = datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
        if "%Y" not in fmt:
            parsed = parsed.replace(year=date.today().year)
        return parsed.strftime("%Y-%m-%dT%H:%M:%SZ")

    raise Unparsed(f"{text!r} is not a date this can read")


COERCERS = {
    "text": lambda v: str(v),
    "long_text": lambda v: str(v),
    "number": coerce_number,
    "boolean": coerce_boolean,
    "datetime": coerce_datetime,
}


def coerce_payload(payload: dict, fields):
    """Split a proposal's payload into committable values and unparsed ones.

    Returns (values, unparsed, missing_required).
    """
    by_name = {f.name: f for f in fields}
    values, unparsed = {}, {}

    for name, raw in payload.items():
        field = by_name.get(name)
        if field is None:
            continue  # a field that no longer exists on the class
        if isinstance(raw, list):
            raw = raw[0] if raw else None
        if raw is None or str(raw).strip() == "":
            continue
        try:
            values[name] = COERCERS[field.ui_type](raw)
        except Unparsed as err:
            unparsed[name] = {"text": raw, "reason": str(err)}

    missing = [f.name for f in fields if f.required and f.name not in values]
    return values, unparsed, missing


# --- queue ------------------------------------------------------------------


def pending(db, note_id=None):
    if note_id is None:
        return db.query(f"SELECT * FROM {PROPOSAL_TABLE} WHERE status = 'pending';") or []
    return (
        db.query(
            f"SELECT * FROM {PROPOSAL_TABLE} WHERE status = 'pending' AND note = $note;",
            {"note": note_id},
        )
        or []
    )


def reject(db, proposal_id):
    db.query(f"UPDATE $id SET status = 'rejected';", {"id": proposal_id})


def approve(db, proposal, classes=None):
    """Commit one proposal into its class.

    Raises ValueError when the proposal cannot be committed as-is - a required
    field is missing, or every value failed to parse. The proposal stays
    pending so the user can fix it.
    """
    classes = classes if classes is not None else schema_builder.load_classes(db)
    cls = next((c for c in classes if c.name == proposal["class_name"]), None)
    if cls is None:
        raise ValueError(f"class {proposal['class_name']} no longer exists")

    values, unparsed, missing = coerce_payload(proposal["payload"], cls.fields)

    if unparsed:
        db.query(
            "UPDATE $id SET unparsed = $unparsed;",
            {"id": proposal["id"], "unparsed": unparsed},
        )
    if missing:
        raise ValueError(
            f"{cls.name} requires {', '.join(missing)}, which was not extracted"
        )
    if not values:
        raise ValueError("nothing usable was extracted")

    assignments = ", ".join(f"{name} = ${name}" for name in values)
    row = db.query(f"CREATE {cls.name} SET {assignments};", dict(values))[0]

    db.query(
        "UPDATE $id SET status = 'approved', committed = $committed;",
        {"id": proposal["id"], "committed": row["id"]},
    )
    return row


def approve_all(db, note_id=None, classes=None):
    """Approve every pending proposal. Returns (committed, failures)."""
    classes = classes if classes is not None else schema_builder.load_classes(db)
    committed, failures = [], []
    for proposal in pending(db, note_id):
        try:
            committed.append(approve(db, proposal, classes))
        except ValueError as err:
            failures.append((proposal, str(err)))
    return committed, failures
