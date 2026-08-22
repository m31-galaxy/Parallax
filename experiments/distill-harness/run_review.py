"""Review pending proposals and commit them into the user's classes.

    uv run --with surrealdb python experiments/distill-harness/run_review.py --database journal
    ... --approve-all          commit everything that can be committed
    ... --reject <proposal id> reject one
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from surrealdb import Surreal  # noqa: E402

import review  # noqa: E402
import schema_builder  # noqa: E402

URL = "ws://127.0.0.1:8000/rpc"
NS = "parallax"


def rule(title):
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="journal")
    parser.add_argument("--approve-all", action="store_true")
    parser.add_argument("--reject")
    args = parser.parse_args()

    db = Surreal(URL)
    db.signin({"username": "root", "password": "root"})
    db.use(NS, args.database)
    print(f"connected to {NS}/{args.database}")

    classes = schema_builder.load_classes(db)

    if args.reject:
        review.reject(db, args.reject)
        print(f"rejected {args.reject}")
        return 0

    rule("pending proposals")
    queue = review.pending(db)
    if not queue:
        print("Nothing pending. Run run_distill.py first.")
        return 0

    for proposal in queue:
        cls = next((c for c in classes if c.name == proposal["class_name"]), None)
        print(f"\n{proposal['id']}  [{proposal['class_name']}]  {proposal['confidence']:.2f}")
        if cls is None:
            print("    class no longer exists")
            continue

        values, unparsed, missing = review.coerce_payload(proposal["payload"], cls.fields)
        for name, value in values.items():
            print(f"    {name:<16} {value!r}")
        for name, problem in unparsed.items():
            print(f"    {name:<16} UNPARSED {problem['text']!r} - {problem['reason']}")
        if missing:
            print(f"    BLOCKED: missing required {', '.join(missing)}")

    if not args.approve_all:
        rule("nothing committed")
        print("Re-run with --approve-all to commit the ones that are ready.")
        return 0

    rule("committing")
    committed, failures = review.approve_all(db, classes=classes)
    for row in committed:
        print(f"  created {row['id']}")
    for proposal, reason in failures:
        print(f"  held    {proposal['id']}: {reason}")

    rule("your classes now contain")
    for cls in classes:
        rows = db.query(f"SELECT * FROM {cls.name};") or []
        print(f"\n{cls.plural} ({len(rows)}):")
        for row in rows:
            shown = {k: v for k, v in row.items() if k != "id"}
            print(f"  {shown}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
