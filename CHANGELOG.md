# Changelog

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
