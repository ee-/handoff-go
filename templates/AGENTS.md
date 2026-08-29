# Agent bootstrap

This repository uses **HandoffOS v1** for Architect ↔ Executor handoff.

## Canonical protocol

- Upstream: `ee-/HandoffOS`
- Pinned ref: `<PINNED_COMMIT_OR_TAG>`
- Canonical spec: `SPEC.md` at that pinned ref
- Local vendored path, if used: `.handoffos/SPEC.md`

Read the pinned HandoffOS specification before interpreting repository workflow commands.

## Roles

- Owner: `<OWNER>`
- Architect: `<ARCHITECT — e.g. ChatGPT>`
- Executor: `<EXECUTOR — e.g. OMP>`

## Repository command

The human-facing repository command is ordinary text:

```text
go
```

Its semantics are defined only by the pinned HandoffOS specification and are role-relative.

Do not replace it with a harness-specific slash command. Do not maintain another copy of the `go` protocol in OMP/Codex/Claude/OpenCode/Pi configuration. Do not ask the human to relay Issue/PR numbers during normal operation.

## Project-specific governance

Read: `<PROJECT_GOVERNANCE_PATH_OR_NONE>`

Project-specific governance may add domain invariants and authority gates. It must not silently redefine the pinned HandoffOS protocol.
