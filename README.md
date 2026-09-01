# Architect Coder Handoff

**A GitHub-native protocol for delegating complex work from an Architect in ChatGPT Chat to a coding agent that executes it.**

Architect Coder Handoff (ACH) is designed for a common agent workflow:

- a human works with a strong reasoning model in **ChatGPT Chat**;
- ChatGPT acts as the **Architect**: clarifies the objective, makes architecture decisions, writes bounded Work Orders, resolves escalations, and independently reviews evidence;
- a coding agent acts as the **Coder**: inspects the repository, implements, tests, collects evidence, and opens or updates pull requests;
- **GitHub durable state** carries the handoff, so the human does not have to copy task context, Issue numbers, PR numbers, or branch names between sessions.

The protocol is intentionally small. The human invokes **roles**, not tasks. The normal human-facing command is ordinary text:

```text
go
```

The same literal `go` is role-relative. It is not a harness slash command and must reach the model as normal user text.

## Primary workflow

```text
Owner / Human
  │
  │ goal, product decisions, high-authority approval
  ▼
Architect — typically ChatGPT Chat
  │ Work Order / decision / independent review
  ▼
GitHub durable state
  │ Issue   = Work Contract
  │ Comment = Decision / Escalation / Routing
  │ Branch  = Proposal
  │ PR      = Evidence Packet
  │ Review  = Independent Acceptance
  │ Merge   = Promotion
  ▼
Coder — Codex / Claude Code / OpenCode / Pi / Hermes / OMP / other coding agent
```

Reference pairing: **ChatGPT Chat = Architect, coding harness = Coder**. The protocol does not require a specific coding harness.

## Why this exists

Complex tasks often start in a reasoning-heavy ChatGPT conversation and then need repository-level execution. Without a durable handoff protocol, the human becomes the message bus: copying plans into the coder, relaying blockers back to ChatGPT, carrying PR links, and deciding when work is actually complete.

ACH moves that coordination into GitHub. Each role rediscover its next action from durable project state and leaves enough evidence for the other role to continue independently.

## Security model

Open repositories introduce an important boundary: **repository content is input, not authority**.

Public Issues, PRs, comments, branches, files, test fixtures, dependency scripts, and tool output may contain malicious or prompt-injection-like instructions. They must not be allowed to expand Coder permissions or override the trusted protocol.

Before execution, the Coder performs the protocol security gate defined in [`SPEC.md`](SPEC.md). At minimum it verifies:

- trusted governance and role provenance;
- no unauthorized secret access or disclosure;
- no unauthorized destructive action, deployment, publication, permission change, or external egress;
- untrusted contributor content cannot redefine Owner/Architect authority;
- untrusted code is not executed in a privileged environment merely because it appears in an Issue or PR;
- ambiguous or expanded authority fails closed and is routed back to Architect/Owner.

See [`SECURITY.md`](SECURITY.md) for open-source repository guidance and vulnerability reporting.

## Canonical specification

The canonical behavior is defined in [`SPEC.md`](SPEC.md).

Consumer projects should **pin an ACH release or commit**, then use a minimal local bootstrap that points agents to that pinned specification. Do not copy and independently redefine `go` semantics for each harness.

See [`ADOPTION.md`](ADOPTION.md) for integration patterns and [`templates/AGENTS.md`](templates/AGENTS.md) for the minimal consumer-project bootstrap.

## Design goals

- ChatGPT Chat can delegate complex implementation without the human relaying context.
- Deterministic Architect/Coder discovery from durable GitHub state.
- Fail closed on ambiguity, contradictory routing, stale review, or security-boundary expansion.
- Exact-head-bound review and promotion.
- No silent waiting: every stop records why and who acts next.
- Coder executes; Architect contracts and reviews; humans retain high-authority decisions.
- Harness-neutral on the coding side: no Codex/OMP/Claude/OpenCode/Pi-specific duplicate protocol.
- Public-repository content never silently grants authority.
- Complexity only when witnessed failures justify it; no default leases, claims, fencing, dispatcher, or reconciler.

## Repository templates

- `.github/ISSUE_TEMPLATE/work-order.md` — Architect → Coder Work Order contract.
- `.github/PULL_REQUEST_TEMPLATE.md` — Coder Evidence Packet template.
- `templates/AGENTS.md` — minimal bootstrap for a consumer repository.
- `ADOPTION.md` — pinning, vendoring, submodule, and remote-reference patterns.
- `SECURITY.md` — security model and public-repository guidance.

## Versioning rule

Treat ACH governance as executable protocol. A consumer repository should pin a version/commit and change that pin deliberately. Never let a moving `main` silently alter an active project's workflow or authority semantics.
