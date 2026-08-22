# The distillation harness - what it does, and how to verify it

**Run every command from the repository root** (`T:\Hackathons\Parallax`), not from this
directory. All paths below are relative to it.

**Shell:** commands are shown for **PowerShell**. Three things bite in PowerShell that do not
in bash:

- `curl` is an alias for `Invoke-WebRequest`, which does not understand `-u`, `-H`, `-d`.
  **Always write `curl.exe`** - the real curl, shipped with Windows.
- `\` is not a line continuation. Keep each command on one line.
- Double quotes expand `$variables`. **Wrap queries in single quotes** (see Part 3).

Every command and every query below was run before being written down.

---

## Part 1 - What the code actually does

The goal: turn a freeform note into structured database objects. That is the "distilled
note-taking" feature in [spec section 6](../../docs/spec.md). Five steps:

```
journal.txt
  |
  |  (1) stored as a Note row
  v
Note.content        <-- the original text, never modified
  |
  |  (2) split into paragraphs, each paragraph's start offset remembered
  v
"Around 2 we all met up at Victoria Park for Mei's birthday picnic..."
  |
  |  (3) GLiNER2 reads each paragraph
  v
{ name: "Mei's birthday picnic", location: "Victoria Park",
  people: ["Tom"], time: "2",
  confidence: 0.92, start: 409, end: 430 }
  |                              \________________/
  |                               character positions, remapped
  |                               from paragraph to whole note
  |
  |  (4) post-pass: drop low confidence, remove duplicates,
  |      normalise names ("Mei's" -> "Mei")
  v
Proposal rows   status = "pending"   <-- nothing committed yet
  |
  |  (5) review: approve or reject
  v
Person and Event rows, linked to each other and back to the Note
```

### The files

| File | Role |
|---|---|
| `schema.surql` | Defines four tables in the database itself: `Note`, `Person`, `Event`, `Proposal`. Types and constraints are enforced by SurrealDB, not by Python |
| `distill.py` | **The extractor.** Steps 2-4: chunk, run GLiNER2, clean up, write Proposals |
| `review.py` | Step 5. Turns approved Proposals into real `Person`/`Event` rows and resolves the links between them |
| `run_demo.py` | Runs the whole thing top to bottom, printing each stage |
| `test_harness.py` | 19 automated checks |
| `export_output.py` | Dumps one run to `output.json` for inspection |
| `determinism_check.py` | Measures whether the model gives the same answer twice |

### Three ideas worth understanding

**1. Nothing is trusted until reviewed.** `distill.py` never writes a `Person` or an `Event`.
It only writes `Proposal` rows marked `pending`; a separate approval step promotes them. A bad
extraction is therefore a queue item you can reject, never silent corruption of your data.

**2. Every extracted value carries its receipt.** GLiNER2 reports *character positions*, not
just text. `"Mei's birthday picnic"` arrives with `start: 409, end: 430` - characters 409 to 430
of the note. Because paragraphs are extracted separately, those positions are remapped back onto
the whole note. This is what would make click-to-highlight possible in a UI, and it is the thing
that cannot be faked, which is why the verification below leans on it.

**3. Links are real, not strings.** `Event.people` is not `["Tom", "Mum"]`. It holds *references*
to rows in the `Person` table, which the database can follow. That is what makes this a knowledge
graph rather than a spreadsheet.

### The one known flaw

GLiNER2's structured extraction is **not reproducible across runs**. Identical input, run twice,
can yield a different number of objects: `thesis defence` and `climbing` appear in some runs and
not others. Items above 0.9 confidence are stable. Measurements in [findings.md](findings.md).
**So the event count varies between runs. That is expected, not a broken install.**

---

## Part 2 - Verify it yourself

Ordered so each step trusts less of my code than the one before.

### 0. Start the database

```powershell
surreal start --user root --pass root --bind 127.0.0.1:8000 "rocksdb:$(pwd)/experiments/distill-harness/.data"
```

Leave it running in its own terminal. If `surreal` is not on PATH, use the full winget path:
`"$env:LOCALAPPDATA\Microsoft\WinGet\Packages\SurrealDB.SurrealDB_Microsoft.Winget.Source_8wekyb3d8bbwe\surreal.exe"`

The absolute `$(pwd)` matters: with a relative path the database lands wherever the server
happened to start, leaving a stray `.data/` in the repo root.

**If it exits immediately** with `Only one usage of each socket address ... (os error 10048)`,
an old server still holds port 8000. A client hitting that window fails inside
`socket.create_connection`, which looks like a broken harness. Fix:

```powershell
Get-Process surreal | Stop-Process -Force
```

Confirm it is up before continuing:

```powershell
curl.exe -s -o NUL -w "health: HTTP %{http_code}" http://127.0.0.1:8000/health
```

### 1. Watch the pipeline run

```powershell
uv run --with "gliner2[local]" --with surrealdb python experiments/distill-harness/run_demo.py
```

Seven numbered stages, ending with `Person` and `Event` objects read back out of the database.
Expect 5 people and 4-5 events (see the known flaw above).

`uv run` builds a temporary Python environment, installs `gliner2` (the `[local]` extra pulls in
PyTorch so the model runs on your machine) plus the SurrealDB driver, runs the script, then
discards the environment. Nothing is installed into the project.

This step still trusts my Python. The rest do not.

### 2. Query the database with no Python at all

> **Order matters.** `run_demo.py` and the test suite both wipe the database on start. Run
> `run_demo.py` immediately before querying. If you run the tests in between you will see
> `count: 0` and pending proposals - that is the test fixture, not a failure.

```powershell
curl.exe -s -X POST http://127.0.0.1:8000/sql -u root:root -H "surreal-ns: parallax" -H "surreal-db: harness" -H "Accept: application/json" -d "SELECT name, location, people.*.name AS attendees FROM Event ORDER BY name;"
```

Actual response:

```json
[{"result":[
  {"attendees":["Mum"],"location":"home","name":"Dinner"},
  {"attendees":["Tom","Mei's parents"],"location":"Victoria Park","name":"Mei's birthday picnic"},
  {"attendees":["Anna"],"location":"Café Lumen on Bridge Street","name":"breakfast"},
  {"attendees":["Dev"],"location":"Robinson Library","name":"stats problem set"},
  {"attendees":["Anna"],"location":null,"name":"thesis defence"}
],"status":"OK","time":"846.8µs"}]
```

`people.*.name` means "follow every link in `people` and fetch `name` from the row at the other
end". The database performs that traversal; my code is not running. If distillation had not
really written linked objects, this returns `[]`.

### 3. Run the tests

```powershell
uv run --with "gliner2[local]" --with surrealdb --with pytest python -m pytest experiments/distill-harness/test_harness.py -v
```

Expect `19 passed`, roughly 40-80 seconds.

### 4. Confirm the tests can actually fail

A green suite proves nothing if the assertions have no teeth. Break the offset remapping on
purpose - line 113 of `experiments/distill-harness/distill.py`, inside `extract_events`:

```python
def glob(v):
    return None if v is None else v          # was: para_start + v
```

Then:

```powershell
uv run --with "gliner2[local]" --with surrealdb --with pytest python -m pytest experiments/distill-harness/test_harness.py -q -k provenance
```

Actual result:

```
E  AssertionError: name='Dinner' does not sit at 0:6
   assert 'Saturd' == 'Dinner'
2 failed, 17 deselected
```

**Restore the line afterwards.**

### 5. Confirm the model reads *your* input

Edit `experiments/distill-harness/journal.txt` - rename Anna, or add a person - then rerun
step 1. The output must track your edit. (`test_output_tracks_a_mutated_input` automates this,
but doing it by hand is more convincing.)

---

## Part 3 - Queries to try

### PowerShell quoting: read this first

It causes two confusing errors.

**Use SINGLE quotes around every query.** PowerShell expands `$variables` inside double quotes,
so `$parent` silently becomes an empty string and SurrealDB replies:

```
Parse error: Unexpected token `.`, expected an expression
1 | SELECT name, (SELECT name FROM Event WHERE .id IN people) ...
```

Note the `.id` - the `$parent` is simply gone. Single quotes pass the text through untouched.
Write SurrealQL string literals with double quotes inside (`class_name = "Event"`); they nest
cleanly inside PowerShell single quotes.

**A query is not a command.** Typing `SELECT ...` at the prompt makes PowerShell look for a
program called `SELECT`, failing with `Select-Object ... ParameterBindingException`. Queries
must be passed to `curl.exe`, or to the `Q` helper below.

### The helper

Paste this once per session, on its own line, at a fresh prompt:

```powershell
function Q($sql) { curl.exe -s -X POST http://127.0.0.1:8000/sql -u root:root -H "surreal-ns: parallax" -H "surreal-db: harness" -H "Accept: application/json" -d $sql }
```

Every query below is then `Q '...'`.

### What is in the vault

```powershell
Q 'SELECT count() FROM Note GROUP ALL; SELECT count() FROM Person GROUP ALL; SELECT count() FROM Event GROUP ALL;'
```

1 note, 5 people, 5 events.

### Where did I go

```powershell
Q 'SELECT location, count() AS visits FROM Event WHERE location != NONE GROUP BY location;'
```

Café Lumen on Bridge Street, Robinson Library, Victoria Park, home.

### What did each person do - walking the graph backwards

```powershell
Q 'SELECT name, (SELECT name FROM Event WHERE $parent.id IN people) AS events FROM Person ORDER BY name;'
```

`Anna` -> thesis defence + breakfast; `Dev` -> stats problem set; `Mum` -> Dinner.

Follows the links in reverse, person to events, with no join table. `$parent` refers to the
outer row - hence the single quotes.

### Who shows up most

```powershell
Q 'SELECT name, array::len((SELECT id FROM Event WHERE $parent.id IN people)) AS events FROM Person ORDER BY events DESC;'
```

Anna 2, everyone else 1.

### How confident was the model

```powershell
Q 'SELECT class_name, payload.name AS thing, confidence FROM Proposal ORDER BY confidence DESC LIMIT 6;'
```

`Mum` 0.992, `Anna` 0.959, `Dinner` 0.957 ... compare with the flaky ones near 0.5.

### The audit trail - what was proposed, and what it became

```powershell
Q 'SELECT class_name, payload.name AS proposed, status, committed FROM Proposal WHERE class_name = "Event";'
```

Every proposal, its status, and the id of the object it created.

### Trace an event back to the note it came from

```powershell
Q 'SELECT name, source.content AS came_from FROM Event LIMIT 1;'
```

The full original journal text.

### The strongest check: make the database prove provenance

```powershell
Q 'SELECT payload.name AS extracted, string::slice(note.content, provenance.name.start, provenance.name.end) AS quoted_from_note FROM Proposal WHERE class_name = "Event";'
```

Actual result:

```json
{"extracted":"breakfast",             "quoted_from_note":"breakfast"},
{"extracted":"thesis defence",        "quoted_from_note":"thesis defence"},
{"extracted":"stats problem set",     "quoted_from_note":"stats problem set"},
{"extracted":"Mei's birthday picnic", "quoted_from_note":"Mei's birthday picnic"},
{"extracted":"Dinner",                "quoted_from_note":"Dinner"}
```

This is the one to keep. The database re-reads the original note at the character positions
stored with each proposal and returns what it finds there. Both columns match on every row, so
every extracted value really does come from that exact span of your text. No Python, no model,
no trust required - fabricated output could not survive it.

(`string::slice(text, start, end)` takes an **end index**, not a length. The length form
silently returns `""` instead of erroring.)

### Prove enforcement lives in the database

```powershell
Q 'CREATE Person SET name = 12345;'
```

Returns `Couldn't coerce value for field 'name' of 'Person:...': Expected 'string' but found
'12345'` - rejected by SurrealDB with no Python in the loop. That is
[spec section 3](../../docs/spec.md)'s "smart database, dumb client" in practice.

---

## What each step proves

| Step | Proves | Trusts my code? |
|---|---|---|
| 1 | the pipeline runs end to end | yes |
| 2 | objects exist in the DB and links resolve | **no** |
| 3 | documented behaviour holds | yes |
| 4 | the tests can fail | **no** |
| 5 | a model read your text | **no** |
| Part 3 provenance query | every value came from a real span of the note | **no** |
| Part 3 enforcement query | the schema is enforced by the database | **no** |
