"""End-to-end distillation demo.

  schema -> insert Note -> distill -> proposals -> approve -> query objects back

The final section is the point of the whole harness: it reads Event and Person
rows *out of SurrealDB*, not out of the model's output. If those rows are there,
GLiNER2 has functioned as a distillation extractor, not just a text tagger.

Run (with `surreal start` already listening on 127.0.0.1:8000):
    uv run --with "gliner2[local]" --with surrealdb python run_demo.py
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import db as dbmod  # noqa: E402
import distill  # noqa: E402
import review  # noqa: E402

JOURNAL = Path(__file__).parent / "journal.txt"


def rule(title):
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def main():
    content = JOURNAL.read_text(encoding="utf-8")

    rule("1. schema")
    conn = dbmod.connect()
    dbmod.reset(conn)
    print(f"applied {dbmod.SCHEMA.name}; Note / Person / Event / Proposal defined")

    rule("2. capture — insert the journal as a Note")
    note = conn.query("CREATE Note SET content = $content;", {"content": content})[0]
    note_id = note["id"]
    print(f"{note_id}  ({len(content)} chars, {content.count(chr(10) + chr(10)) + 1} paragraphs)")

    rule("3. distill — GLiNER2 over each paragraph")
    t0 = time.perf_counter()
    model = distill.load_model()
    load_s = time.perf_counter() - t0

    t0 = time.perf_counter()
    proposals = distill.distill(conn, note_id, model=model)
    distill_ms = (time.perf_counter() - t0) * 1000
    print(f"model load {load_s:.1f}s · distillation {distill_ms:.0f} ms · "
          f"{len(proposals)} proposals (status=pending)")

    for proposal in sorted(proposals, key=lambda p: p["class_name"]):
        payload = proposal["payload"]
        summary = (
            payload["name"]
            if proposal["class_name"] == "Person"
            else f"{payload['name']} @ {payload.get('location') or '—'}"
            f" · {payload.get('time') or '—'} · {', '.join(payload.get('people') or []) or '—'}"
        )
        print(f"  [{proposal['class_name']:<6}] {proposal['confidence']:.2f}  {summary}")

    rule("4. provenance — every proposal points back into the note")
    for proposal in proposals:
        if proposal["class_name"] != "Event":
            continue
        span = proposal["provenance"]["name"]
        quoted = content[span["start"]:span["end"]]
        ok = "OK" if quoted == proposal["payload"]["name"] else "MISMATCH"
        print(f"  {ok:<8} chars {span['start']:>3}–{span['end']:<3} -> {quoted!r}")

    rule("5. review — approve all pending proposals")
    committed = review.approve_all(conn, note_id)
    print(f"committed {len(committed)} objects; "
          f"{len(review.pending(conn, note_id))} proposals still pending")

    rule("6. read the objects back OUT of SurrealDB")
    people = conn.query("SELECT * FROM Person ORDER BY name;") or []
    print(f"\nPerson ({len(people)}):")
    for person in people:
        alias = f"  aliases: {person['aliases']}" if person["aliases"] else ""
        print(f"  {person['name']}{alias}")

    events = conn.query(
        "SELECT *, people.*.name AS people_names FROM Event ORDER BY name;"
    ) or []
    print(f"\nEvent ({len(events)}):")
    for event in events:
        print(
            f"  {event['name']}\n"
            f"      location : {event.get('location') or '—'}\n"
            f"      time     : {event.get('time') or '—'}\n"
            f"      people   : {', '.join(event.get('people_names') or []) or '—'}\n"
            f"      source   : {event.get('source')}"
        )

    rule("7. the links are real records, not strings")
    linked = conn.query(
        """SELECT name, (SELECT name FROM $parent.people) AS attendees
           FROM Event WHERE array::len(people) > 0;"""
    ) or []
    for row in linked:
        names = [a["name"] for a in row["attendees"]]
        print(f"  {row['name']} -> {names} (resolved through record<Person>)")

    print("\nDone. Objects above were read from SurrealDB, not from model output.")


if __name__ == "__main__":
    main()
