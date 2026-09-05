# Changelog

## 1.3.0 — pending

`go update` — project-local Handoff Go upgrade:

- explicit, operator-invoked maintenance command (`go update` / `$handoff-go update`)
  routed in `SKILL.md`; never workflow state and never triggered by
  contributor-controlled durable state or a watch tick;
- resolves the latest trusted `ee-/handoff-go` to one immutable commit and
  refreshes the project-local skill, the managed `AGENTS.md` bootstrap pin, and
  any enabled Local Watch runtime copies, migrating a recognizable legacy `.mjs`
  OMP entry to the `.js` native entry;
- opens a reviewable governance proposal (old ref → new ref) rather than writing
  the default branch; outcomes `GO_UP_TO_DATE` / `GO_UPDATE_READY` /
  `GO_UPDATE_CONFLICT` / `GO_UPDATE_ERROR`;
- dependency-free `update.mjs prepare` performs the whole normal-path
  preparation as one deterministic transaction: managed-block parse, canonical
  `NEW` resolution, existing-proposal detection before any mutation, one bounded
  `OLD`+`NEW` upstream fetch, drift verification, bounded proposal worktree off
  the trusted default head, exact-byte install, pin/version rewrite, recognized
  runtime refresh/migration, consumer-side validation, managed-scope guard, and
  one local commit — then emits machine-readable evidence (`--json`);
- update authority is derived only from the trusted default branch: one bounded
  discovery query resolves the default branch, its exact head, that branch's
  `AGENTS.md`, and open proposals, so a contributor-controlled checkout can
  never supply the pin, Skill path, or trusted branch; the transaction also
  fails closed if the trusted head moves mid-preparation;
- quiet by default: ordinary successful Handoff Go commands emit only the durable
  protocol outcome and fields required for the next action; internal reasoning,
  discovery narration, implementation commentary, redundant evidence, and
  performance diagnostics do not appear by default; detailed diagnostics remain
  available via explicit `--verbose` and `--json` flags;
- managed bootstrap command-routing compatibility: protocol upgrades automatically
  upgrade legacy single-command routing in `AGENTS.md` to explicitly include
  `go update` so fresh sessions discover maintenance directly from trusted
  governance without out-of-band knowledge;
- forward-compatible declarative migrations: governed updates apply bootstrap/schema
  transformations declared in `skills/handoff-go/migrations.json` of the target
  version strictly as data; the trusted updater interprets only bounded operations
  over the managed block (`replace_routing`, `set_field`, `delete_field`), avoiding
  arbitrary code execution before promotion while ensuring new schema requirements
  are applied in the same governed transaction;
- governance executable provenance = governance data provenance: `update.mjs run`
  resolves the trusted default-branch bootstrap, materializes the exact Handoff Go
  skill tree pinned there from a content-addressed git object store, and executes
  its `update.mjs prepare`; current checkout bytes, stale feature branches, or
  prior session paths never supply executable authority, and LLM preflight
  (upstream HEAD, open PR, OLD/NEW, reuse) is eliminated in favor of the single
  deterministic command;
- `prepare` reports only the internal status `PREPARED`; `GO_UPDATE_READY` is
  emitted by the Coder after the proposal PR is durably created, and an existing
  same-`NEW` proposal is reused under that same standard outcome;
- update authority requires a same-repository proposal onto the trusted default
  branch: fork PRs never qualify, a wrong base conflicts, and a truncated
  open-PR query fails closed;
- an existing local `handoff-go/update-*` branch is never reset, and a managed
  `Skill` path resolving to the repository root is rejected before any removal;
- consumer update validation proves exact installation plus project integration
  instead of rerunning Handoff Go's upstream unit/conformance suite;
- drifted/unrecognized runtime copies fail closed, absent integration stays
  absent, and local edits are never overwritten;
- managed bootstrap names the cold-start command surface (`go`, `go update`), and
  `references/update.md` keeps update guidance loadable without setup/check
  context;
- healthy path: 4 external transitions inside the transaction, 2 outside
  (push, PR);
- documented one-time migration path for pre-transaction adopters.

## 1.2.0 — pending

Coder Event Watch (repository-level wake), OpenAI Codex reference:

- `.github/workflows/handoff-go-coder-event-watch.yml` using the official
  `openai/codex-action` (pinned by full commit SHA); one GitHub durable-state
  event → one fresh bounded Coder `go` → persist → exit; never runs `go watch`;
- two-job authority split: `coder-reason` (Codex, no GitHub write credential,
  read-only, `persist-credentials: false`) runs canonical full Coder discovery
  from a complete structured GraphQL snapshot (`$RUNNER_TEMP/github-durable-state.json`)
  plus fetched refs, verifies trusted governance immutability on target head
  (root `AGENTS.md`, `AGENTS.override.md`, dynamically resolved `Skill:` directory,
  and `.codex/`), preserves the complete trusted control bundle in `$RUNNER_TEMP`
  before candidate checkout, implements changes, and captures the bounded manifest,
  implementation result, and patch into `$RUNNER_TEMP` (outside the workspace tree);
- public launch trust boundary hardening: removed unsafe PR-review triggers (keeping
  only `issues`, `issue_comment`, `workflow_dispatch`), strictly bound `Skill:` and
  `Immutable ref:` parsing to exactly one valid managed `AGENTS.md` block, and
  updated documentation to reflect public repository / pre-release status;
- post-implementation Security Gate controls persistence: second Codex outputs
  structured implementation result (`handoff-go-event-watch-implement-schema.json`),
  requiring observed `SECURITY_PREFLIGHT: PASS` to proceed to proposal persistence;
  `SECURITY_BLOCKED` routes canonically without applying/pushing patch; unobserved
  evidence fallback removed (fails closed);
- native Codex Action write-access admission (via `${{ github.token }}`), no
  separate shell gate; bounded artifact handoff between jobs;
- persistence targets the **discovered** work (never the wake event), uses a bot
  identity + `GH_TOKEN` only in persist, prohibits mutating the default branch,
  stale-guards new branch base against current default branch, validates remote
  `targetPR`/branch head matches `expectedHeadSha`, fails closed on a stale patch
  (`git apply --check`) or API failure, and fast-forward pushes updates to the
  target branch;
- GitHub-native concurrency, trusted-default checkout, finite timeout, standard
  `GITHUB_TOKEN`;
- canonical wake-only Codex prompt (`.github/codex/handoff-go-coder-event-watch-prompt.md`);
- explicit opt-in: a repository owner enables it; setup does not;
- Codex Event Watch `REFERENCE`; Claude Code / OpenCode documented `EVENT_READY`;
  Pi / OMP / DeepSeek Harness only `HEADLESS_READY` (not implemented);
- Local `go watch` behavior unchanged.

## 1.1.0 — pending

Coder watch (`go watch`):

- `go watch`, `go watch <interval>`, `go watch stop` Coder command surface;
- default 1m cadence, minimum 60s, immediate first discovery;
- canonical watch-tick prompt and shared dependency-free parser core;
- universal extension adapter in `adapters/watch.js`, natively discovered by
  OMP and Pi (`.omp/extensions/handoff-go-watch.js`);
- durable-state fingerprint wake filter: keeps watcher dormant on unchanged
  state, wakes on change, fails open on probe error or pagination truncation,
  and applies observation-watermark rule to prevent race conditions during turns;
- explicit terminal promotion: Architect finishes with `PROMOTED` +
  `Next Actor: NONE` when no protocol work remains;
- per-harness compatibility table updated; Pi Local Watch marked `UNVERIFIED`
  pending real native discovery smoke.
## 1.0.0 — pending

Initial public Handoff Go release candidate:

- one dependency-free universal `handoff-go` skill package;
- project-local setup and read-only adoption check;
- repository-scoped, role-relative ordinary-text `go`;
- Owner / Architect / Coder authority model;
- GitHub-native Work Orders, Evidence Packets, routing, and promotion;
- trusted-governance loading and mandatory Coder Security Gate;
- exact-head Architect review and truthful same-principal fallback;
- fail-closed ambiguity and no-silent-wait invariant;
- dependency-free validation and publication gate.

This supersedes unpublished private development baselines. No earlier public
release exists.
