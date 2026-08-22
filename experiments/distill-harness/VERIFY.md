# Verifying the harness yourself

**Run every command from the repository root** (`T:/Hackathons/Parallax`), not from this
directory. All paths below are relative to it. Running them from inside
`experiments/distill-harness/` fails with `can't open file ... run_demo.py:
[Errno 2] No such file or directory`.

Every command here was run before being written down. The point of the ordering is
that each step trusts less of my code than the one before it, ending with checks
that would catch me if the results were faked.

## 0. Start the database

```bash
surreal start --user root --pass root --bind 127.0.0.1:8000 "rocksdb:$(pwd)/experiments/distill-harness/.data"
```

The absolute `$(pwd)` matters: with a relative path the database lands wherever the
server happened to be started, so a stray `.data/` can appear in the repo root.

Leave it running in its own terminal. If `surreal` is not on PATH, use the full
path from `winget`:
`"$LOCALAPPDATA/Microsoft/WinGet/Packages/SurrealDB.SurrealDB_Microsoft.Winget.Source_8wekyb3d8bbwe/surreal.exe"`

If it exits immediately with `Only one usage of each socket address ... (os error
10048)`, port 8000 is already held by an earlier server. Find and stop it:

```powershell
Get-Process surreal | Stop-Process
```

A client connecting during that window fails inside `socket.create_connection`;
confirm the server is up before continuing:

```bash
curl -s -m 5 -o /dev/null -w "health: HTTP %{http_code}" http://127.0.0.1:8000/health
```

## 1. Watch the pipeline run

```bash
uv run --with "gliner2[local]" --with surrealdb python experiments/distill-harness/run_demo.py
```

Seven numbered steps: schema, insert Note, distill, provenance check, review,
read objects back, resolve links. Expect roughly 5 `Person` and 4-5 `Event`.

**The event count varies between runs.** That is the documented non-determinism
(see findings.md), not a broken install. The four high-confidence events -
breakfast, stats problem set, Mei's birthday picnic, Dinner - appear every time.

This step still trusts my Python. The next one does not.

## 2. Query the database with no Python at all

> **Order matters.** `run_demo.py` and the pytest suite both wipe the database on
> start. Run `run_demo.py` immediately before these queries - if you run pytest in
> between, you will see `count: 0` and pending proposals, because the last test left
> the DB in its own state. That is the test fixture, not a broken harness.

With `run_demo.py` freshly run, ask SurrealDB directly over HTTP:

```bash
curl -s -X POST http://127.0.0.1:8000/sql -u root:root \
  -H "surreal-ns: parallax" -H "surreal-db: harness" \
  -H "Accept: application/json" \
  -d "SELECT name, location, people.*.name AS attendees FROM Event ORDER BY name;"
```

Actual response:

```json
[{"result":[
  {"attendees":["Mum"],"location":"home","name":"Dinner"},
  {"attendees":["Tom","Mei's parents"],"location":"Victoria Park","name":"Mei's birthday picnic"},
  {"attendees":["Anna"],"location":"Café Lumen on Bridge Street","name":"breakfast"},
  {"attendees":["Dev"],"location":"Robinson Library","name":"stats problem set"}
],"status":"OK","time":"1.0555ms"}]
```

This is the load-bearing check. The rows come from the database engine, not from
my script's print statements, and `attendees` is SurrealDB dereferencing
`record<Person>` links on its own. If distillation had not really written
objects, this query would return `[]`.

Interesting variants:

```bash
# how many of each class exist -> {"count":5} and {"count":5}
-d "SELECT count() FROM Person GROUP ALL; SELECT count() FROM Event GROUP ALL;"

# every event traced back to the note it came from
-d "SELECT name, source.content AS came_from FROM Event LIMIT 1;"

# the review trail: what was proposed, and what it became
-d "SELECT class_name, status, payload.name, committed FROM Proposal;"
```

## 3. Run the tests

```bash
uv run --with "gliner2[local]" --with surrealdb --with pytest python -m pytest experiments/distill-harness/test_harness.py -v
```

Expect `19 passed` in roughly 80 seconds.

## 4. Confirm the tests have teeth

A passing suite proves nothing if the tests cannot fail. Break the offset
remapping on purpose - line 113 of experiments/distill-harness/distill.py, inside `extract_events`:

```python
def glob(v):
    return None if v is None else v          # was: para_start + v
```

Then:

```bash
uv run --with "gliner2[local]" --with surrealdb --with pytest python -m pytest experiments/distill-harness/test_harness.py -q -k provenance
```

Actual result - the provenance tests fail immediately and specifically:

```
E  AssertionError: name='Dinner' does not sit at 0:6
   assert 'Saturd' == 'Dinner'
2 failed, 17 deselected
```

Restore the line afterwards. This is the check that makes the rest credible:
provenance offsets are only self-consistent if a model actually read this exact
text. Fabricated output cannot satisfy it.

## 5. Confirm the model reads your input, not a script

Edit `experiments/distill-harness/journal.txt` - rename Anna to something else, or add a person - then rerun
step 1. The extracted objects must track your edit. `test_output_tracks_a_mutated_input`
automates exactly this, but doing it by hand is more convincing.

## 6. Confirm nothing commits without review

```bash
curl -s -X POST http://127.0.0.1:8000/sql -u root:root \
  -H "surreal-ns: parallax" -H "surreal-db: harness" -H "Accept: application/json" \
  -d "SELECT status, count() FROM Proposal GROUP BY status;"
```

Distillation only ever writes `status="pending"` rows; `Person` and `Event` stay
empty until `review.approve_all` runs. `test_distillation_writes_nothing_until_approved`
asserts this, and spec section 6 requires it.

## 7. Confirm the database enforces the schema, not Python

```bash
curl -s -X POST http://127.0.0.1:8000/sql -u root:root \
  -H "surreal-ns: parallax" -H "surreal-db: harness" -H "Accept: application/json" \
  -d "CREATE Person SET name = 12345;"
```

Returns an error from SurrealDB, with no Python in the loop - which is what
spec section 3's "smart database, dumb client" means in practice.

## What each step actually proves

| Step | Proves | Trusts my code? |
|---|---|---|
| 1 | the pipeline runs end to end | yes |
| 2 | objects exist in the database, links resolve | **no** |
| 3 | the documented behaviour holds | yes |
| 4 | the tests can fail | **no** |
| 5 | a model read your text | **no** |
| 6 | nothing commits without review | partly |
| 7 | enforcement is in the DB | **no** |
