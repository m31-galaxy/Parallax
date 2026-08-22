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
- [ ] **Formatting/linting tooling** (Prettier/ESLint or alternatives) — none
      configured yet; decide before the codebase grows.

## v0.1 — Foundation (current milestone)

- [x] Scaffold: SvelteKit static/SPA app at repo root, Bun tooling, surrealdb SDK (2026-08-22)
- [ ] Connect flow: connect dialog (URL, namespace/database, SurrealDB credentials) + named connection profiles stored locally
- [ ] Class designer: create/edit classes (singular/plural names, fields), enforced via SCHEMAFULL tables
- [ ] Object CRUD: schema-driven form UI for creating/editing objects
- [ ] Note capture: built-in Note class + capture UI

## v0.2 — Distillation

- [ ] Build distillation v1: manual trigger per note + review (approve/edit/reject)
      before commit — per spec §6; this flow is temporary/experimental.
- [ ] After v1 ships: experiment with alternative trigger/commit models
      (auto-trigger on save, proposal inbox, auto-commit with revert) and revisit
      the spec decision.

## Future features

- [ ] **Tauri desktop app** based on the web app, bundling automatic local
      SurrealDB instantiation/connection (spec §7).
- [ ] **External sync**: classes that stay in sync with external data sources
      (e.g. `Event` ↔ Google Calendar, `Person` ↔ mobile phone contacts) (spec §10).
- [ ] **Programmatic API** for straightforward querying/scripting against the
      database (spec §10).
- [ ] **LLM/agent access**: expose Parallax as a database backend for agent
      memory/context, e.g. for Claude (spec §10).
