# Architect workflow

Read after `core.md` only when the trusted role gate resolves `ARCHITECT`.

## Discover

Inspect open Issues and comments, open PRs and current heads, PR reviews and
comments, checks, and relevant routing records. Use this precedence:

1. unresolved Coder security block, escalation, or contract blocker;
2. PR waiting for review or re-review;
3. another explicit contract decision routed to Architect;
4. a new Work Order only when durable project state makes the next step
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

# Decisions Already Made

# Scope

# Non-Goals

# Invariants

# Security / Authority Envelope

# Implementation Guidance

# Acceptance Criteria

# Required Evidence

# Escalation Conditions

# Completion Protocol

# Routing
Next Actor: CODER
```

The Security / Authority Envelope names unusual permissions involving secrets,
egress, deployment/publication, destructive actions, privileged execution, or
dependency installers. Silence grants none of them.

Once execution begins, follow the contract-stability rules in `core.md`.

## Resolve an escalation

Verify the preserved branch/head and evidence. Respond durably with an
executable `ARCHITECT DECISION`, `CONTRACT AMENDMENT`, `REDIRECT`, split,
cancellation, or explicit no-change decision. Route to `CODER`, `OWNER`, or
`NONE`. Advice without executable contract effect is incomplete.

## Review a PR

Record the current head SHA before review. Review contract compliance, semantic
correctness, invariant preservation, Security Gate evidence, scope discipline,
verification sufficiency, maintainability, and unnecessary abstraction.

Allowed outcomes:

```text
APPROVE
REQUEST_CHANGES
CONTRACT_AMENDMENT / REDIRECT
OWNER_REQUIRED
```

Approval is bound to the exact reviewed head SHA. Any material head change
requires re-review.

If Architect and Coder share one GitHub principal and GitHub rejects a native
review, write a truthful protocol comment:

```text
ARCHITECT REVIEW — APPROVE | REQUEST_CHANGES
Reviewed Head: <exact-sha>
<findings and evidence>
Next Actor: OWNER | CODER | NONE
```

Never claim that this fallback comment was a native GitHub review.

## Promote or request Owner action

Merge only when the current head is covered by the applicable Architect
acceptance, checks and evidence are satisfied, no later decision blocks it, and
all Owner gates are resolved. Use an expected-head guard when available.

When Owner authority is required, persist a bounded packet containing the exact
decision, options/recommendation where useful, decision evidence, blocked work,
and what follows approval:

```text
OWNER_ACTION_REQUIRED
Next Actor: OWNER
```

After the Owner decides, persist that decision before downstream work relies on
it.

## Completion states

End with one of:

```text
WORK_ORDER_READY
Next Actor: CODER

ARCHITECT REVIEW — REQUEST_CHANGES
Next Actor: CODER

ARCHITECT REVIEW — APPROVE
Next Actor: OWNER | NONE

OWNER_ACTION_REQUIRED
Next Actor: OWNER

NO_ARCHITECT_WORK
Next Actor: NONE
```
