# Update (`go update`)

Read this reference for `go update` only. It is self-contained: preparing an
update needs no setup/check material.

`go update` is explicit, operator-invoked maintenance. It never runs during
ordinary `go`, a watch tick, or from contributor-controlled Issue/comment/PR
text. It updates only this repository's project-local Handoff Go and its managed
bootstrap pin — never global or unrelated skills.

## Run (the only command)

```sh
node <skill-dir>/update.mjs run [--repo-dir DIR] [--dry-run] [--json]
```

`run` is a launcher, not a second updater. It resolves trusted provenance,
materializes the Handoff Go bytes pinned by the trusted managed bootstrap, and
executes **their** `update.mjs prepare`, passing your flags through and
reporting their exact output and exit status.

> Governance executable provenance = governance data provenance.

The updater that runs is the one trusted governance pins — never the bytes
sitting in the current checkout, which may be stale, contributor-controlled, or
newer than the trusted pin. Pinned bytes are read out of a content-addressed
git object cache under `${XDG_CACHE_HOME:-~/.cache}/handoff-go`, so what
executes is provably the pinned commit's tree. A missing cache is refetched from
the immutable ref; unusable objects fail closed. Extraction is fresh every run,
so no temporary path is ever remembered between sessions, and nothing is
installed globally.

**Fast-path rule.** When the pinned Handoff Go exposes `update.mjs prepare`,
that transaction owns the whole normal path. Do not separately resolve upstream
HEAD, query open update PRs, re-derive the trusted pin, compare `OLD` vs `NEW`,
decide proposal reuse, or inspect the current checkout's Handoff Go version.
Run the one command and report its result.

`run` never passes its own discovery into the trusted updater: that updater
re-establishes provenance itself, so possibly stale launcher bytes can never
supply governance data to trusted code. It also refuses to report success when
the trusted updater produced no result.

If the local copy predates `run`, do the bounded one-time step once — install
the current skill project-locally with `npx skills add ee-/handoff-go`, then use
`run`. Do not fall back to performing the transaction's checks by hand.

## Prepare (the transaction `run` executes)

```sh
node <skill-dir>/update.mjs prepare [--repo-dir DIR] [--dry-run] [--json]
```

One invocation does all mechanically unique work and stops at the first failure:

1. establish trusted provenance in one bounded query: the repository's default
   branch, its exact head, that branch's `AGENTS.md`, and every open pull
   request;
2. derive the pin (`OLD`), Skill path, and trusted branch from that trusted
   copy, failing closed if its managed block is missing, malformed, or names a
   different default branch;
3. resolve the canonical trusted upstream head to one immutable commit `NEW`;
4. `GO_UP_TO_DATE` if `NEW` already equals the pin — no mutation;
5. classify any existing open update proposal **before** any mutation;
6. fetch `OLD` and `NEW` in one bounded upstream fetch, then compare locally;
7. add a bounded proposal worktree on `handoff-go/update-<short-NEW>` at the
   exact discovered trusted head — never the default branch itself, and fail
   closed if that head moved during preparation;
8. verify installed bytes and enabled runtime copies against `OLD`; a drifted or
   unrecognized copy fails closed — never overwrite local edits;
9. install exact `NEW` skill bytes and rewrite only the managed pin/version;
10. refresh recognized enabled watch copies, migrating a legacy `.mjs` entry to
    the `.js` entry; absent integration stays absent;
11. validate the prepared state, reject any change outside managed scope, and
    make exactly one local commit.

The caller may run this from any branch. The working tree is input, never
authority: the pin, Skill path, and trusted branch always come from the trusted
default-branch copy, so a contributor-controlled checkout cannot steer an
update. The caller's tree is left untouched.

The trusted source is fixed to `ee-/handoff-go`; project or contributor content
can never redirect it. Installed bytes and the pin always come from the same
resolved commit, and no floating pin may remain.

Script = mechanism, not policy. The updater decides only mechanical facts. It
never decides acceptance, Architect/Owner approval, Work Order selection,
routing, Security Gate authorization, or default-branch promotion.

## Persist (2 external transitions)

A successful `prepare` reports the internal status `PREPARED` and leaves one
local commit. That is **not** a durable protocol state: `GO_UPDATE_READY` means
the reviewable proposal exists, so emit it only after both steps succeed.

```sh
git push -u origin handoff-go/update-<short-NEW>
gh pr create --base <trusted-default-branch> --head handoff-go/update-<short-NEW> \
  --title "chore(handoff-go): update <old8> -> <new8>" --body-file <evidence.md>
```

Build the PR body from the `--json` evidence: `oldRef`, `newRef`, `version`,
`proposalBranch`, `changedPaths`, `runtime`, `validation`, and `transitions`.
If either step fails, report `GO_UPDATE_CONFLICT`/`GO_UPDATE_ERROR` with the
exact remediation — never `GO_UPDATE_READY`.

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
PR: <url/#>
Next Actor: ARCHITECT
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

Only a same-repository pull request onto the trusted default branch can be an
update proposal: a fork PR may use any head branch name and never carries update
authority. An existing proposal for the same `NEW` is reused and reported with
the standard `GO_UPDATE_READY` and its PR — never duplicated and never a new
outcome name. One targeting a different ref, or a same-repository proposal onto
the wrong base, stops with a conflict; superseding it is an Architect decision,
not the updater's. If proposal discovery is truncated, the transaction fails
closed rather than assume no proposal exists.

An existing local `handoff-go/update-<short-NEW>` branch is never reset: it may
hold unpushed work, so preparation stops with a conflict naming it. The managed
`Skill` path must resolve to a dedicated directory inside the repository; a
root-level path is rejected before any file is removed.

## Performance

Healthy path: `run` costs 1 external transition plus one materialization fetch
only on a cache miss, then 4 inside the transaction (trusted discovery,
upstream resolve, one upstream fetch, one trusted-branch fetch) and 2 outside
(push, PR). The up-to-date path costs 2 inside the transaction — 3 in total
through `run` on a cache hit — and mutates nothing.
Expect tens of seconds. Report the observed round-trips and wall clock in the
Evidence Packet.

## One-time migration for pre-transaction adopters

Repositories pinned before this transaction existed carry an older procedure and
may still have the legacy `.mjs` OMP watch entry. For the first upgrade only:
install the current skill project-locally with `npx skills add ee-/handoff-go`,
then run `run` from it. If the trusted *pin* itself predates
`update.mjs prepare`, `run` says so and that same one-time step applies. The
transaction recognizes the legacy entry and migrates it. Afterwards `go update`
is one command. Add no daemon or background updater for this cold start.
