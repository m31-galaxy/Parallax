# Verifying dynamic distillation (Phases 1-3)

The claim: a note is distilled into **the classes the user defined in the app**,
with nothing about their data hardcoded in Python. Everything below was run
before being written down.

**Run from the repository root**, PowerShell. `curl` -> `curl.exe`. Queries in
single quotes.

## Setup (once)

```powershell
# database, outside the repo so Vite's watcher ignores it
surreal start --user root --pass root --bind 127.0.0.1:8000 "rocksdb:C:/Users/Welcome/.parallax/demo-db"
# the app, in another terminal
npx vite dev --port 5173
```

The database, the `Person` class, and the sample note already exist from this
session. To start clean, delete the class in the app and make your own - the
whole point is that the field names are yours.

Helper for the queries:

```powershell
function Q($sql) { curl.exe -s -X POST http://127.0.0.1:8000/sql -u root:root -H "surreal-ns: parallax" -H "surreal-db: journal" -H "Accept: application/json" -d $sql }
```

## Phase 1 - the schema comes from your classes

```powershell
uv run --with surrealdb python experiments/distill-harness/show_schema.py journal
```

Every field it prints is one you typed into the class designer. Prove it: add a
field to `Person` in the app (Schema tab), rerun, and it appears - with no code
change. `derived:` means the description was made from the field name;
once field hints ship it becomes `hint:`.

## Phase 2 - distil a note into proposals

```powershell
uv run --with "gliner2[local]" --with surrealdb python experiments/distill-harness/run_distill.py --database journal
```

Writes `parallax_proposal` rows, all `status = pending`. It commits nothing to
your classes. Confirm with no Python in the loop:

```powershell
Q 'SELECT class_name, status, confidence, payload FROM parallax_proposal;'
Q 'SELECT count() FROM Person GROUP ALL;'   # still 0 - nothing committed yet
```

`--dry-run` shows what would be proposed without writing. `--extractor pioneer`
switches backend (needs a working key and PARALLAX_EXTRACTOR or the flag).

**Expect the event count to vary between runs** - GLiNER2 structured extraction
is not reproducible (see findings.md). That is the model, not a bug.

## Phase 3 - review and commit into your class

Preview without committing:

```powershell
uv run --with surrealdb python experiments/distill-harness/run_review.py --database journal
```

Commit the ones that are ready:

```powershell
uv run --with surrealdb python experiments/distill-harness/run_review.py --database journal --approve-all
```

Then confirm the objects landed in **your** class, straight from the database:

```powershell
Q 'SELECT first_name, last_name, occupation, met_on FROM Person;'
```

### The three behaviours worth checking

1. **Type coercion.** `met_on` extracted as `"3 September"` is committed as a
   real datetime (`2026-09-03T00:00:00Z`), not a string.
2. **Nothing dropped silently.** `met_on` extracted as `"Coffee"` cannot be a
   date, so it is kept on the proposal as `unparsed` for you to fix - never
   committed as a wrong value:

    ```powershell
    Q 'SELECT class_name, status, unparsed FROM parallax_proposal WHERE unparsed != {};'
    ```

3. **Required fields gate the commit.** A proposal missing a required field
   (here `first_name`) stays `pending` with a reason, rather than being forced
   in for the database to reject:

    ```powershell
    Q 'SELECT id, status FROM parallax_proposal WHERE status = "pending";'
    ```

### See it in the app

Objects committed here show up in the normal object table at
`http://localhost:5173/classes/Person` - distillation and manual creation write
the same rows.

## Reject a proposal

```powershell
uv run --with surrealdb python experiments/distill-harness/run_review.py --database journal --reject <proposal-id>
```

Status becomes `rejected`; it is kept on record, never committed.

## What is NOT done yet

- **Field hints in the class designer** (Phase 4) - the descriptions are still
  derived from field names, which is why extraction quality is rough.
- The in-app review UI - this is all headless Python for now.
- Entity resolution - "Anna Whitfield" and a later "Anna" are two people here.
