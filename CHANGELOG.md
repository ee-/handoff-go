# Changelog

## 1.1.0 — Architect Coder Handoff

Protocol rename and open-source hardening draft.

Changed:

- renamed the protocol from **HandoffOS** to **Architect Coder Handoff (ACH)**;
- renamed the implementation role from **Executor** to **Coder** and routing from `EXECUTOR` to `CODER`;
- made **ChatGPT Chat → Coder** the primary reference workflow;
- retained coding-harness neutrality across Codex, Claude Code, OpenCode, Pi, Hermes, OMP, and similar tools;
- added a mandatory Coder Security Gate before material execution;
- defined repository/contributor content as input rather than automatic authority;
- required trusted governance to be loaded from a trusted base/default branch or pinned ref before evaluating untrusted contributions;
- added fail-closed handling for security/authority ambiguity;
- extended Work Order and PR Evidence Packet templates with security-boundary evidence;
- added `SECURITY.md` with a public-release gate and vulnerability-reporting guidance.

Migration note: consumer repositories using v1.0 terminology must update `Executor` role mappings and durable `Next Actor: EXECUTOR` routing to `Coder` / `Next Actor: CODER` when adopting v1.1.

## 1.0.0

Initial canonical HandoffOS release.

Established:

- Owner / Architect / Executor role model;
- ordinary-text, role-relative `go`;
- GitHub-native durable coordination (`Issue = Work Contract`, `PR = Evidence Packet`, `Merge = Promotion`);
- deterministic Architect/Executor discovery;
- `Next Actor` routing and no-silent-wait invariant;
- Work Order, Escalation Packet, and PR Evidence Packet contracts;
- exact-head-bound Architect review;
- truthful same-principal GitHub review fallback via durable protocol comments;
- bounded Owner-required transitions and Owner-action `go` shortcut;
- fail-closed ambiguity/staleness behavior;
- harness neutrality and prohibition on duplicated harness-specific `go` semantics;
- complexity gate against premature claims/leases/fencing/dispatcher/reconciler infrastructure;
- consumer-project adoption templates and version pinning guidance.

Reference operating pattern: human Owner + ChatGPT Architect + OMP Executor + GitHub durable state.
