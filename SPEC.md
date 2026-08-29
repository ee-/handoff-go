# HandoffOS Protocol v1.0

Status: **canonical**

This document is the single source of truth for the HandoffOS role-handoff protocol.

Consumer repositories may add project-specific scope, invariants, role assignments, and authority gates, but they must not silently redefine the semantics in this file. Harness-specific bootstraps may point here; they must not maintain a second protocol definition.

---

## 1. Purpose

HandoffOS coordinates a human Owner, an Architect agent, and an Executor agent through durable GitHub state.

The protocol optimizes for one human-facing UX:

```text
go
```

The human invokes a **role**, not a task. The role reads current durable project state, discovers the next transition it owns, performs that transition, persists the result, and stops or continues according to this specification.

The human should not carry Issue numbers, PR numbers, branch names, or copied context between roles.

---

## 2. Roles

### 2.1 Owner

The Owner is the product/business/high-authority human.

Owner authority includes decisions such as:

- material objective changes;
- accepted architecture or invariant changes;
- destructive actions;
- new external egress/publication/deployment;
- permissions, secrets, security, or spend outside prior authorization;
- technically unresolved architecture forks;
- explicit human-promotion gates.

The Owner is not the routine task router.

### 2.2 Architect

The Architect owns:

- Work Order creation and amendment;
- architecture and authority-boundary decisions;
- independent PR review;
- handling Executor escalations;
- deciding whether evidence satisfies the contract;
- routing the next actor.

The Architect does **not** become the routine implementation agent.

Reference implementation: ChatGPT or another strong reasoning model.

### 2.3 Executor

The Executor owns:

- implementation;
- local inspection;
- routine debugging;
- tests and verification;
- evidence collection;
- branch and PR creation;
- bounded escalation when the contract cannot safely continue.

The Executor has no authority to rewrite the Work Order objective, silently change accepted invariants, or self-accept its own implementation.

Reference implementation: OMP, Codex, Claude Code, OpenCode, Pi, Hermes, or another coding/agent harness.

---

## 3. GitHub as coordination bus

HandoffOS uses native GitHub objects as durable protocol records:

```text
Issue    = Work Contract
Comment  = Decision / Escalation / Routing
Branch   = Proposal
PR       = Evidence Packet
Review   = Independent Acceptance
Merge    = Promotion
```

Chat is a wake-up and interaction surface, not the source of truth.

A material workflow fact that exists only in chat is not durable protocol state.

---

## 4. The `go` command

### 4.1 Canonical human-facing command

The canonical command is ordinary text:

```text
go
```

It must reach the model as a normal user message.

Do not depend on a harness-native slash namespace such as `/go`. Some hosts intercept slash commands before model ingress.

### 4.2 Role-relative semantics

The same literal `go` means:

> Read the current durable project state, discover the next transition owned by your current role, perform it, persist the result, and stop/continue according to HandoffOS.

It does **not** mean "guess something useful to do."

Role assignment comes from the current session/environment or the project bootstrap. `go` does not silently switch an Executor into Architect authority or vice versa.

### 4.3 Human routing rule

The human should never need to say:

```text
go issue 123
go review PR 45
resume branch xyz
```

Those are internal workflow addresses. Agents discover them from GitHub.

Task-specific pointers may be used for diagnosis, but they are not the normal protocol.

### 4.4 Owner-action shortcut

When durable state is routed to `OWNER` and the immediately preceding interaction presents **one exact, bounded Owner action**, a human reply of ordinary text `go` may be treated as authorization for that exact action.

If there are multiple choices, a new material decision, ambiguous scope, or destructive authority not already made explicit, `go` is insufficient: return `OWNER_ACTION_REQUIRED` with a bounded decision packet.

---

## 5. Routing

Every handoff must persist a routing record:

```text
Next Actor: EXECUTOR | ARCHITECT | OWNER | NONE
```

Free-form discussion does not override a later applicable routing record.

If durable records contradict each other and precedence cannot resolve them safely, fail closed and escalate rather than guessing.

### 5.1 No silent wait

Before a role stops because another role must act, it must durably record:

- why it stopped;
- what remains;
- the next actor;
- enough state for the next actor to rediscover the work without chat relay.

---

## 6. Executor discovery

On `go`, the Executor should:

1. sync/read current project bootstrap and pinned HandoffOS governance;
2. inspect open Issues, Issue comments, open PRs, PR reviews/comments, and relevant branch state;
3. find work whose latest applicable routing is `Next Actor: EXECUTOR`;
4. prefer resumable work already in progress;
5. otherwise choose a ready Work Order by explicit dependency/priority, then oldest ready contract;
6. if two contracts conflict or authority is ambiguous, write an escalation instead of choosing silently;
7. implement/test/evidence only within the current contract.

If no Executor-owned work exists:

```text
NO_EXECUTOR_WORK
```

---

## 7. Architect discovery

On `go`, the Architect uses this precedence:

1. unresolved Executor escalation or blocker;
2. PR waiting for review or re-review;
3. other explicit contract decision routed to Architect;
4. if none exists, create the next Work Order **only when durable project state makes the next step unambiguous and no Owner decision is required**.

If no Architect-owned transition exists:

```text
NO_ARCHITECT_WORK
```

If progress requires human authority:

```text
OWNER_ACTION_REQUIRED
```

The Architect must not manufacture a roadmap step merely to stay busy.

---

## 8. Work Orders

A Work Order is a durable execution contract, normally a GitHub Issue.

Minimum structure:

```markdown
# Objective

# Why

# Current State

# Decisions Already Made

# Scope

# Non-Goals

# Invariants

# Implementation Guidance

# Acceptance Criteria

# Required Evidence

# Escalation Conditions

# Completion Protocol

# Routing
Next Actor: EXECUTOR
```

### 8.1 Contract stability

Once execution begins, the Issue body is the contract snapshot.

Material changes after execution begins should be recorded in comments as one of:

```text
ARCHITECT DECISION
CONTRACT AMENDMENT
REDIRECT
```

Use:

- `ARCHITECT DECISION` for clarification that does not materially change requirements;
- `CONTRACT AMENDMENT` for a material but still same-objective requirement change;
- `REDIRECT` or a new Work Order when the objective itself changes.

Do not silently rewrite history to make the contract appear as if it always said something different.

---

## 9. Executor lifecycle

Normal lifecycle:

```text
go
  -> discover Executor-owned Work Order or resumable PR
  -> inspect / implement / test
  -> push task branch
  -> open or update PR
  -> record READY_FOR_REVIEW
  -> Next Actor: ARCHITECT
  -> stop product implementation until review
```

The Executor must not close the Work Order or self-declare acceptance merely because tests pass.

A PR should normally link its Work Order with `Closes #<issue>` only when merge truly completes that contract. For partial slices, do not falsely close the parent Work Order.

---

## 10. Escalation

Executor escalation is for contract-level uncertainty, not routine debugging.

Escalate when there is:

- contract ambiguity or contradiction;
- an architecture fork requiring authority;
- evidence falsifying a Work Order assumption;
- conflict with an accepted invariant;
- a material dependency or external action outside scope;
- repeated material route failure.

Do not escalate ordinary implementation choices the Executor can safely resolve within the contract.

### 10.1 Escalation Packet

Before stopping, persist:

```markdown
## ESCALATION PACKET

### Blocker

### Why continuing would be unsafe

### Evidence

### Affected assumption / invariant

### Options

### Executor recommendation

### Requested Contract Action
CLARIFY | AMEND | REDIRECT | SPLIT | CANCEL | NO_CHANGE

### Preserved work
branch / HEAD / tests / worktree state

### Independent work that can continue

### Next Actor
ARCHITECT
```

The Architect response must be executable, not merely advisory.

---

## 11. Pull Request Evidence Packet

An implementation PR is an evidence packet, not just a diff.

Minimum structure:

```markdown
## Work Order
Closes #<issue>   <!-- only when true -->

## What changed

## Acceptance evidence
criterion -> evidence

## Verification
commands actually run + observed results

## Source / semantic evidence

## Scope deviations

## Failed / omitted verification

## Remaining uncertainty

## Material files changed

## Review focus

## Routing
READY_FOR_REVIEW
Next Actor: ARCHITECT
```

Do not claim tests, egress state, review state, or runtime behavior that was not actually observed.

---

## 12. Architect review

The Architect reviews at least:

- contract compliance;
- semantic correctness;
- invariant preservation;
- evidence sufficiency;
- scope discipline;
- maintainability and unnecessary abstraction.

Review outcomes:

```text
APPROVE
REQUEST_CHANGES
CONTRACT_AMENDMENT / REDIRECT
OWNER_REQUIRED
```

### 12.1 Exact-head binding

Approval is bound to the exact reviewed PR head SHA.

If the head changes materially after approval, re-review is required.

A durable approval record should state the exact head.

### 12.2 Same-principal GitHub limitation

Some setups authenticate Architect and Executor GitHub actions as the same GitHub principal. GitHub may reject native `APPROVE` or `REQUEST_CHANGES` on a self-authored PR with HTTP 422.

In that topology:

- do not falsely claim a native review occurred;
- write a durable protocol comment such as `ARCHITECT REVIEW — APPROVE` or `ARCHITECT REVIEW — REQUEST_CHANGES`;
- bind it to the exact head SHA;
- route the next actor explicitly.

Native review is preferable when genuinely available, but the protocol comment is the fallback durable acceptance record for single-principal operation.

---

## 13. Promotion / merge

Merge is promotion of the proposal into canonical project state.

A merge should only occur when the current head is covered by the applicable Architect acceptance record and required checks/Owner gates are satisfied.

Use an expected-head guard where the API/harness supports it.

Current minimal topology may use a human/Owner merge gate. Future automation may auto-merge only when it can prove, at minimum:

- accepted current head;
- required checks satisfied;
- no later blocking decision;
- no unresolved Owner authority gate.

Do not add auto-merge infrastructure merely because the protocol could support it.

---

## 14. Owner-required transitions

When Owner authority is required, create a bounded packet containing:

- exact decision needed;
- options/recommendation where useful;
- evidence sufficient to decide without repository archaeology;
- what remains blocked;
- what will happen after approval;
- `Next Actor: OWNER`.

After the Owner supplies the decision, persist it durably before downstream execution relies on it.

Agents propose; humans promote.

---

## 15. Failure behavior

HandoffOS is fail-closed.

Do not guess when:

- routing records conflict;
- the contract is materially ambiguous;
- a required identity/version/head cannot be verified;
- approval refers to a stale head;
- an Owner gate is unresolved;
- external side effects would exceed authorization.

Prefer a visible blocked state over silent continuation under invented assumptions.

---

## 16. Complexity gate

The minimal protocol assumes a small topology such as:

- one Owner;
- one interactive Architect;
- one active Executor;
- GitHub durable state;
- manual role wake-up via `go`.

Do **not** add by default:

- distributed claims;
- leases;
- epochs;
- fencing tokens;
- dispatcher services;
- periodic reconcilers;
- effect brokers;
- workflow databases.

Add those only after a witnessed failure or mandatory invariant demonstrates the need.

Examples:

- duplicate execution observed -> consider claims/leases;
- stale worker effects observed -> consider fencing/epochs;
- routing/wake failures become persistent operational pain -> consider a reconciler/relay;
- multiple concurrent executors become normal -> revisit arbitration.

Architecture should respond to witnessed failure, not hypothetical scale.

---

## 17. Harness neutrality

The protocol must not depend on one agent product.

Allowed local bootstrap:

```text
Read the project AGENTS.md and the pinned HandoffOS specification it references.
Then follow ordinary-text `go` according to your assigned role.
```

Not canonical:

- OMP-only `/go` skills;
- Codex-only private command semantics;
- a Claude-specific duplicate workflow file;
- chat prompts that redefine routing differently from the pinned spec.

A harness may provide convenience adapters, but adapters must delegate to the pinned HandoffOS semantics rather than fork them.

---

## 18. Consumer project extensions

A consumer project may define:

- which model/tool is Architect;
- which harness is Executor;
- project-specific invariants;
- testing requirements;
- egress/deployment/destructive-action gates;
- domain-specific Work Order evidence.

These extensions must be additive.

If a local extension intentionally changes a HandoffOS semantic, it must be explicit, versioned, and treated as a protocol fork rather than silently described as HandoffOS v1.

---

## 19. Version pinning

HandoffOS workflow semantics are executable governance.

Consumer repositories must pin a release/tag or commit.

Recommended project marker:

```text
HandoffOS-Version: 1.0
HandoffOS-Ref: <tag-or-commit>
```

Do not bind a production project to floating `main` if a future HandoffOS update could change discovery/routing semantics.

---

## 20. Protocol invariants summary

1. **Human invokes roles, not tasks.**
2. **`go` is ordinary text and role-relative.**
3. **Humans do not relay GitHub pointers between roles.**
4. **GitHub durable state is the coordination source of truth.**
5. **Every stop for another actor records `Next Actor`.**
6. **Executor implements; Architect contracts/reviews; Owner holds high authority.**
7. **Material contract changes are durable and explicit.**
8. **PRs carry evidence, not just code.**
9. **Architect acceptance is exact-head-bound.**
10. **Same-principal review fallbacks must be truthfully labeled.**
11. **Ambiguity, stale identity, or unresolved authority fails closed.**
12. **No silent wait.**
13. **No harness-specific duplicate protocol.**
14. **Do not add distributed-workflow machinery before witnessed need.**