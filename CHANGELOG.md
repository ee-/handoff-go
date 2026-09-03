# Changelog

## 1.2.0 — pending

Coder Event Watch (repository-level wake), OpenAI Codex reference:

- `.github/workflows/handoff-go-coder-event-watch.yml` using the official
  `openai/codex-action` (pinned by full commit SHA); one GitHub durable-state
  event → one fresh bounded Coder `go` → persist → exit; never runs `go watch`;
- two-job authority split: `coder-reason` (Codex, no GitHub write credential,
  read-only, `persist-credentials: false`) runs canonical full Coder discovery
  from a complete structured GraphQL snapshot (`$RUNNER_TEMP/github-durable-state.json`)
  plus fetched refs, prepares the workspace on the exact target head, implements
  changes, and captures the bounded manifest and patch into `$RUNNER_TEMP`
  (outside the workspace tree);
- native Codex Action write-access admission (via `${{ github.token }}`), no
  separate shell gate; bounded artifact handoff between jobs;
- persistence targets the **discovered** work (never the wake event), uses a bot
  identity + `GH_TOKEN` only in persist, prohibits mutating the default branch,
  validates remote `targetPR`/branch head matches `expectedHeadSha`, fails closed
  on a stale patch (`git apply --check`) or API failure, and fast-forward pushes
  updates to the target branch;
- wake-aftering events, GitHub-native concurrency, trusted-default checkout,
  finite timeout, standard `GITHUB_TOKEN`;
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
- OMP and Pi native extension adapters (managed timer + follow-up wake, no
  overlapping runs, session-shutdown cleanup);
- per-harness compatibility table (Claude Code, OpenCode, DeepSeek Harness,
  Codex) with native capabilities and a Codex `WATCH_UNSUPPORTED` result.

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
