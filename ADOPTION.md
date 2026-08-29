# Adopting HandoffOS in another repository

HandoffOS is intended to be referenced by many projects without duplicating or drifting the protocol.

The preferred pattern is:

1. pin a HandoffOS version or commit;
2. add a very small project `AGENTS.md` bootstrap;
3. add only project-specific extensions locally;
4. let Architect and Executor discover work from GitHub durable state;
5. use ordinary text `go` in both role sessions.

---

## 1. Choose an integration mode

### Mode A — Pinned remote reference

Use when all participating agents can read GitHub.

Project `AGENTS.md` points to a specific HandoffOS tag/commit and names the canonical spec.

Pros: one upstream source of truth, minimal local files.

Constraint: do not point to floating `main` for long-lived project governance.

### Mode B — Vendored pinned snapshot

Recommended for offline/corporate/restricted environments.

Copy the pinned HandoffOS spec into a path such as:

```text
.handoffos/SPEC.md
.handoffos/REF
```

`REF` records the exact upstream commit/tag.

Treat `.handoffos/` as read-only upstream governance. Do not locally edit it. Upgrade by replacing it from a newer pinned HandoffOS version in an explicit governance change.

This is a snapshot, not a forked duplicate definition.

### Mode C — Git submodule/subtree

Useful when repository policy already supports them.

Pin HandoffOS to an exact revision. The project bootstrap still points to the canonical `SPEC.md` inside the pinned checkout.

---

## 2. Minimal project bootstrap

Copy [`templates/AGENTS.md`](templates/AGENTS.md) into the consumer repository as `AGENTS.md` and fill in:

- HandoffOS pinned ref;
- Architect assignment;
- Executor assignment;
- project-specific governance file path, if any.

The bootstrap should remain small. It should not restate the entire HandoffOS protocol.

Example:

```markdown
# Agent bootstrap

This repository uses HandoffOS v1.

Canonical protocol:
- upstream: `ee-/HandoffOS`
- ref: `<PINNED_COMMIT_OR_TAG>`
- spec: `SPEC.md`

Role mapping:
- Architect: ChatGPT
- Executor: OMP
- Owner: repository owner / product authority

Read the pinned HandoffOS specification before work.
The human-facing repository command is ordinary text `go`.
Do not create harness-specific `/go` semantics or ask the human to relay Issue/PR numbers.

Project-specific additions: `docs/governance/project.md`
```

---

## 3. Project-specific governance

Keep domain rules separate from HandoffOS itself.

A project-specific governance file may define:

```text
- domain invariants
- test requirements
- external egress rules
- destructive-action gates
- data/provenance rules
- model/tool assignments
- repository conventions
```

It should not redefine core HandoffOS semantics such as role discovery, `go`, routing, Work Order/PR meaning, or exact-head review unless the project intentionally forks the protocol.

---

## 4. Initial project setup

For a new project:

1. add the pinned HandoffOS bootstrap;
2. add/copy the Work Order Issue template if desired;
3. add/copy the PR Evidence Packet template if desired;
4. identify Owner, Architect, and Executor;
5. let the Architect create the first Work Order;
6. invoke the Executor with ordinary text `go`.

Normal human loop:

```text
Architect session: go
Executor session:  go
Architect session: go
Owner:              explicit decision when requested
```

No Issue/PR pointer relay is required.

---

## 5. Bootstrap prompts

A fresh Executor session may be initialized once with:

```text
Sync the project repository.
Read AGENTS.md and the pinned HandoffOS governance it references.
Do not start product work yet.
Confirm you have learned the repository-level ordinary-text `go` protocol.
Return only: GO_READY
```

Then daily use is simply:

```text
go
```

If the harness automatically loads `AGENTS.md`, the explicit bootstrap can be omitted once verified.

A fresh Architect session should likewise read the project bootstrap and pinned HandoffOS specification before interpreting `go`.

---

## 6. What not to copy

Do not create independent protocol definitions such as:

```text
.omp/skills/go.md
.codex/go-rules.md
CLAUDE-HANDOFF.md
private-chat-go-prompt.txt
```

if they restate or modify HandoffOS semantics.

Harness adapters are acceptable only when they point back to the pinned canonical spec.

---

## 7. Upgrading HandoffOS

Treat a HandoffOS upgrade as a governance dependency change.

Recommended upgrade procedure:

1. read the HandoffOS changelog/diff;
2. identify semantic changes affecting current work;
3. update the pinned ref deliberately;
4. update the vendored snapshot/submodule if applicable;
5. run a simple smoke test:
   - fresh Architect learns role-relative ordinary-text `go`;
   - fresh Executor learns role-relative ordinary-text `go`;
   - neither asks the human for Issue/PR routing pointers;
   - ambiguous routing fails closed;
6. record the upgrade in project durable state.

Do not let a remote moving branch silently change governance mid-Work-Order.

---

## 8. Recommended project layout

Minimal:

```text
AGENTS.md
docs/governance/project.md        # optional project-specific additions
```

Vendored mode:

```text
AGENTS.md
.handoffos/
  SPEC.md
  REF
docs/governance/project.md
```

Optional GitHub templates:

```text
.github/ISSUE_TEMPLATE/work-order.md
.github/PULL_REQUEST_TEMPLATE.md
```

---

## 9. Reference operating pattern: ChatGPT ↔ OMP

A common deployment is:

```text
Owner      = human
Architect  = ChatGPT
Executor   = OMP
Bus        = GitHub
Wake-up    = human types `go` in the relevant role session
```

ChatGPT writes Work Orders, resolves escalations, reviews PR evidence, and routes the next actor.

OMP discovers Executor-routed durable work, implements it, tests it, publishes the Evidence Packet, and stops at Architect review gates.

The human does not copy implementation context between them.

---

## 10. Adoption acceptance test

A project has successfully adopted HandoffOS when all of these are true:

- a fresh role session can locate the pinned protocol from `AGENTS.md`;
- ordinary text `go` reaches the model and is interpreted role-relatively;
- the human is not asked to supply Issue/PR numbers in the normal loop;
- Executor can rediscover a returned PR after Architect `REQUEST_CHANGES`;
- Architect can rediscover a PR waiting review;
- every inter-role stop records `Next Actor`;
- same-principal GitHub review limitations are reported truthfully;
- ambiguity produces a blocked/escalated state instead of guessed work.