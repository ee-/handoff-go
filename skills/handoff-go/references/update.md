# Update (`go update`)

Read this reference for `go update` only. It is self-contained: preparing an
update needs no setup/check material.

`go update` is explicit, operator-invoked maintenance. It never runs during
ordinary `go`, a watch tick, or from contributor-controlled Issue/comment/PR
text. It updates only this repository's project-local Handoff Go and its managed
bootstrap pin — never global or unrelated skills.

## Prepare (one deterministic transaction)

```sh
node <skill-dir>/update.mjs prepare [--repo-dir DIR] [--dry-run] [--json]
```

One invocation does all mechanically unique work and stops at the first failure:

1. parse the trusted managed block (one Skill path, one immutable ref);
2. resolve the canonical trusted upstream head to one immutable commit `NEW`;
3. `GO_UP_TO_DATE` if `NEW` already equals the pin — no mutation;
4. detect an existing open Handoff Go update proposal **before** any mutation;
5. fetch `OLD` and `NEW` in one bounded upstream fetch, then compare locally;
6. add a bounded proposal worktree on `handoff-go/update-<short-NEW>` from the
   trusted default head — never the default branch itself;
7. verify installed bytes and enabled runtime copies against `OLD`; a drifted or
   unrecognized copy fails closed — never overwrite local edits;
8. install exact `NEW` skill bytes and rewrite only the managed pin/version;
9. refresh recognized enabled watch copies, migrating a legacy `.mjs` entry to
   the `.js` entry; absent integration stays absent;
10. validate the prepared state, reject any change outside managed scope, and
    make exactly one local commit.

The trusted source is fixed to `ee-/handoff-go`; project or contributor content
can never redirect it. Installed bytes and the pin always come from the same
resolved commit, and no floating pin may remain.

Script = mechanism, not policy. The updater decides only mechanical facts. It
never decides acceptance, Architect/Owner approval, Work Order selection,
routing, Security Gate authorization, or default-branch promotion.

## Persist (2 external transitions)

`GO_UPDATE_READY` leaves one local commit. Persist it, then hand off:

```sh
git push -u origin handoff-go/update-<short-NEW>
gh pr create --base <trusted-default-branch> --head handoff-go/update-<short-NEW> \
  --title "chore(handoff-go): update <old8> -> <new8>" --body-file <evidence.md>
```

Build the PR body from the `--json` evidence: `oldRef`, `newRef`, `version`,
`proposalBranch`, `changedPaths`, `runtime`, `validation`, and `transitions`.

## Consumer validation boundary

Verify exact installation plus this project's own integration:

- installed skill bytes equal `NEW`;
- managed pin equals `NEW`;
- enabled managed runtime copies are recognized and equal `NEW`;
- bytes outside the managed block are preserved and no unrelated path changed;
- the repository's own check/CI passes.

Do not rerun Handoff Go's upstream unit/conformance suite to prove an upstream
commit was installed; upstream CI owns that suite.

## Outcomes

```text
GO_UP_TO_DATE
Current ref: <sha>
```
```text
GO_UPDATE_READY
Old ref: <sha>
New ref: <sha>
Branch: handoff-go/update-<short-NEW>
PR: <url/#>
Next Actor: ARCHITECT
```
```text
GO_UPDATE_REUSE_PROPOSAL
Existing PR: <url>
```
```text
GO_UPDATE_CONFLICT
<exact reason / remediation, e.g. drifted copy path, proposal targeting another ref>
```
```text
GO_UPDATE_ERROR
<infrastructure remediation, e.g. gh not authenticated>
```

Do not print `GO_UPDATED` — the change is only durable once the Architect
reviews the exact head and promotes the proposal to the trusted default branch.
If the host cannot push or open the PR, stop with the exact remediation; never
claim an update that was not persisted.

An existing proposal for the same `NEW` is reused, never duplicated. One
targeting a different ref stops with a conflict; superseding it is an Architect
decision, not the updater's.

## Performance

Healthy path: 4 external transitions inside the transaction (resolve, proposal
check, one upstream fetch, one trusted-branch fetch) and 2 outside (push, PR).
Expect tens of seconds. Report the observed round-trips and wall clock in the
Evidence Packet.

## One-time migration for pre-transaction adopters

Repositories pinned before this transaction existed carry an older procedure and
may still have the legacy `.mjs` OMP watch entry. For the first upgrade only:
run `go update` from the pinned skill; if that version has no
`update.mjs prepare`, install the current skill project-locally with
`npx skills add ee-/handoff-go`, then run `prepare` from it. The transaction
recognizes the legacy entry and migrates it. Afterwards `go update` is normal.
Do not add a daemon or launcher to solve this cold start.
