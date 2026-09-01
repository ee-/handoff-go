## 1.1.0 — pending

Coder watch (`go watch`):

- `go watch`, `go watch <interval>`, `go watch stop` Coder command surface;
- default 1m cadence, minimum 60s, immediate first discovery;
- canonical watch-tick prompt and shared dependency-free parser core;
- OMP and Pi native extension adapters (managed timer + follow-up wake, no
  overlapping runs, session-shutdown cleanup);
- per-harness compatibility table (Claude Code, OpenCode, DeepSeek Harness,
  Codex) with native capabilities and a Codex `WATCH_UNSUPPORTED` result.

## 1.0.0 — pending

Initial public Handoff Go release candidate:

- one dependency-free universal `handoff-go` skill package;
- project-local setup and read-only adoption check;
- repository-scoped, role-relative ordinary-text `go`;
- Owner / Architect / Coder authority model;
- GitHub-native Work Orders, Evidence Packets, routing, and promotion;
- trusted-governance loading and mandatory Coder Security Gate;
- exact-head Architect review and truthful same-principal fallback;
- fail-closed ambiguity and no-silent-wait invariant;
- dependency-free validation and publication gate.

This supersedes unpublished private development baselines. No earlier public
release exists.
