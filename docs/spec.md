# Parallax — Specification & Design Document

> **This file is the ground source of truth for the Parallax project.**
> Every design decision, scope boundary, architectural choice, and plan lives here.
> If code, README, or any other document disagrees with this file, this file wins —
> either the code is wrong or this file must be explicitly amended first.

- **Status:** Living document
- **Last updated:** 2026-08-22
- **Owner:** Andromeda (stroev.andrew@gmail.com)

## Rules of this document

- Only decisions **explicitly made by the project owner** are recorded here.
  Nothing speculative, assumed, or drafted-as-default belongs in this file.
- Agents and contributors must **never assume a design decision**. If work
  requires a decision that is not recorded here, stop and ask the owner, then
  record the answer here before proceeding.
- Superseded decisions are kept for history, marked **Superseded**, with a
  pointer to their replacement.
- Tasks, deferred actions, backlog items, and future planned features live in
  [todo.md](todo.md), not here. This file records decisions and design.

## 1. Overview

**Parallax** is a note-taking and personal knowledge management (PKM) platform
centred around a **database**, in the same way that Obsidian is a note-taking/PKM
platform centred around a directory of local Markdown files. Tagline: _"Note-taking
from a new perspective."_

The core for now is **SurrealDB**. Users define schemas ("classes") that translate
directly to structure in the database, create structured "objects" through
form-like UIs, and capture freeform notes that can be **distilled** by an LLM into
structured objects matching those schemas.

## 2. Original statement of intent (verbatim)

Recorded 2026-08-22, quoted exactly to preserve the owner's original intent:

> Parallax is a note-taking and personal knowledge management (PKM) platform centred around a database, much like how Obsidian is a note-taking/PKM platform centred around a directory of local Markdown files. For now, let's build around SurrealDB as a core.
>
> The core architecture is that the user should be able to define schemas which translate to structure in the database. Let's call each table a "class" to have parity with object-oriented programming. When creating a class, they should have both a singular and a plural name (for UI fluency), and then a customisable set of "fields". For example, I could create a Person class which mirrors that of a contact/address book - it could have fields such as first_name, last_name, date_of_birth, address, etc.
>
> Where possible, schemas should be verified and enforced at the database level, with the client and frontend UI simply passing through / surfacing what is/isn't allowed. As much as possible, we want to have "smart database, dumb client" - as this makes it easier to build on top, create modularity, have a single ground source of truth, and sync/backup/restore as much state as possible just by copying the db.
>
> The user should be able to manually create "objects" - again borrowing terms from OOP. These should be instances of a class, and follow the schema. When manually creating an object of a given type (an _object_ always has a _type_ which is a _class_), the user should be presented with a UI which feels similar to filling out a form - rather than a freeform text note.
>
> As a general naming convention for this project, classes should be PascalCase and fields should be snake_case.
>
> One core feature that I wish to build around is the idea of "distilled note-taking" or "distilled journalling". This involves the user writing a freeform note in either a card-like form (zettelkasten / google keep style UI) or in a document-like form (obsidian style UI). On the backend side of things, this should be recorded as a built-in basic "Note" class with a `created` datetime field and a `content` long text field. Then, an LLM or data extraction model can be run over the content, extracting data from the note which can be "distilled" back into the database but based on the structure that we have defined with classes and fields. That way, for example a daily journal talking about the people one has met at an event could then be automatically distilled into objects in the Person table.
>
> Future expansion plans / scope include a sync feature, where a table could be set up to stay in sync with external data (e.g. syncing an Event class with Google Calendar, or a Person class with your mobile phone contacts), as well as an API for interacting querying the database in a straightforward programmatic manner for easy modularity and scripting. It should also be accessible to LLMs and agents, such that e.g. Claude could use it as a powerful database backend for memory and context on a given user chatting to it.

The sections below expand this into a fuller picture. Where an expansion is a
_derived consequence_ rather than the owner's literal words, it is marked
**(derived)**; derived items were accepted via plan approval on 2026-08-22, but
their details remain open to revision (see §12).

## 3. Architecture principles

1. **Smart database, dumb client.** The database is the single ground source of
   truth. Clients pass through and surface what the database allows; they do not
   own logic that could live in the DB. This enables building on top, modularity,
   and sync/backup/restore by simply copying the database.
2. **Schema enforcement at the database level.** Wherever possible, schemas are
   verified and enforced by SurrealDB itself — **(derived)** concretely via
   `SCHEMAFULL` tables and `DEFINE FIELD` (with type constraints and `ASSERT`
   clauses). The frontend renders and relays these constraints; it never
   re-implements them as the authority.
3. **All state in the database. (derived)** Because copying the DB must capture
   as much state as possible, class metadata that the DB engine doesn't natively
   hold (singular/plural display names, field ordering/labels, etc.) is itself
   stored in the database (e.g. a metadata table) rather than in client-side
   config. Exact representation: open (§12).

## 4. Domain model

Terminology borrows deliberately from OOP:

| Term       | Meaning                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Class**  | A user-defined schema, backed by one SurrealDB table. Has a **singular and a plural name** (for UI fluency, e.g. "Person" / "People") and a customisable set of **fields**. |
| **Field**  | A named, typed attribute of a class (e.g. `first_name`, `date_of_birth`).                                                                                                   |
| **Object** | An instance of a class — a row/record conforming to its schema. An _object_ always has a _type_, which is a _class_.                                                        |

- **Naming convention (project-wide):** classes are `PascalCase`, fields are
  `snake_case`.
- **Manual object creation** presents a form-filling UI derived from the class
  schema — not a freeform text note. Example: a `Person` class mirroring a
  contact/address book with `first_name`, `last_name`, `date_of_birth`,
  `address`, etc.
- The set of supported field types for v0.1 is not yet decided (§12).

## 5. Built-in classes

**Note** — the built-in basic class backing freeform capture:

| Field     | Type      |
| --------- | --------- |
| `created` | datetime  |
| `content` | long text |

Notes are captured through either:

- a **card-like** UI (zettelkasten / Google Keep style), or
- a **document-like** UI (Obsidian style).

Whether both editors ship in v0.1 is open (§12).

## 6. Distilled note-taking

The flagship feature ("distilled note-taking" / "distilled journalling"):

1. The user writes a freeform note (card or document form), stored as a `Note`
   object.
2. An LLM or data-extraction model runs over `content`, extracting data that is
   "distilled" back into the database as structured objects, based on the
   user-defined classes and fields.
3. Example: a daily journal entry about people met at an event is distilled into
   objects in the `Person` table.

**v1 flow (temporary):** distillation is **manually triggered** per note, and
extracted proposals go through a **review step** (approve/edit/reject) before
anything is committed to the database. This is an explicitly _temporary,
experimental_ choice — alternative trigger/commit models will be revisited later
(see [todo.md](todo.md)).

The LLM provider / extraction model is **deliberately undecided** (§12;
discussion task in [todo.md](todo.md)).

## 7. Clients & stack

- **First client: a web app**, TypeScript + **Svelte** — specifically
  **SvelteKit in static/SPA mode** (`adapter-static` with an `index.html`
  fallback, `ssr = false`): no app server exists, keeping the client "dumb".
- **Tooling: Bun** as package manager and script runner (TS dev scripts run
  directly under Bun); **Vite remains the build tool**. The app lives at the
  **repository root** (monorepo only if/when separate packages appear).
- The web app is **manual-connect only**: the user can connect to an _arbitrary_
  SurrealDB database (URL), which makes remote connections and collaboration
  effectively free. It does not spawn or manage database processes.
- **Later:** a **Tauri desktop app based on the web app**, which additionally
  bundles the "easy local database" functionality — automatically instantiating
  or connecting to a local SurrealDB server process. (Tracked in
  [todo.md](todo.md).)
- **Formatting: Prettier** (with `prettier-plugin-svelte`), configured in
  `.prettierrc`: 4-space indents (2-space for JSON), single quotes, no trailing
  commas, 100-column print width. Run via `bun run format` (write) and
  `bun run format:check` (verify).
- **Linting: ESLint** (flat config in `eslint.config.js`) with
  **typescript-eslint** `recommendedTypeChecked` (type-aware, via the TS project
  service), **eslint-plugin-svelte**, and **eslint-config-prettier** so lint
  rules never fight the formatter. Run via `bun run lint` and `bun run lint:fix`.
  Formatting rules belong to Prettier; ESLint covers correctness only.
- **Automated checks** run the same three tools from two places:
    - **Git hooks:** committed to `.githooks/` and activated with
      `core.hooksPath`, which the `prepare` script sets on `bun install`.
      `pre-commit` runs Prettier, ESLint (both on staged files) and a full
      `svelte-check`. It is **check-only** — it never rewrites or restages files,
      so what was reviewed is what gets committed.
    - **Agent hooks:** `.claude/settings.json` defines a `PostToolUse` hook on
      `Write|Edit` that formats the touched file with Prettier, then runs ESLint
      on it and returns any errors to the agent to fix in the same turn.
- Test tooling is not yet decided (§12).

## 8. Connection & auth

- **Pass through SurrealDB's native auth.** The connect dialog takes the server
  URL, namespace/database, and SurrealDB credentials; the app stores named
  **connection profiles** locally. There is **no Parallax-level account system**.
- Collaboration model: multiple people connecting to the same database with
  their own database users — a consequence of arbitrary connections plus
  DB-native auth.

## 9. Milestones

| Milestone               | Scope                                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1 — Foundation**   | Connect flow (arbitrary URL + SurrealDB auth + profiles), class designer (create/edit classes: singular/plural names, fields), object CRUD via schema-driven forms, Note capture. |
| **v0.2 — Distillation** | Manual trigger + review-before-commit distillation.                                                                                                                               |
| Later                   | See [todo.md](todo.md).                                                                                                                                                           |

No dates attached; milestones are sequenced, not scheduled.

## 10. Future scope (summary)

Details and status tracked in [todo.md](todo.md):

- **Sync:** a class/table can be set up to stay in sync with external data
  (e.g. `Event` ↔ Google Calendar, `Person` ↔ mobile phone contacts).
- **API:** straightforward programmatic querying of the database for modularity
  and scripting.
- **LLM/agent access:** Parallax as a powerful database backend for agent memory
  and context (e.g. Claude using it while chatting with a given user).

## 11. Decision log

| Date       | Decision                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-22 | Project name "Parallax", tagline "Note-taking from a new perspective" (README, commit `a267ee6`)                                                                                      |
| 2026-08-22 | docs/spec.md is the single source of truth; agent files must point to it                                                                                                              |
| 2026-08-22 | Blank-slate policy: no design decision is assumed; every decision must be asked of the owner and recorded here before it is acted on                                                  |
| 2026-08-22 | Product definition: database-centred note-taking/PKM platform; SurrealDB as the core (§1, §2 verbatim)                                                                                |
| 2026-08-22 | Domain model: classes (tables) with singular+plural names and custom fields; objects as schema-conforming instances; manual creation via form-style UI (§4)                           |
| 2026-08-22 | Naming convention: `PascalCase` classes, `snake_case` fields (§4)                                                                                                                     |
| 2026-08-22 | Principle: "smart database, dumb client"; schemas verified/enforced at the database level (§3)                                                                                        |
| 2026-08-22 | Built-in `Note` class: `created` datetime + `content` long text; card-like and document-like capture UIs (§5)                                                                         |
| 2026-08-22 | Distilled note-taking is the flagship feature; v1 flow = manual trigger + review before commit, explicitly temporary/experimental (§6)                                                |
| 2026-08-22 | First client: web app, manual-connect only, connecting to arbitrary SurrealDB URLs (§7)                                                                                               |
| 2026-08-22 | Frontend stack: TypeScript + Svelte (§7)                                                                                                                                              |
| 2026-08-22 | Later client: Tauri desktop app based on the web app, bundling automatic local-DB instantiation (§7)                                                                                  |
| 2026-08-22 | Auth: pass through SurrealDB native auth; locally stored connection profiles; no Parallax account layer (§8)                                                                          |
| 2026-08-22 | Milestones: v0.1 = foundation (connect, classes, objects, notes); v0.2 = distillation (§9)                                                                                            |
| 2026-08-22 | LLM provider / extraction model for distillation: deliberately deferred — to be discussed with the owner (todo.md)                                                                    |
| 2026-08-22 | docs/todo.md established as the single backlog file for tasks, deferred actions, and future features; rule recorded in AGENTS.md                                                      |
| 2026-08-22 | Tooling: Bun as package manager + script runner; Vite remains the build tool (§7)                                                                                                     |
| 2026-08-22 | Web app is SvelteKit in static/SPA mode (adapter-static, index.html fallback, no SSR/app server) (§7)                                                                                 |
| 2026-08-22 | Repo layout: app at repository root; monorepo only if/when separate packages appear (§7)                                                                                              |
| 2026-08-22 | Test tooling: deliberately deferred until the first tests are written (todo.md)                                                                                                       |
| 2026-08-22 | Formatting: Prettier + `prettier-plugin-svelte`; 4-space indents (2-space for JSON), single quotes, no trailing commas, 100-col print width; `format` / `format:check` scripts (§7)   |
| 2026-08-22 | Linting: ESLint flat config + typescript-eslint `recommendedTypeChecked` (type-aware) + eslint-plugin-svelte + eslint-config-prettier; `lint` / `lint:fix` scripts (§7)               |
| 2026-08-22 | Automated checks: committed `.githooks/` via `core.hooksPath` (installed by `prepare`); `pre-commit` runs Prettier + ESLint + svelte-check, check-only, no auto-fix or restaging (§7) |
| 2026-08-22 | Agent hooks: `.claude/settings.json` `PostToolUse` on `Write                                                                                                                          | Edit` — Prettier writes the touched file, ESLint errors are fed back to the agent (§7) |

## 12. Open questions

Undecided design decisions (ask the owner before acting on any of these):

- LLM provider / extraction model for distillation — deferred by the owner;
  discussion task in [todo.md](todo.md).
- Long-term distillation trigger/commit model (current manual + review flow is
  temporary; auto-trigger, inbox, auto-commit variants to be experimented with).
- Field type set for v0.1 (which scalars; references between classes; enums;
  arrays/lists).
- Do both the card-like and document-like note editors ship in v0.1?
- Test tooling (Vitest vs `bun test` vs a split) — deferred until the first
  tests are written.
- Exact in-database representation of class metadata (§3.3's metadata table).
- Shape of the distillation review UI (v0.2).

## 13. Maintaining this document

- **Read first:** any human or agent starting work on Parallax reads this file
  before doing anything.
- **Ask, then record:** decisions enter this file only after the owner makes
  them. Update the Decision log (§11) and the relevant section in the same
  commit/PR as the work that depends on the decision.
- **Tasks go elsewhere:** new tasks, deferred actions, backlog items, and future
  planned features are recorded in [todo.md](todo.md), not here.
- **Conflicts:** if reality (code) and this spec diverge, treat it as a bug —
  fix one of them explicitly; never let them drift silently.
