# Parallax — TODO / Backlog

> All new tasks, deferred actions, backlog items, and future planned features are
> recorded in **this file**. Design decisions live in [spec.md](spec.md) — when a
> task here requires an undecided design decision, ask the owner and record the
> answer in the spec first.

## Decisions to discuss with the owner

- [x] **LLM provider / extraction model for distillation** — resolved
      (2026-08-22) to **GLiNER2** (`fastino/gliner2-base-v1`), local weights or
      Pioneer-hosted, on the `experiment/dynamic-distill` branch; recorded in
      spec.md (§6, §11). Owner ratifies by merging that branch's PR.
- [ ] **Test tooling** (Vitest vs `bun test` vs split) — deferred (2026-08-22)
      until the first tests are written.
- [x] **Formatting tooling** — Prettier chosen and configured (2026-08-22);
      see spec.md §7.
- [x] **Linting tooling** — ESLint chosen and configured, type-aware
      (2026-08-22); see spec.md §7.
- [x] **Automated checks** — git `pre-commit` hook and Claude Code agent hooks
      wired to Prettier, ESLint, and svelte-check (2026-08-22); see spec.md §7.
- [x] **Enforce the §4 naming convention** (`PascalCase` classes, `snake_case`
      fields) as validation in the class designer — deliberately not an ESLint
      rule (2026-08-22), since the convention governs user-defined database
      schemas at runtime, not TypeScript identifiers. Implemented 2026-08-22.

- [ ] **SurrealDB live queries (`LIVE SELECT`)** as the structural
      perceived-performance and collaboration play: subscribe per opened
      class so data stays hot and updates in real time, eliminating loading
      states more thoroughly than any prefetch. Proposed 2026-08-22 during
      the preloading discussion — owner has not yet decided.

## v0.1 — Foundation (current milestone)

- [x] Scaffold: SvelteKit static/SPA app at repo root, Bun tooling, surrealdb SDK (2026-08-22)
- [x] Connect flow: two-step connect (server auth → database pick/create), all auth
      levels + anonymous, localStorage profiles with opt-in remember, gate route + auto-reconnect (2026-08-22; spec §8)
- [x] Class designer: create + extend classes (singular/plural names, core-scalar
      fields, required toggle), SCHEMAFULL tables + `parallax_class` meta table,
      sidebar app shell, naming validation (2026-08-22; spec §4)
- [x] Object CRUD: objects-first class page (list/create/edit/delete) with
      schema-driven forms; designer moved to a Schema tab (2026-08-22; spec §4)
- [x] Note capture: card-style capture UI (quick capture, card grid, in-place
      edit) over an auto-provisioned built-in Note class with DB-enforced
      `created` (2026-08-22; spec §5) — **v0.1 Foundation complete**

## v0.2 — Distillation

- [x] Build distillation v1: manual trigger per note + review (approve/reject)
      before commit — per spec §6 (2026-08-22, `experiment/dynamic-distill`).
      Note-card `Distil` button → database-queued request → local worker runs
      GLiNER2 → proposals reviewed and committed in-app, with type coercion.
- [ ] **Edit in the review step**: v1 supports approve/reject only; spec §6's
      "approve/edit/reject" wants inline editing of a proposal's fields before
      committing.
- [ ] **Package/launch the worker**: it currently runs by hand
      (`experiments/distill-harness/worker.py`); the app shows a "worker must be
      running" state when it is absent. Decide how it ships — bundled with the
      Tauri app, a documented dev command, or auto-started.
- [ ] **Entity resolution**: no sponsor/model provides it — repeated mentions of
      one entity ("Andy" in two sentences) become two objects. Needs a
      canonicalisation pass (alias match + merge) before the graph is useful.
- [ ] **GLiNER2 structured extraction is non-deterministic across runs**: objects
      near the confidence floor appear and vanish between identical runs
      (measured in `experiments/distill-harness/findings.md`). Decide the
      mitigation — raise the floor, majority-vote over N runs, or fine-tune —
      before anything assumes reproducible proposals.
- [ ] **Fine-tune GLiNER2** on real notes for the Pioneer side challenge:
      synthetic/real dataset → LoRA fine-tune → eval vs an LLM baseline on
      accuracy, latency, and cost. The swappable Pioneer backend is the path in.
- [ ] After v1 ships: experiment with alternative trigger/commit models
      (auto-trigger on save, proposal inbox, auto-commit with revert) and revisit
      the spec decision.

## Known issues / polish

- [ ] Editing a Note through the generic object form can trip the readonly
      `created` field: `datetime-local` truncates seconds, so the resubmitted
      value differs and the database rejects it (2026-08-22). Related to the
      datetime-precision item below; consider omitting readonly fields from
      object forms.

- [ ] Datetime fields lose sub-minute precision on edit: the `datetime-local`
      input is minute-granular, so re-saving a record truncates seconds
      (observed 2026-08-22). Decide a precision story (seconds step, or
      preserve original value when unchanged).

## Future features

- [ ] **Document-like note editor** (Obsidian-style full-page editing) —
      deferred from v0.1 note capture (spec §5).
- [ ] **More field types** (deferred from v0.1 class designer, spec §4):
      references (`record<Class>`), select/enum (string + `ASSERT ... INSIDE`),
      lists (`array<T>`).
- [ ] **Destructive schema operations**: remove fields, delete classes, rename
      classes/fields — need confirmations and a data-migration story.
- [ ] **Record-access authentication** (SurrealDB access methods) — end-user
      style auth, deferred from the v0.1 connect flow (spec §8).
- [ ] **In-app user management** — UI for `DEFINE USER ... ON DATABASE ROLES ...`
      so database owners can invite collaborators without the CLI.

- [ ] **Tauri desktop app** based on the web app, bundling automatic local
      SurrealDB instantiation/connection (spec §7).
- [ ] **External sync**: classes that stay in sync with external data sources
      (e.g. `Event` ↔ Google Calendar, `Person` ↔ mobile phone contacts) (spec §10).
- [ ] **Programmatic API** for straightforward querying/scripting against the
      database (spec §10).
- [ ] **LLM/agent access**: expose Parallax as a database backend for agent
      memory/context, e.g. for Claude (spec §10).
