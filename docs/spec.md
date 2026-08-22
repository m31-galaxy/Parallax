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

## 1. Overview

**Parallax** is a note-taking application. Tagline: *"Note-taking from a new
perspective."*

That is the extent of what has been decided. The project is intentionally
starting from a blank slate: no concept, scope, features, data model,
architecture, stack, or plan has been chosen yet.

## 2. Decision log

| Date | Decision |
|---|---|
| 2026-08-22 | Project name "Parallax", tagline "Note-taking from a new perspective" (README, commit `a267ee6`) |
| 2026-08-22 | docs/spec.md is the single source of truth; agent files must point to it |
| 2026-08-22 | Blank-slate policy: no design decision is assumed; every decision must be asked of the owner and recorded here before it is acted on |

## 3. Open questions

Everything. In particular, none of the following has been decided:

- What "note-taking from a new perspective" means concretely (the core concept)
- Target users and goals / non-goals
- Feature set and MVP scope
- Data model and storage format
- Platform (web, desktop, mobile, CLI, …) and tech stack
- Milestones, licensing, repo visibility

## 4. Maintaining this document

- **Read first:** any human or agent starting work on Parallax reads this file
  before doing anything.
- **Ask, then record:** decisions enter this file only after the owner makes
  them. Update the Decision log (§2) and the relevant section in the same
  commit/PR as the work that depends on the decision.
- **Conflicts:** if reality (code) and this spec diverge, treat it as a bug —
  fix one of them explicitly; never let them drift silently.
