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

## v0.1 — Foundation (current milestone)

- [x] Scaffold: SvelteKit static/SPA app at repo root, Bun tooling, surrealdb SDK (2026-08-22)
- [x] Connect flow: two-step connect (server auth → database pick/create), all auth
      levels + anonymous, localStorage profiles with opt-in remember, gate route + auto-reconnect (2026-08-22; spec §8)
- [x] Class designer: create + extend classes (singular/plural names, core-scalar
      fields, required toggle), SCHEMAFULL tables + `parallax_class` meta table,
      sidebar app shell, naming validation (2026-08-22; spec §4)
- [ ] Object CRUD: schema-driven form UI for creating/editing objects
- [ ] Note capture: built-in Note class + capture UI

## v0.2 — Distillation

- [ ] Build distillation v1: manual trigger per note + review (approve/edit/reject)
      before commit — per spec §6; this flow is temporary/experimental.
- [ ] After v1 ships: experiment with alternative trigger/commit models
      (auto-trigger on save, proposal inbox, auto-commit with revert) and revisit
      the spec decision.

## Future features

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
