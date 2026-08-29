# HandoffOS

**A GitHub-native handoff framework for durable Architect ↔ Executor agent work.**

HandoffOS turns GitHub into the coordination bus between a reasoning/architecture agent (for example ChatGPT) and an execution harness (for example OMP, Codex, Claude Code, OpenCode, Pi, or Hermes).

The framework is intentionally small. The human invokes **roles**, not tasks. Each role discovers its next action from durable GitHub state. The normal human-facing command is ordinary text:

```text
go
```

The same literal `go` is role-relative. It is not a harness slash command and must reach the model as normal user text.

## Core model

```text
Owner
  │
  │ product / business / high-authority decisions
  ▼
Architect
  │ Work Order / decision / independent review
  ▼
GitHub durable state
  │ Issue = Work Contract
  │ Comment = Decision / Escalation / Routing
  │ Branch = Proposal
  │ PR = Evidence Packet
  │ Review = Independent Acceptance
  │ Merge = Promotion
  ▼
Executor
```

Reference pairing: **ChatGPT = Architect, OMP = Executor**. The protocol itself is harness-agnostic.

## Canonical specification

The canonical behavior is defined in [`SPEC.md`](SPEC.md).

Consumer projects should **pin a HandoffOS release or commit**, then use a minimal local bootstrap that points agents to that pinned specification. Do not copy and independently redefine `go` semantics for each harness.

See [`ADOPTION.md`](ADOPTION.md) for integration patterns and [`templates/AGENTS.md`](templates/AGENTS.md) for the minimal consumer-project bootstrap.

## Design goals

- No human relay of Issue/PR numbers or chat context.
- Deterministic role discovery from durable state.
- Fail closed on ambiguity or contradictory routing.
- Exact-head-bound review and promotion.
- No silent waiting: every stop records why and who acts next.
- Agents propose; humans retain high-authority promotion decisions.
- Harness-neutral: no OMP-specific `/go`, Codex-specific command, or private chat-only protocol.
- Complexity only when witnessed failures justify it; no default leases, claims, fencing, dispatcher, or reconciler.

## Repository templates

- `.github/ISSUE_TEMPLATE/work-order.md` — Work Order contract template.
- `.github/PULL_REQUEST_TEMPLATE.md` — Executor Evidence Packet template.
- `templates/AGENTS.md` — minimal bootstrap for a consumer repository.
- `ADOPTION.md` — pinning, vendoring, submodule, and remote-reference patterns.

## Versioning rule

Treat HandoffOS governance as executable protocol. A consumer repository should pin a version/commit and change that pin deliberately. Never let a moving `main` silently alter an active project's workflow semantics.