"""Tests that answer: was GLiNER2 really run, and did it really distill?

These are written to be adversarial about their own result. Several of them
(provenance, mutation, determinism) cannot pass if the output were fabricated or
hardcoded, which is the actual question being asked of this harness.

Requires `surreal start` listening on 127.0.0.1:8000.

    uv run --with "gliner2[local]" --with surrealdb --with pytest -m pytest -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pytest  # noqa: E402

import db as dbmod  # noqa: E402
import distill  # noqa: E402
import review  # noqa: E402

JOURNAL = (Path(__file__).parent / "journal.txt").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def model():
    return distill.load_model()


@pytest.fixture
def conn():
    connection = dbmod.connect()
    dbmod.reset(connection)
    return connection


@pytest.fixture
def note(conn):
    return conn.query("CREATE Note SET content = $c;", {"c": JOURNAL})[0]["id"]


@pytest.fixture
def distilled(conn, note, model):
    return distill.distill(conn, note, model=model)


def payloads(proposals, class_name):
    return [p["payload"] for p in proposals if p["class_name"] == class_name]


# --- did the model actually run? --------------------------------------------


def test_provenance_spans_quote_the_note(distilled):
    """Every extracted value must be a real substring at its reported offsets.

    This is the strongest anti-fabrication check available: offsets are only
    self-consistent if they came from a model that read this exact text.
    """
    checked = 0
    for proposal in distilled:
        if proposal["class_name"] != "Event":
            continue
        for field in ("name", "location", "time"):
            span = proposal["provenance"].get(field) or {}
            value = proposal["payload"].get(field)
            if span.get("start") is None or value is None:
                continue
            assert JOURNAL[span["start"]:span["end"]] == value, (
                f"{field}={value!r} does not sit at {span['start']}:{span['end']}"
            )
            checked += 1
    assert checked >= 5, f"expected several spans to verify, checked {checked}"


def test_person_provenance_quotes_the_note(distilled):
    for proposal in distilled:
        if proposal["class_name"] != "Person":
            continue
        for mention in proposal["provenance"]["mentions"]:
            quoted = JOURNAL[mention["start"]:mention["end"]]
            name = proposal["payload"]["name"]
            assert quoted == name or quoted in proposal["payload"]["aliases"], (
                f"mention {quoted!r} matches neither {name!r} nor its aliases"
            )


def test_output_tracks_a_mutated_input(conn, model):
    """Rename a person in the note; the extraction must follow.

    Hardcoded output would keep saying "Anna".
    """
    mutated = JOURNAL.replace("Anna", "Priyanka")
    note = conn.query("CREATE Note SET content = $c;", {"c": mutated})[0]["id"]
    names = {p["payload"]["name"] for p in distill.distill(conn, note, model=model)
             if p["class_name"] == "Person"}
    assert "Priyanka" in names
    assert "Anna" not in names


def test_extraction_is_deterministic(conn, model):
    """GLiNER2 is an encoder: identical input must give identical output."""
    def run():
        note = conn.query("CREATE Note SET content = $c;", {"c": JOURNAL})[0]["id"]
        return [
            (p["class_name"], p["payload"], round(p["confidence"], 6))
            for p in distill.distill(conn, note, model=model)
        ]

    assert run() == run()


# --- did chunking and the post-pass do their job? ---------------------------


def test_chunk_offsets_are_exact():
    for chunk, start in distill.chunk_with_offsets(JOURNAL):
        assert JOURNAL[start:start + len(chunk)] == chunk


def test_multiple_events_survive_chunking(distilled):
    """The smoke test's core finding: whole-note extraction collapses to one
    object, per-paragraph extraction does not. Guard against regressing to it."""
    events = payloads(distilled, "Event")
    assert len(events) >= 4, f"chunking regressed: only {len(events)} events"


def test_no_duplicate_events(distilled):
    names = [distill.normalise_event(e["name"]) for e in payloads(distilled, "Event")]
    assert len(names) == len(set(names)), f"post-pass let duplicates through: {names}"


def test_date_header_artefact_is_filtered(distilled):
    """Raw output invents an event named after the note's date header."""
    names = [e["name"].lower() for e in payloads(distilled, "Event")]
    assert not any("saturday" in n or "august" in n for n in names), names


def test_events_are_grouped_not_flat(distilled):
    """A distillation extractor must bind fields together, not emit loose spans."""
    events = payloads(distilled, "Event")
    grouped = [e for e in events if e.get("location") and e.get("people")]
    assert grouped, "no event bound a location and a person into one object"


# --- did it distill into the database? --------------------------------------


def test_distillation_writes_nothing_until_approved(conn, distilled):
    """Spec section 6: review before commit."""
    assert conn.query("SELECT * FROM Event;") in (None, [])
    assert conn.query("SELECT * FROM Person;") in (None, [])
    assert all(p["status"] == "pending" for p in distilled)


def test_approval_creates_objects_in_the_database(conn, note, distilled):
    review.approve_all(conn, note)

    events = conn.query("SELECT * FROM Event;") or []
    people = conn.query("SELECT * FROM Person;") or []
    assert events, "approval produced no Event rows"
    assert people, "approval produced no Person rows"
    assert conn.query("SELECT * FROM Proposal WHERE status = 'pending';") in (None, [])


def test_event_people_are_resolved_record_links(conn, note, distilled):
    """people must be record<Person>, dereferenceable by the database itself."""
    review.approve_all(conn, note)
    rows = conn.query(
        """SELECT name, (SELECT name FROM $parent.people) AS attendees
           FROM Event WHERE array::len(people) > 0;"""
    ) or []
    assert rows, "no event ended up with linked people"
    for row in rows:
        assert all(a.get("name") for a in row["attendees"])


def test_events_link_back_to_their_source_note(conn, note, distilled):
    review.approve_all(conn, note)
    for event in conn.query("SELECT source FROM Event;") or []:
        assert event["source"] == note


def test_rejected_proposals_are_not_committed(conn, note, distilled):
    target = next(p for p in distilled if p["class_name"] == "Event")
    review.reject(conn, target["id"])
    review.approve_all(conn, note)

    names = [e["name"] for e in conn.query("SELECT name FROM Event;") or []]
    assert target["payload"]["name"] not in names
    row = conn.query("SELECT status FROM $id;", {"id": target["id"]})[0]
    assert row["status"] == "rejected"


def test_person_approval_is_idempotent(conn, note, distilled):
    """Approving the same person twice must merge, not duplicate.

    Entity resolution is the step no extraction model provides.
    """
    review.approve_all(conn, note)
    before = len(conn.query("SELECT * FROM Person;") or [])

    person = next(p for p in distilled if p["class_name"] == "Person")
    review.approve(conn, person)

    assert len(conn.query("SELECT * FROM Person;") or []) == before


# --- is the database actually enforcing the schema? -------------------------


def test_database_rejects_a_wrongly_typed_field(conn):
    """Spec section 3: enforcement lives in the DB, not in the client."""
    with pytest.raises(Exception):
        conn.query("CREATE Person SET name = 12345;")


def test_database_rejects_an_unknown_field(conn):
    with pytest.raises(Exception):
        conn.query("CREATE Person SET name = 'X', not_in_schema = 'y';")


def test_database_rejects_an_invalid_proposal_status(conn, note):
    with pytest.raises(Exception):
        conn.query(
            """CREATE Proposal SET note = $n, class_name = 'Event', payload = {},
               confidence = 0.5, provenance = {}, status = 'banana';""",
            {"n": note},
        )


def test_database_rejects_a_dangling_person_link(conn):
    with pytest.raises(Exception):
        conn.query("CREATE Event SET name = 'X', people = ['not a record'];")
