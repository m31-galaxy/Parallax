"""SurrealDB connection + schema helpers for the distillation harness."""

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from surrealdb import Surreal  # noqa: E402

URL = "ws://127.0.0.1:8000/rpc"
NS, DB = "parallax", "harness"
USER, PASS = "root", "root"

SCHEMA = Path(__file__).parent / "schema.surql"


def connect():
    """Open an authenticated connection to the harness namespace/database."""
    db = Surreal(URL)
    db.signin({"username": USER, "password": PASS})
    db.use(NS, DB)
    return db


def apply_schema(db):
    """(Re)apply schema.surql. Idempotent — DEFINE overwrites."""
    db.query(SCHEMA.read_text(encoding="utf-8"))


def reset(db):
    """Wipe all harness data so runs are reproducible."""
    for table in ("Proposal", "Event", "Person", "Note"):
        db.query(f"REMOVE TABLE IF EXISTS {table};")
    apply_schema(db)
