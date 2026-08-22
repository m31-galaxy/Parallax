"""Dump one full distillation run as machine-readable JSON.

Produces output.json: the note, every Proposal (with provenance offsets and the
exact substring each offset quotes), and the Person/Event objects as they exist
in SurrealDB after approval.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import db as dbmod
import distill
import review

JOURNAL = Path(__file__).parent / "journal.txt"
OUT = Path(__file__).parent / "output.json"


def plain(value):
    """RecordID -> str, so the dump is portable JSON."""
    return None if value is None else str(value)


def main():
    content = JOURNAL.read_text(encoding="utf-8")
    conn = dbmod.connect()
    dbmod.reset(conn)

    note_id = conn.query("CREATE Note SET content = $c;", {"c": content})[0]["id"]

    model = distill.load_model()
    started = time.perf_counter()
    proposals = distill.distill(conn, note_id, model=model)
    elapsed_ms = round((time.perf_counter() - started) * 1000)

    def quoted(span):
        if not span or span.get("start") is None:
            return None
        return content[span["start"]:span["end"]]

    dumped_proposals = []
    for p in proposals:
        provenance = {}
        for field, span in p["provenance"].items():
            if field == "mentions":
                provenance[field] = [
                    {**m, "quotes": quoted(m)} for m in span
                ]
            else:
                provenance[field] = {**span, "quotes": quoted(span)}
        dumped_proposals.append(
            {
                "id": plain(p["id"]),
                "class_name": p["class_name"],
                "confidence": round(p["confidence"], 4),
                "payload": p["payload"],
                "provenance": provenance,
                "status": p["status"],
            }
        )

    review.approve_all(conn, note_id)

    people = [
        {"id": plain(r["id"]), "name": r["name"], "aliases": r["aliases"]}
        for r in conn.query("SELECT * FROM Person ORDER BY name;") or []
    ]
    events = [
        {
            "id": plain(r["id"]),
            "name": r["name"],
            "location": r.get("location"),
            "time": r.get("time"),
            "people": [plain(x) for x in r.get("people") or []],
            "people_names": r.get("people_names") or [],
            "source": plain(r.get("source")),
        }
        for r in conn.query(
            "SELECT *, people.*.name AS people_names FROM Event ORDER BY name;"
        ) or []
    ]

    OUT.write_text(
        json.dumps(
            {
                "model": distill.MODEL_ID,
                "fine_tuned": False,
                "confidence_floor": distill.CONF_FLOOR,
                "distillation_ms": elapsed_ms,
                "note": {"id": plain(note_id), "chars": len(content), "content": content},
                "proposals": dumped_proposals,
                "committed": {"Person": people, "Event": events},
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"wrote {OUT.name}: {len(dumped_proposals)} proposals, "
          f"{len(people)} Person, {len(events)} Event, {elapsed_ms} ms")


if __name__ == "__main__":
    main()
