# Parallax — TODO / Backlog

> All new tasks, deferred actions, backlog items, and future planned features are
> recorded in **this file**. Design decisions live in [spec.md](spec.md) — when a
> task here requires an undecided design decision, ask the owner and record the
> answer in the spec first.

## Decisions to discuss with the owner

- [ ] **LLM provider / extraction model for distillation** — deliberately left
      unfilled (2026-08-22); the owner wants a dedicated discussion later.
      Record the outcome in spec.md (§6, §11, §12).
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

- [ ] Build distillation v1: manual trigger per note + review (approve/edit/reject)
      before commit — per spec §6; this flow is temporary/experimental.
- [ ] After v1 ships: experiment with alternative trigger/commit models
      (auto-trigger on save, proposal inbox, auto-commit with revert) and revisit
      the spec decision.

## Known issues / polish

- [ ] The web app hangs on a dead connection: the SDK does not auto-reconnect
      when the WebSocket drops (observed 2026-08-22 — pages stick on
      "Loading…" while the header still says "connected"). Consider wiring the
      SDK's reconnect options or surfacing the disconnected state properly.

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
- [ ] **More field types** (spec §4): references shipped 2026-08-22;
      still planned: select/enum (string + `ASSERT ... INSIDE`) and lists
      (`array<T>`).
- [ ] **MCP reference support** (`mcp` branch, after merge): create_class
      accepts reference fields; coerceData converts "Person:x" strings to
      record ids; get_class exposes targets.
- [x] **Destructive schema operations — deletes**: field removal (two-step
      confirm, stored values purged) and class deletion (typed-name confirm)
      shipped 2026-08-22 (spec §4).
- [ ] **Schema renames** (classes and fields): SurrealDB has no native rename,
      so these need a copy-migration design — id remapping for class renames,
      reference integrity once record links exist.
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
