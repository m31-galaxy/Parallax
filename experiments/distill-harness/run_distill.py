"""Distil notes from a Parallax database into proposals.

    uv run --with "gliner2[local]" --with surrealdb python \
        experiments/distill-harness/run_distill.py --database journal

Options:
    --database NAME   which database in the `parallax` namespace (default: journal)
    --note ID         distil one note (default: the most recent)
    --all             distil every note
    --extractor X     local | pioneer   (default: $PARALLAX_EXTRACTOR, else local)
    --dry-run         show what would be proposed without writing anything
"""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from surrealdb import Surreal  # noqa: E402

import distill  # noqa: E402
import extractor as extractor_mod  # noqa: E402
import schema_builder  # noqa: E402

URL = "ws://127.0.0.1:8000/rpc"
NS = "parallax"


def connect(database):
    db = Surreal(URL)
    db.signin({"username": "root", "password": "root"})
    db.use(NS, database)
    return db


def rule(title):
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="journal")
    parser.add_argument("--note")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--extractor")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = connect(args.database)
    print(f"connected to {NS}/{args.database}")

    rule("1. classes defined by the user (nothing hardcoded)")
    classes = schema_builder.load_classes(db)
    if not classes:
        print("No extractable classes. Create one in the class designer first.")
        return 1
    print(schema_builder.describe(classes))

    rule("2. extraction schema derived from them")
    print(json.dumps(schema_builder.build_structures(classes), indent=2, ensure_ascii=False))

    rule("3. notes")
    notes = distill.list_notes(db)
    if not notes:
        print("No notes. Write one in the app first.")
        return 1
    if args.note:
        notes = [n for n in notes if str(n["id"]) == args.note]
        if not notes:
            print(f"note {args.note} not found")
            return 1
    elif not args.all:
        notes = notes[:1]
    for note in notes:
        print(f"  {note['id']}  {note['content'].replace(chr(10), ' ')[:64]}...")

    rule("4. extracting")
    started = time.perf_counter()
    model = extractor_mod.load(args.extractor)
    print(f"backend: {model.name} ({model.model_id})  loaded in {time.perf_counter() - started:.1f}s")

    total = 0
    for note in notes:
        started = time.perf_counter()

        if args.dry_run:
            rows = distill.post_pass(
                distill.extract_from_note(model, note["content"], classes)
            )
            elapsed = (time.perf_counter() - started) * 1000
            print(f"\n{note['id']}  {elapsed:.0f} ms  {len(rows)} would be proposed")
            for row in rows:
                print(f"  [{row['class_name']}] {row['confidence']:.2f}  {row['payload']}")
            total += len(rows)
            continue

        proposals = distill.distill_note(db, note["id"], model=model, classes=classes)
        elapsed = (time.perf_counter() - started) * 1000
        print(f"\n{note['id']}  {elapsed:.0f} ms  {len(proposals)} proposals")
        for proposal in proposals:
            print(f"  [{proposal['class_name']}] {proposal['confidence']:.2f}  {proposal['payload']}")
        total += len(proposals)

    rule("5. result")
    if args.dry_run:
        print(f"{total} proposals would be written (dry run - nothing was)")
    else:
        pending = db.query(
            f"SELECT count() FROM {distill.PROPOSAL_TABLE} WHERE status = 'pending' GROUP ALL;"
        )
        count = pending[0]["count"] if pending else 0
        print(f"{total} written this run; {count} pending in total.")
        print("Nothing has been committed to your classes - run review.py to approve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
