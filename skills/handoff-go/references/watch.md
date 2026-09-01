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

| Harness | Adapter mechanism | Default cadence | Native limitations | Validation level |
|---|---|---|---|---|
| OMP / Oh My Pi | `.omp/extensions/` extension (managed timer + followUp) | 1m | managed timers cleared on `session_shutdown` | LIFECYCLE |
| Pi coding agent | `.pi/extensions/` extension (lifecycle + followUp) | 1m | resources cleaned on `session_shutdown` | source/type-grounded |
| Claude Code | native session scheduler (`CronCreate` / `/loop`) | 1m (as requested) | min 1m interval; recurring task expires after 7 days; jitter; due prompt waits for the active turn | source/doc-grounded |
| OpenCode | native plugin + session `prompt_async` | 1m | session-scoped; busy sessions coalesce | source/doc-grounded |
| DeepSeek Harness | native Cordis timer + `agent.followup` | 1m | `dsh-schedule` `every_seconds` floor is 300s (do not use for 1m) | source/doc-grounded |
| OpenAI Codex | hooks (`UserPromptSubmit`/`Stop`) | — | background hooks cannot start a turn; `Stop` continuation is interactive and requires empirical validation | WATCH_UNSUPPORTED |

`WATCH_UNSUPPORTED` for Codex means autonomous session wake-up is not safely
expressible through the documented runtime without live interactive validation;
it is a capability result, not a failed Work Order.

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
