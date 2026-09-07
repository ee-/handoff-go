# Update (`go update`)

Read this reference for `go update` only. It is self-contained: preparing an
update needs no setup/check material.

`go update` is explicit, operator-invoked maintenance. It never runs during
ordinary `go`, a watch tick, or from contributor-controlled Issue/comment/PR
text. It updates only this repository's project-local Handoff Go and its managed
bootstrap pin — never global or unrelated skills.

## Run (the only command)

Execute the deterministic bootstrap command. It materializes and runs the
trusted pinned updater without evaluating checkout JavaScript, and it owns its
own failure reporting: every expected pre-updater failure emits exactly one
canonical `GO_UPDATE_CONFLICT` (governance/repository state) or `GO_UPDATE_ERROR`
(infrastructure/tooling) outcome with one bounded, actionable reason, then stops
with a non-zero exit. It never exits non-zero with zero terminal output.

```sh
HG_TMP=""; REPO="$PWD"; STORE="${XDG_CACHE_HOME:-$HOME/.cache}/handoff-go/objects.git"; \
command -v node >/dev/null 2>&1 \
  || { printf 'GO_UPDATE_ERROR\nnode is required to run go update (not on PATH)\n'; exit 1; }; \
if [ -d "$STORE" ]; then :; elif git init --bare -q "$STORE" 2>/dev/null; then :; else printf 'GO_UPDATE_ERROR\ncannot initialize the Handoff Go object store\n'; exit 1; fi; \
git fetch -q origin HEAD 2>/dev/null \
  || { printf 'GO_UPDATE_ERROR\ncannot fetch the trusted default branch (git fetch origin HEAD failed); check the origin remote and network\n'; exit 1; }; \
AGENTS_TEXT="$(git show FETCH_HEAD:AGENTS.md 2>/dev/null)" \
  || { printf 'GO_UPDATE_CONFLICT\ntrusted default branch has no readable AGENTS.md; the repository is not opted in\n'; exit 1; }; \
REF_OR_ERR="$(AGENTS_TEXT="$AGENTS_TEXT" node -e 'const b=process.env.AGENTS_TEXT||"",S="<!-- handoff-go:start -->",E="<!-- handoff-go:end -->";const c=(m)=>{console.log("GO_UPDATE_CONFLICT\n"+m);process.exit(1)};const st=b.split(S).length-1,en=b.split(E).length-1;if(st===0&&en===0)c("no Handoff Go managed block found; repository is not opted in");if(st!==1||en!==1)c("expected exactly one managed block, found start="+st+" end="+en);const s=b.indexOf(S),e=b.indexOf(E);if(s<0||e<0||s>=e)c("managed block markers are inverted");const inner=b.slice(s+S.length,e);const refs=[...inner.matchAll(/^[ \t]*-[ \t]*Immutable ref:[ \t]*(.+)$/gm)].map(m=>m[1]);if(refs.length!==1)c("expected exactly one Immutable ref entry in managed block, found "+refs.length);const v=refs[0],co=v.match(/`([^`]+)`/),r=(co?co[1]:v).trim().replace(/^["\x27]+|["\x27]+$/g,"").trim();if(!r)c("empty Immutable ref in managed block");if(!/^(?:[0-9a-f]{40}|[A-Za-z0-9][A-Za-z0-9._\/-]*)$/.test(r))c("malformed Immutable ref in managed block: "+r);if(/^(main|master|develop|trunk|HEAD)$/i.test(r))c("refusing floating governance ref: "+r);console.log(r)' 2>/dev/null)"; NRC=$?; \
if [ "$NRC" -ne 0 ]; then \
  if printf '%s' "$REF_OR_ERR" | grep -q '^GO_UPDATE_'; then printf '%s\n' "$REF_OR_ERR"; else printf 'GO_UPDATE_ERROR\nnode could not run the Handoff Go ref extractor\n'; fi; \
  exit 1; \
fi; \
REF="$REF_OR_ERR"; \
git -C "$STORE" fetch -q --depth 1 https://github.com/ee-/handoff-go.git "$REF" 2>/dev/null \
  || { printf 'GO_UPDATE_ERROR\ncannot materialize pinned Handoff Go %s from the fixed upstream\n' "$REF"; exit 1; }; \
HG_TMP="$(mktemp -d)" || { printf 'GO_UPDATE_ERROR\ncannot create a temporary updater directory\n'; exit 1; }; \
git -C "$STORE" archive --format=tar -o "$HG_TMP/tree.tar" "$REF" skills/handoff-go 2>/dev/null \
  || { printf 'GO_UPDATE_ERROR\npinned Handoff Go %s carries no updater tree\n' "$REF"; rm -rf "$HG_TMP"; exit 1; }; \
tar -xf "$HG_TMP/tree.tar" -C "$HG_TMP" 2>/dev/null \
  || { printf 'GO_UPDATE_ERROR\ncannot extract the pinned Handoff Go updater tree\n'; rm -rf "$HG_TMP"; exit 1; }; \
node --check "$HG_TMP/skills/handoff-go/update.mjs" 2>/dev/null \
  || { printf 'GO_UPDATE_ERROR\npinned Handoff Go updater is not runnable (syntax/load failure)\n'; rm -rf "$HG_TMP"; exit 1; }; \
node "$HG_TMP/skills/handoff-go/update.mjs" prepare --repo-dir "$REPO"; RC=$?; [ -n "$HG_TMP" ] && rm -rf "$HG_TMP"; exit $RC
```

> Governance executable provenance = governance data provenance.

The updater that runs is the one trusted governance pins — never the bytes
sitting in the current checkout, which may be stale, contributor-controlled, or
contain malicious top-level code. The bootstrap never falls back to the working
tree or a local-branch `AGENTS.md`: only the trusted remote default branch read
via `FETCH_HEAD` supplies the pin.

The bootstrap owns the single, bounded failure boundary before `prepare` starts:
each expected pre-updater failure emits exactly one canonical
`GO_UPDATE_CONFLICT` / `GO_UPDATE_ERROR` outcome plus one actionable reason, a
non-zero exit, and no stray tooling diagnostics (git/node/tar stderr is
suppressed). Once `prepare` successfully starts, the bootstrap stops classifying
and preserves its output and exit status verbatim.

1. `node` must be present (`command -v node`); absence emits `GO_UPDATE_ERROR`.
2. The object store is initialized with a guarded `git init`; an init failure
   emits `GO_UPDATE_ERROR`.
3. `git fetch -q origin HEAD` fetches the remote default branch into `FETCH_HEAD`,
   independent of the current checkout branch or working tree. On failure it
   emits `GO_UPDATE_ERROR`.
4. The remote default branch's `AGENTS.md` is read from `FETCH_HEAD`. A missing
   or unreadable `AGENTS.md` emits `GO_UPDATE_CONFLICT`.
5. The stable managed-block `Immutable ref` is extracted and validated (only a
   commit SHA or plain tag passes). Missing, duplicated, malformed, or floating
   refs emit `GO_UPDATE_CONFLICT`. A `node -e` that cannot run the extractor
   emits `GO_UPDATE_ERROR` (the extractor's own canonical conflicts pass through
   unmodified). This mirrors `update.mjs` `classifyBootstrapRef` and is
   deliberately narrower than `parseManagedBlock`, so a launcher reads a newer
   pin without reinterpreting new schema.
6. The content-addressed git object store materializes the exact pinned commit
   from `https://github.com/ee-/handoff-go.git`; any fetch failure emits
   `GO_UPDATE_ERROR`.
7. `git archive` / `tar` extract the updater tree to a fresh temporary directory;
   an absent tree or extraction failure emits `GO_UPDATE_ERROR`.
8. `node --check` verifies the materialized `update.mjs` is runnable; a syntax or
   load failure emits `GO_UPDATE_ERROR` (corrupted pinned updater), not a raw
   Node error.
9. Node executes the materialized updater's `prepare` command against the target
   repository (`--repo-dir "$REPO"`). From here the bootstrap stops classifying:
   `prepare`'s output and exit status pass through verbatim.
10. The temporary extraction is cleaned up only if created by this invocation
   (`[ -n "$HG_TMP" ] && rm -rf "$HG_TMP"`), preserving the command's original
   exit status without touching caller-defined environment variables.

Zero checkout JavaScript is loaded or executed. Extraction is fresh every run,
so no temporary path is ever remembered between sessions, and nothing is
installed globally.

**Fast-path rule.** The trusted `update.mjs prepare` transaction owns the whole
normal path. Do not separately resolve upstream HEAD, query open update PRs,
re-derive the trusted pin, compare `OLD` vs `NEW`, decide proposal reuse, or
inspect the current checkout's Handoff Go version. Run the one command and
report its result. (On an already-trusted checkout, `update.mjs run` can also
be invoked directly.)

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
9. install exact `NEW` skill bytes, rewrite managed pin/version fields, and
   apply bounded declarative migrations (`migrations.json`) defined by the
   target version over the managed block (e.g. routing sentence or versioned
   managed fields); unrecognized or unsupported migrations fail closed;
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

**Repository identity** is established before that discovery: explicit
`GH_REPO=owner/name`, then a standard GitHub HTTPS/SSH origin whose host is
**exactly** `github.com`/`ssh.github.com` (a host that merely contains
`github.com` is not GitHub), then a legitimate SSH `Host` alias — accepted
only when git uses its default OpenSSH transport (no `GIT_SSH`,
`GIT_SSH_COMMAND`, `core.sshCommand`, or `ssh.variant`) and `ssh -G` (pure
local OpenSSH config expansion: no network, no authentication) resolves the
alias's own `hostname` to GitHub. An alias string never proves GitHub by
itself, working tree content never supplies identity, and any unresolvable,
ambiguous, or non-default-transport identity fails closed with
`GH_REPO=owner/name` named as the concrete remediation.

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

After `GO_UPDATE_READY` is emitted, stop immediately. Do not explain previous
promotions or inspect PR history, do not delete or clean up old branches, and do
not review or merge proposals. `Next Actor: ARCHITECT` is the sole promotion
routing; do not tell the user to merge or await promotion.

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
Current ref: <ref>
```
```text
GO_UPDATE_READY
Old ref: <ref>
New ref: <ref>
PR: <url/#>
Next Actor: ARCHITECT
```
```text
GO_UPDATE_CONFLICT
<single actionable reason/remediation>
```
```text
GO_UPDATE_ERROR
<infrastructure remediation, e.g. gh not authenticated>
```

Do not print `GO_UPDATED` — the change is only durable once the Architect
reviews the exact head and promotes the proposal to the trusted default branch.
If the host cannot push or open the PR, stop with the exact remediation; never
claim an update that was not persisted.

### Maintenance stop boundary

`go update` is strictly dependency maintenance through durable proposal
creation. Once it emits a terminal maintenance outcome (`GO_UP_TO_DATE`,
`GO_UPDATE_READY`, `GO_UPDATE_CONFLICT`, or `GO_UPDATE_ERROR`), it stops:

1. **Emit the outcome verbatim**: surface the updater's terminal lines exactly as
   printed — same lines, same order, no rewording, condensing, markdown
   decoration, or added prefix/suffix.
2. **Stop immediately**: no model-authored commentary, explanations, or summaries
   after the protocol outcome.
3. **No promotion-history narration**: do not investigate, explain, or narrate why
   the trusted current pin changed (e.g. whether a previous PR merged). The current
   trusted pin is the only input state.
4. **No branch cleanup**: do not delete local or remote branches from prior
   promoted proposals. Branch lifecycle belongs to the promotion/cleanup owner,
   never dependency maintenance.
5. **No promotion management**: do not approve, review, merge, close, or reopen
   proposals, and do not tell the user to type `merge`. `Next Actor: ARCHITECT` is
   the sole promotion routing.
6. **Diagnostics are read-only**: `--verbose` and `--json` expose evidence on
   demand, but never perform promotion or cleanup actions.

### Quiet by default and diagnostic modes

Quiet by default: ordinary successful `go update` invocations emit only the
standard protocol outcome and fields required for the next action. Discovery
narration, internal reasoning, timing commentary, and implementation details do
not appear by default. Failures output only one actionable reason/remediation.

Detailed evidence is available on demand:
- `--verbose` — displays full commit SHAs, provenance metadata, and transition counts;
- `--json` — emits machine-readable evidence for scripting and PR creation.

### Forward-compatible declarative migrations

When a governed update transitions from an older Handoff Go version to a newer
one, the target version may declare managed-bootstrap schema or routing
transformations in `skills/handoff-go/migrations.json`.

The updater reads this file strictly as declarative data from the materialized
immutable `NEW` commit — never from working-tree files, and never as executable
code.

Allowed operations are bounded strictly to the Handoff Go managed block:
- `replace_routing`: replaces a uniquely identified legacy routing sentence with
  the target routing sentence; both `match` and `replace` must be single-line
  declarations matching the ordinary routing sentence grammar (idempotent no-op
  if already at target; missing, ambiguous, or unrecognized routing fails closed);
- `set_field`: sets or updates an allowed schema-owned managed field (`Version`,
  `Pre-release`); `value` must be a single-line scalar; project authority and
  provenance fields (`Skill`, `Trusted default branch`, `Owner`, `Architect`,
  `Coder`, `Immutable ref`) are protected and cannot be modified by migration data;
- `delete_field`: removes an allowed schema-owned managed field (`Pre-release`).

Safety boundaries:
- multiline / embedded newline values fail closed to prevent grammar escape;
- unsupported manifest schema version (`version > 1`) fails closed;
- unrecognized operation types fail closed;
- project authority and provenance fields (`Skill`, `Owner`, `Architect`, `Coder`,
  `Trusted default branch`, `Immutable ref`) cannot be mutated or deleted by migration data;
- missing, multiple, or ambiguous routing declarations fail closed;
- unrecognized routing sentences fail closed;
- bytes outside `<!-- handoff-go:start/end -->` are never touched and must remain byte-for-byte identical.

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
