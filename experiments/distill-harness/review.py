"""Review before commit (spec section 6), headless.

Distillation produces Proposals; nothing reaches the user's real classes until a
proposal is approved here. Rejection is a status change only - the proposal stays
on record, so a rejected extraction is auditable rather than silently dropped.

Person proposals must be committed before Event proposals, because Event.people
is array<record<Person>> and the links have to resolve to rows that exist.
"""

import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Order matters: Events reference Persons.
COMMIT_ORDER = ["Person", "Event"]


def pending(db, note_id=None):
    """List pending proposals, Persons first."""
    if note_id is None:
        rows = db.query("SELECT * FROM Proposal WHERE status = 'pending';")
    else:
        rows = db.query(
            "SELECT * FROM Proposal WHERE status = 'pending' AND note = $note;",
            {"note": note_id},
        )
    rows = rows or []
    return sorted(rows, key=lambda p: COMMIT_ORDER.index(p["class_name"]))


def reject(db, proposal_id):
    db.query("UPDATE $id SET status = 'rejected';", {"id": proposal_id})


def _resolve_person(db, name):
    """Find an existing Person by name or alias. Returns a RecordID or None."""
    rows = db.query(
        "SELECT id FROM Person WHERE name = $name OR $name IN aliases;", {"name": name}
    )
    return rows[0]["id"] if rows else None


def approve(db, proposal):
    """Commit one proposal into its real class. Returns the created/updated row.

    Idempotent on Person: approving two proposals naming the same person merges
    aliases onto the existing row instead of creating a duplicate. That is the
    entity-resolution step no extraction model provides.
    """
    payload = proposal["payload"]
    class_name = proposal["class_name"]

    if class_name == "Person":
        existing = _resolve_person(db, payload["name"])
        if existing:
            row = db.query(
                """UPDATE $id SET aliases = array::distinct(aliases + $aliases)
                   RETURN AFTER;""",
                {"id": existing, "aliases": payload.get("aliases", [])},
            )[0]
        else:
            row = db.query(
                "CREATE Person SET name = $name, aliases = $aliases;",
                {"name": payload["name"], "aliases": payload.get("aliases", [])},
            )[0]

    elif class_name == "Event":
        people = []
        for name in payload.get("people", []):
            person_id = _resolve_person(db, name)
            if person_id is None:
                # The Person proposal was rejected, or never made. Drop the link
                # rather than inventing a row the user never approved.
                continue
            people.append(person_id)

        row = db.query(
            """CREATE Event SET name = $name, location = $location, time = $time,
               people = $people, source = $source;""",
            {
                "name": payload["name"],
                "location": payload.get("location"),
                "time": payload.get("time"),
                "people": people,
                "source": proposal["note"],
            },
        )[0]

    else:
        raise ValueError(f"unknown class_name: {class_name}")

    db.query(
        "UPDATE $id SET status = 'approved', committed = $committed;",
        {"id": proposal["id"], "committed": row["id"]},
    )
    return row


def approve_all(db, note_id=None):
    """Approve every pending proposal, Persons first. Returns committed rows."""
    return [approve(db, proposal) for proposal in pending(db, note_id)]
