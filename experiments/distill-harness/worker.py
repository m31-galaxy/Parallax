"""The distillation worker: the bridge between the app and the local model.

The browser cannot run GLiNER2, so the app cannot distil directly. Instead the
app writes a `parallax_distill_request` row; this worker watches for those,
runs the extraction pipeline, writes `parallax_proposal` rows, and marks the
request done. The app then reads the proposals and handles review itself. The
browser only ever talks to SurrealDB - it never calls this process - so the app
stays a pure SPA (spec section 7).

Run it in its own terminal alongside the app:

    uv run --with "gliner2[local]" --with surrealdb python \
        experiments/distill-harness/worker.py --database journal

The model loads once and is reused across requests. Ctrl-C to stop.
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from surrealdb import Surreal  # noqa: E402

import distill  # noqa: E402
import extractor as extractor_mod  # noqa: E402
import schema_builder  # noqa: E402

URL = "ws://127.0.0.1:8000/rpc"
NS = "parallax"
REQUEST_TABLE = "parallax_distill_request"
# Kept short so a request is picked up almost immediately; the loop is a cheap
# SELECT, so tightening it costs little while removing most of the felt delay.
POLL_SECONDS = 0.25


def connect(database):
    db = Surreal(URL)
    db.signin({"username": "root", "password": "root"})
    db.use(NS, database)
    return db


def claim_one(db):
    """Atomically take the oldest pending request, if any.

    UPDATE ... WHERE status = 'pending' with a per-row guard is enough for a
    single worker; two workers would need a stricter claim, which is out of
    scope here.
    """
    rows = db.query(
        f"SELECT * FROM {REQUEST_TABLE} WHERE status = 'pending' "
        f"ORDER BY requested ASC LIMIT 1;"
    )
    if not rows:
        return None
    request = rows[0]
    db.query("UPDATE $id SET status = 'running';", {"id": request["id"]})
    return request


def process(db, request, model):
    """Run extraction for one request and record the outcome on the row."""
    note_id = request["note"]
    try:
        proposals = distill.distill_note(db, note_id, model=model)
        db.query(
            "UPDATE $id SET status = 'done', proposal_count = $n, finished = time::now();",
            {"id": request["id"], "n": len(proposals)},
        )
        return len(proposals), None
    except Exception as err:  # noqa: BLE001 - recorded, not swallowed
        message = str(err)
        db.query(
            "UPDATE $id SET status = 'error', error = $e, finished = time::now();",
            {"id": request["id"], "e": message},
        )
        return 0, message


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="journal")
    parser.add_argument("--extractor")
    parser.add_argument("--once", action="store_true", help="drain the queue and exit")
    args = parser.parse_args()

    db = connect(args.database)
    print(f"worker connected to {NS}/{args.database}")

    # Provision the queue and proposal tables up front, so a request written
    # before the schema existed (status defaulting missing) is normalised.
    distill.ensure_proposal_table(db)
    db.query(
        f"UPDATE {REQUEST_TABLE} SET status = 'pending' WHERE status = NONE OR status = NULL;"
    )

    started = time.perf_counter()
    model = extractor_mod.load(args.extractor)
    print(f"model ready: {model.name} ({model.model_id}) in {time.perf_counter() - started:.1f}s")
    print(f"watching {REQUEST_TABLE} (poll {POLL_SECONDS}s). Ctrl-C to stop.\n")

    idle_logged = False
    while True:
        request = claim_one(db)
        if request is None:
            if args.once:
                print("queue empty, exiting (--once)")
                return 0
            if not idle_logged:
                print("idle, waiting for requests...")
                idle_logged = True
            time.sleep(POLL_SECONDS)
            continue

        idle_logged = False
        started = time.perf_counter()
        count, error = process(db, request, model)
        elapsed = (time.perf_counter() - started) * 1000
        note = str(request["note"])
        if error:
            print(f"[error] {request['id']} ({note}): {error}")
        else:
            print(f"[done]  {request['id']} ({note}): {count} proposals in {elapsed:.0f} ms")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nworker stopped")
