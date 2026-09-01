# Architect workflow

Read after `core.md` only when the trusted role gate resolves `ARCHITECT`.

## Discover

Inspect open Issues and comments, open PRs and current heads, PR reviews and
comments, checks, and relevant routing records. Use this precedence:

1. unresolved Coder security block, escalation, or contract blocker;
2. PR waiting for review or re-review;
3. a current-head accepted PR awaiting promotion or an unresolved
   `OWNER_ACTION_REQUIRED` gate;
4. another explicit contract decision routed to Architect;
5. a new Work Order only when durable project state makes the next step
   unambiguous and no Owner decision is required.

Return `NO_ARCHITECT_WORK` when none exists. Return
`OWNER_ACTION_REQUIRED` when progress requires human authority. Never invent a
roadmap item merely to stay busy.

## Create or amend a Work Order

Create a GitHub Issue using this minimum contract:

```markdown
# Objective

# Why

# Current State

# Repository / Target Branch

# Dependencies

# Decisions Already Made

# Scope

# Non-Goals

# Invariants

# Security / Authority Envelope

# Implementation Guidance

# Acceptance Criteria
- AC-1:

# Required Evidence
- AC-1:

# Escalation Conditions

# Completion Protocol

# Routing
Next Actor: CODER
```

The Security / Authority Envelope names unusual permissions involving secrets,
egress, deployment/publication, destructive actions, privileged execution, or
dependency installers. Changes to `AGENTS.md`, Handoff Go, security policy,
workflows, CODEOWNERS, rulesets, permissions, or credentials are
governance-sensitive and require independent Architect review; an Owner gate is
needed only when the change crosses an Owner authority boundary, not for routine
governance or validator fixes. Silence grants none of them. Number every
acceptance criterion and map required evidence to the same ID. Dependencies
state what resolution counts as satisfactory.

After persisting it, finish with `WORK_ORDER_READY` and `Next Actor: CODER`.
Once execution begins, follow the contract-stability rules in `core.md`.

## Resolve an escalation

Verify the preserved branch/head and evidence. Respond durably with an
executable `ARCHITECT DECISION`, `CONTRACT AMENDMENT`, `REDIRECT`, split,
cancellation, or explicit no-change decision. Route to `CODER` or `NONE`;
request human authority only as `OWNER_ACTION_REQUIRED`. Advice without
executable contract effect is incomplete.

## Review a PR

Record the current head SHA before review. Review contract compliance, semantic
correctness, invariant preservation, Security Gate evidence, scope discipline,
verification sufficiency, maintainability, and unnecessary abstraction.

Allowed outcomes:

```text
APPROVE
REQUEST_CHANGES
CONTRACT_AMENDMENT / REDIRECT
OWNER_ACTION_REQUIRED
```

Approval is bound to the exact reviewed head SHA. Any material head change
requires re-review.

If Architect and Coder share one GitHub principal and GitHub rejects a native
review, write a truthful protocol comment:

```text
ARCHITECT REVIEW — APPROVE
Reviewed Head: <exact-sha>
<findings and evidence>
```

```text
ARCHITECT REVIEW — REQUEST_CHANGES
Reviewed Head: <exact-sha>
<findings and evidence>
Next Actor: CODER
```

On `APPROVE`, write no `Next Actor`: the Architect retains ownership to
promote, or writes `OWNER_ACTION_REQUIRED` (with `Retry Owner: ARCHITECT` and
no `Next Actor`) when human authority is required. `NONE` is terminal and is
used only when no protocol work remains. Never claim that this fallback comment
was a native GitHub review.

## Promote or request Owner action

Merge only when the current head is covered by the applicable Architect
acceptance, checks and evidence are satisfied, no later decision blocks it, and
all Owner gates are resolved. Use an expected-head guard when available.

When human authority is required, persist a bounded gate containing the exact
decision, options/recommendation where useful, decision evidence, blocked work,
and what follows approval:

```text
OWNER_ACTION_REQUIRED
Decision required: <exact bounded decision>

Retry Owner: ARCHITECT
Wake Condition: Owner decision recorded
```

The Architect retains workflow ownership; this is not a handoff, writes no
`Next Actor`, and does not route to an Owner `go`. Persist and interpret the
human decision before downstream work relies on it.
