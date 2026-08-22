# Distillation harness — findings

**Date:** 2026-08-22 · **Model:** `fastino/gliner2-base-v1`, stock (no fine-tuning) ·
**DB:** SurrealDB 3.2.0, local, file-backed · **Hardware:** CPU only.

Answers the question the smoke test could not: _was GLiNER2 actually run as a distillation
extractor?_ Previously no — it read a `.txt` and printed JSON. Now there is a real pipeline:
`Note` in SurrealDB → chunk → GLiNER2 → post-pass → `Proposal` → review → committed
`Person`/`Event` objects.

## Result: the pipeline works

`run_demo.py` produces, and reads back **out of SurrealDB**, 5 `Person` and 5 `Event` rows
([demo_output.txt](demo_output.txt)):

| Event                 | location                    | time         | people (record links) |
| --------------------- | --------------------------- | ------------ | --------------------- |
| breakfast             | Café Lumen on Bridge Street | 9            | Anna                  |
| stats problem set     | Robinson Library            | late morning | Dev                   |
| Mei's birthday picnic | Victoria Park               | 2            | Tom, Mei's parents    |
| Dinner                | home                        | —            | Mum                   |
| thesis defence        | —                           | —            | Anna                  |

`Event.people` are genuine `record<Person>` links, dereferenced by the database itself, and
every `Event.source` points back to its originating `Note`.

**19/19 tests pass** (`test_harness.py`), covering provenance, mutation-tracking, chunking,
post-pass, review-before-commit, entity-resolution idempotency, and DB-level schema enforcement.

## The significant finding: GLiNER2 structured extraction is NOT deterministic

Measured properly in [determinism_check.py](determinism_check.py): 6 trials, each a **fresh
process** reloading the weights, identical SHA-verified input, torch pinned with
`manual_seed(0)`, `set_num_threads(1)`, `use_deterministic_algorithms(True)`. Full transcript in
[determinism_log.txt](determinism_log.txt), raw per-trial data in [determinism.json](determinism.json).

```
structured extraction : 6 distinct results in 6 trials -> NOT DETERMINISTIC
   ignoring scores    : 3 distinct object sets -> the SET of objects changes
entity extraction     : 1 distinct result  in 6 trials -> DETERMINISTIC (bit-for-bit)

per-object stability (appearances/trials):
  6/6  stable    conf 0.915-0.927   Mei's birthday picnic
  6/6  stable    conf 0.951-0.961   Dinner
  6/6  stable    conf 0.501-0.932   breakfast
  6/6  stable    conf 0.567-0.691   stats problem set
  4/6  FLICKERS  conf 0.792-0.812   thesis defence
  3/6  FLICKERS  conf 0.505-0.513   climbing
  1/6  FLICKERS  conf 0.525         Saturday 22 August   (the header artefact)
```

Key refinements over the first observation:

1. **The instability is in the object count, not the scores.** Confidences drift only in the
   third decimal within a trial set; what changes is _whether an object is emitted at all_.
   This points at the variable-length counting head (`count_lstm_v2`), which decides how many
   objects each paragraph yields, flipping near a boundary. Within one process the count is
   stable; across weight reloads it is not - suggesting load-order/memory-layout sensitivity
   in float accumulation rather than RNG (which was pinned).
2. **Flicker is not confined below 0.7:** `thesis defence` scores ~0.80 in the trials where it
   appears at all, and still vanished in 2 of 6. A confidence threshold therefore cannot fully
   de-flake structured output - presence itself is unstable.
3. **Entity extraction is genuinely deterministic** - all 15 spans byte-identical across all 6
   fresh processes. The claim in the sponsor analysis is true for NER and false for structured
   extraction.
4. **Duplicates are systematic, not random:** `stats problem set` appears twice in every single
   trial (same span, different confidences), so the post-pass dedup is load-bearing, not
   defensive.

### Consequences

1. **A confidence threshold is not a sufficient filter** - presence flickers at ~0.8. If stable
   output matters, options are: majority-vote over N runs (N× latency), entity-first pipelines
   (use the deterministic NER head and assemble objects in code), or fine-tuning to push
   in-domain objects deep into the stable band.
2. **Reproducibility claims must be scoped:** within-process caching is safe; cross-process
   caching by content hash is not.
3. **This strengthens the fine-tuning case** and gives the Pioneer eval a second measurable
   axis: run-to-run stability, not just accuracy.
4. **The architecture absorbs it:** proposals pass through review before commit (spec §6), so
   an unstable tail is a review-queue artefact, never silent data corruption.

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

The open question _"LLM provider / extraction model for distillation"_ now has evidence:

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
