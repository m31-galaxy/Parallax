# Distillation harness — findings

**Date:** 2026-08-22 · **Model:** `fastino/gliner2-base-v1`, stock (no fine-tuning) ·
**DB:** SurrealDB 3.2.0, local, file-backed · **Hardware:** CPU only.

Answers the question the smoke test could not: *was GLiNER2 actually run as a distillation
extractor?* Previously no — it read a `.txt` and printed JSON. Now there is a real pipeline:
`Note` in SurrealDB → chunk → GLiNER2 → post-pass → `Proposal` → review → committed
`Person`/`Event` objects.

## Result: the pipeline works

`run_demo.py` produces, and reads back **out of SurrealDB**, 5 `Person` and 5 `Event` rows
([demo_output.txt](demo_output.txt)):

| Event | location | time | people (record links) |
|---|---|---|---|
| breakfast | Café Lumen on Bridge Street | 9 | Anna |
| stats problem set | Robinson Library | late morning | Dev |
| Mei's birthday picnic | Victoria Park | 2 | Tom, Mei's parents |
| Dinner | home | — | Mum |
| thesis defence | — | — | Anna |

`Event.people` are genuine `record<Person>` links, dereferenced by the database itself, and
every `Event.source` points back to its originating `Note`.

**19/19 tests pass** (`test_harness.py`), covering provenance, mutation-tracking, chunking,
post-pass, review-before-commit, entity-resolution idempotency, and DB-level schema enforcement.

## The significant finding: GLiNER2 is NOT deterministic

The sponsor analysis lists GLiNER2 as *"Deterministic: Yes"* (encoder, not generative), and the
smoke-test write-up repeated that. **It is false for the structured-extraction task.**

Same 842-char input (SHA-verified identical), two separate processes:

```
run 1: breakfast 0.9199 · thesis defence 0.7713 · stats problem set 0.6088 · stats problem set 0.6632
       · Mei's birthday picnic 0.9232 · climbing 0.5150 · Dinner 0.9608
run 2: breakfast 0.9204 · breakfast 0.5225 · stats problem set 0.5668 · stats problem set 0.6526
       · Mei's birthday picnic 0.9154 ·                    · Dinner 0.9611
```

`climbing` and `thesis defence` appear in one run and vanish in the next. This persists with
`torch.set_num_threads(1)`, `torch.manual_seed(0)`, and `torch.use_deterministic_algorithms(True)`
— so it is not thread scheduling or an unseeded RNG. The likely cause is the variable-length
object-counting head (`count_lstm_v2` in the model config), which decides *how many* objects to
emit; small float variation near a decision boundary changes the object count.

**The structure of the instability matters:**

| Band | Behaviour |
|---|---|
| **> 0.9** (breakfast, picnic, Dinner) | Stable across every run; confidences vary only in the 3rd decimal |
| **0.5 – 0.7** (climbing, thesis defence, duplicate breakfast) | Flickers in and out between runs |

So the *high-confidence core is reliable*; the tail is not. `CONF_FLOOR = 0.60` sits directly in
the unstable band, which is why the demo run committed `thesis defence` (0.79 that run) while a
later run scored it 0.51 and dropped it. Entity extraction (task 1 in the smoke test) was stable
across every run observed; this affects structured extraction specifically.

### Consequences

1. **`test_extraction_is_deterministic` only holds within a single process.** It passes because
   the model is loaded once per session. Cross-process, it would fail. The test is honest about
   its scope but the property is weaker than advertised.
2. **A confidence threshold is the wrong sole filter** when the threshold sits in the unstable
   band. Options: raise the floor to ~0.85 (loses real events), or run N passes and keep objects
   appearing in a majority (costs N× latency, ~3 s per pass).
3. **This strengthens the case for fine-tuning.** Tightening the confidence distribution — pushing
   real events above the noise band — is exactly what training on in-domain examples does, and it
   gives the Pioneer eval a concrete, measurable target beyond raw accuracy: *run-to-run stability*.
4. **It does not undermine the architecture.** Proposals go through review before commit (spec §6),
   so an unstable tail surfaces as a review-queue item, never as silent corruption of user data.

## Other observations

- **Latency:** model load 10.9 s (once); distillation **3.1 s** for a 4-paragraph, 842-char note
  on CPU (~780 ms/paragraph, including proposal writes). Fine for the manual trigger spec §6
  specifies; too slow for on-every-keystroke.
- **The post-pass earns its place.** Raw output for one run: 7 events, including a `Saturday 22
  August` artefact built from the date header and a doubled `breakfast`/`stats problem set`.
  After filtering and dedup: 4–5 clean events.
- **Entity resolution works but is crude.** `Mei's` → `Mei` via possessive stripping; approving
  the same person twice merges aliases rather than duplicating. But `Mei's parents` becomes a
  single `Person` named "Mei's parents" — a group, not an individual. No model provides this
  step; it needs real design.
- **`location` conflates venue and street** ("Café Lumen on Bridge Street"). Unnormalised.
- **SurrealDB enforcement is genuine.** Wrong types, unknown fields, invalid enum values, and
  dangling record links are all rejected by the database, with Python doing no validation. This
  confirms spec §3's "smart database, dumb client" is achievable as literally as stated.
- **SurrealDB 3.x syntax note:** `DEFINE FIELD ... TYPE object FLEXIBLE`, not `FLEXIBLE TYPE`.

## What this means for spec §12

The open question *"LLM provider / extraction model for distillation"* now has evidence:

- GLiNER2 **can** drive distillation end to end, locally, on CPU, free, with provenance offsets
  that make a review UI possible.
- It is **not deterministic** for structured extraction, so any claim built on that property
  (caching by content hash, "re-running is a no-op", reproducible proposals) must be dropped or
  defended by a majority-vote pass.
- The failure modes (unstable tail, unnormalised locations, group-vs-person confusion) are all
  plausible fine-tuning targets rather than dead ends.

**No decision recorded in `docs/spec.md`** — that remains the owner's call.

## Not tested

Fine-tuning/LoRA, an LLM baseline comparison, the life-tracker sheet, multi-note vaults,
long notes needing `extract_entities_long`, relation extraction, and the Svelte UI.

## Reproducing

```bash
surreal start --user root --pass root --bind 127.0.0.1:8000 "rocksdb:.data"
uv run --with "gliner2[local]" --with surrealdb python run_demo.py
uv run --with "gliner2[local]" --with surrealdb --with pytest python -m pytest test_harness.py -v
```
