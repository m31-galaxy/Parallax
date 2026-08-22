# Parallax — Agent Instructions

**The ground source of truth for this project is [docs/spec.md](docs/spec.md).**
All design decisions, scope, data model, architecture, and planning live there.

1. **Never assume a design decision — always ask.** The project is intentionally
   starting from a blank slate. If work requires a decision not already recorded
   in `docs/spec.md`, stop and ask the user; do not pick defaults or speculate.
2. Read `docs/spec.md` before making changes. Only decisions recorded there are
   real.
3. Once the user makes a decision, record it in `docs/spec.md` (Decision log +
   relevant section) in the same commit/PR as the work that depends on it.
4. If code and spec disagree, the spec wins: fix the code or amend the spec
   explicitly — never let them drift silently.
5. Undecided issues go in the spec's Open questions section, not into code.
6. **All tasks, deferred actions, backlog items, and future planned features go
   in `docs/todo.md`** — never scattered across code comments or other docs.
   `docs/spec.md` stays decisions/design only.

CLAUDE.md imports this file via Claude Code's `@AGENTS.md` syntax, so Claude
Code reads these same rules. Edit this file only; keep CLAUDE.md as just the
import line.
