# Handoff Go `go watch`

Read after `core.md`. `go watch` keeps the current role responsive to durable
Handoff Go workflow changes by repeatedly running the existing full role-relative
`go` discovery semantics. It is a wake mechanism, not a workflow state.

## Command surface

```text
go                  — normal role-relative discovery
go watch            — start watch, default interval 60s (1m)
go watch <interval> — start watch at an interval >= 60s (60s | 1m | 5m | 1h)
go watch stop       — stop the active watch
```

For the Coder role, `go watch` performs one Coder `go` discovery immediately at
activation, then waits the requested cadence and repeats. Below 60s is rejected
and never silently adjusted.

## Canonical watch tick

Every wake runs a fresh, complete Coder `go` discovery — never an Issue-only
poll. It reloads trusted governance and rediscover the durable GitHub state;
correctness never depends on conversation memory from a previous tick.

The canonical internal instruction (one meaning across every harness) is the
`WATCH_TICK_PROMPT` in `watch.mjs`.

## Watch-state rules

Watch state is session/runtime control state only. It is never workflow
authority and never a second source of workflow truth. Runtime-local data is
limited to `active`, `interval`, repo/session identity, and a single pending
wake flag. No new durable protocol state (e.g. `WATCHING`, `AUTO_CODER`) is
introduced.

At most one active Coder run per watched session. A busy tick coalesces to at
most one pending wake; it never queues one wake per missed interval.

## Invariants

- `Next Actor: ARCHITECT` → Coder does nothing on that tick.
- `OWNER_ACTION_REQUIRED` → Coder does nothing; the Architect owns that gate.
- `NO_CODER_WORK` → nothing to do this tick; watch stays active.
- `Next Actor: NONE` → terminal workflow; the watcher may stay active for future
  Coder work.
- Only `go watch stop`, session termination, or documented native watcher
  expiry/termination stop the watcher.
- Watch never widens permissions; every real Coder transition still enforces the
  Security Gate. A timer is not authority.

## Harness compatibility

`Local Watch` is the v1.1 session/runtime `go watch`. `Event Watch` is the
repository-level durable-state wake (v1.2): one GitHub event → one fresh Coder
`go` → exit. It never invokes `go watch`.

| Harness | Local Watch | Event Watch | Mechanism |
|---|---|---|---|
| OMP / Oh My Pi | supported (LIFECYCLE) | HEADLESS_READY, not implemented | `.omp/extensions/` extension |
| Pi coding agent | supported (LIFECYCLE) | HEADLESS_READY, not implemented | `.pi/extensions/` extension |
| Claude Code | — | EVENT_READY (official GitHub Action) | native session scheduler / official integration |
| OpenCode | — | EVENT_READY (official GitHub integration) | native plugin + session `prompt_async` |
| DeepSeek Harness | — | HEADLESS_READY, not implemented | native Cordis timer + `agent.followup` |
| OpenAI Codex | unsupported | **REFERENCE** — supported via official Codex GitHub Action | repository-level GitHub Actions workflow |

`Local Watch` on Codex remains `WATCH_UNSUPPORTED` (a background hook cannot
start a turn; `Stop` continuation needs interactive empirical validation).
Event Watch is the Codex path. Claude Code and OpenCode are documented
EVENT_READY but not shipped; Pi, OMP, and DeepSeek Harness are only
HEADLESS_READY (not implemented).

## Event Watch (v1.2)

Repository-level counterpart to Local Watch. A durable GitHub state event wakes
one fresh Coder `go` execution that rediscover the durable workflow state and
exits. The event payload is a wake signal only, never authority.

- **Reference implementation: OpenAI Codex.** Shipped as
  `.github/workflows/handoff-go-coder-event-watch.yml` using the official
  `openai/codex-action` pinned by full commit SHA. Runs ordinary `go`, not
  `go watch`.
- **Wake-aftering:** `issues` (opened/edited/reopened), `issue_comment`
  (created/edited), `pull_request_review` (submitted),
  `pull_request_review_comment` (created), `workflow_dispatch`. No `push` /
  `pull_request` (those are primarily Architect wake signals).
- **Admission:** native. The Codex Action performs write-access admission before
  any model execution using `${{ github.token }}`; unauthorized actors never
  spend model tokens. No separate shell gate.
- **Authority split:** a `coder-reason` job runs Codex with no GitHub write
  credential exposed (`persist-credentials: false`, read-only) and produces a
  bounded result (`NO_WORK` | `PROPOSAL` | `ESCALATION`) plus a workspace patch;
  a `coder-persist` job (no model key, narrow write permissions) validates and
  applies the bounded result — push/PR or routing evidence.
- **Discovery:** `coder-reason` holds read-only Issues/PRs permission and builds
  a trusted pre-model durable-state snapshot (`.codex/github-state.md`) plus
  fetched refs, so Codex can run the canonical full Coder discovery.
- **Bounded manifest:** Codex emits a structured manifest (`output-schema-file`)
  containing `outcome` + discovered work target + target branch/PR + expected
  head/base SHA; `coder-persist` validates it against the current head before
  mutating GitHub. Persistence targets the **discovered** work, never the wake
  event.
- **Safe persistence:** `coder-persist` configures a bot identity, passes
  `GH_TOKEN` only there, fails closed on a stale/conflicting patch
  (`git apply --check`), creates/updates the discovered branch/PR (idempotent),
  and never swallows a material persistence failure.
- **Concurrency:** GitHub-native `concurrency` group
  (`handoff-go-coder-event-watch`); no lock database or scheduler service.
- **Trusted checkout** of the repository default branch; no `pull_request_target`.
- **Finite timeout**, standard `GITHUB_TOKEN`, canonical wake-only prompt.
- **Explicit opt-in:** a repository owner deliberately adds the workflow. Normal
  `$handoff-go setup` does not enable Event Watch.
- No webhook server, dispatcher daemon, state DB, cross-project context, or
  generic harness framework.

## Normalizing

Harnesses do not share identical internals. They share compatible user
semantics. `$handoff-go setup` is harness-neutral: it writes only the managed
`AGENTS.md` bootstrap block and does not install or configure any coding-agent
binary or adapter file.

### Enabling watch in a harness

The adapter files ship in the skill package (`adapters/omp.mjs`,
`adapters/pi.mjs`). OMP and Pi auto-discover project extensions only in
`.omp/extensions/` / `.pi/extensions/`, so enabling watch is a one-time native
load step:

```sh
mkdir -p .omp/extensions
cp <skill>/watch.mjs .omp/watch.mjs
cp <skill>/adapters/omp.mjs .omp/extensions/handoff-go-watch.mjs

mkdir -p .pi/extensions
cp <skill>/watch.mjs .pi/watch.mjs
cp <skill>/adapters/pi.mjs .pi/extensions/handoff-go-watch.mjs
```

The shared core must be copied to the harness root (`.omp/watch.mjs` /
`.pi/watch.mjs`) because the adapter imports `../watch.mjs` relative to its
`.omp/extensions/`/`.pi/extensions/` location. Copying only the adapter file
would leave that import unresolved. No other harness
needs an adapter copy: Claude Code, OpenCode, DeepSeek Harness, and Codex are
driven by skill instructions and their native capability (see the table above).
