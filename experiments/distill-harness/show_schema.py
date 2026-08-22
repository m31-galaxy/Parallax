"""Print the extraction schema derived from the classes in a live database.

Nothing here names a field: run it against any Parallax database and it reports
whatever classes that user defined. That is the whole point of the change.

    uv run --with surrealdb python experiments/distill-harness/show_schema.py [database]
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from surrealdb import Surreal  # noqa: E402

import schema_builder  # noqa: E402

URL = "ws://127.0.0.1:8000/rpc"
NS = "parallax"


def main():
    database = sys.argv[1] if len(sys.argv) > 1 else "journal"

    db = Surreal(URL)
    db.signin({"username": "root", "password": "root"})
    db.use(NS, database)
    print(f"connected to {NS}/{database}\n")

    classes = schema_builder.load_classes(db)

    print("CLASSES FOUND (read from parallax_class + INFO FOR TABLE)")
    print("=" * 72)
    print(schema_builder.describe(classes))

    print("\nEXTRACTION SCHEMA SENT TO THE MODEL")
    print("=" * 72)
    print(json.dumps(schema_builder.build_structures(classes), indent=2, ensure_ascii=False))

    notes = db.query("SELECT id, created, content FROM Note ORDER BY created DESC LIMIT 3") or []
    print(f"\nNOTES AVAILABLE TO DISTIL: {len(notes)}")
    print("=" * 72)
    for note in notes:
        preview = note["content"].replace("\n", " ")[:70]
        print(f"  {note['id']}  {preview}...")


if __name__ == "__main__":
    main()
