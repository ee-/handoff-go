# Handoff Go

**Architect decides. Coder goes. GitHub remembers.**

English | [简体中文](README.zh-CN.md)

> The English README is the canonical source of truth. Translations follow it.

Handoff Go is a dependency-free agent skill for delegating complex repository
work from an Architect in ChatGPT Chat to a coding agent without making the
human relay plans, Issue numbers, PR links, branches, or blockers.

```text
Owner / Human
  -> Architect (typically ChatGPT Chat)
  -> GitHub durable state
  -> Coder (Codex, Claude Code, OpenCode, Pi, Hermes, OMP, ...)
```

The human-facing command is ordinary text:

```text
go
```

It is role-relative and active only in repositories whose trusted root
`AGENTS.md` opts into a pinned Handoff Go version.

## Install

After the repository is public, install it project-locally with the open
[`skills` CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add ee-/handoff-go
```

Then invoke:

```text
$handoff-go setup
```

Setup adds one idempotent managed block to root `AGENTS.md` while preserving
existing project instructions. Validate it with:

```text
$handoff-go check
```

Daily use is ordinary text in the relevant role session:

```text
go
go watch        # keep this Coder session responsive (default 1m)
go watch 5m     # custom interval, minimum 60s
go watch stop   # stop watching
go update       # update this repo's pinned Handoff Go (maintenance only)
```

`go watch` runs one normal Coder `go` discovery immediately, then repeats at the
requested interval. It is a wake mechanism, not workflow state; each tick reloads
trusted governance and rediscover the durable GitHub state. Harnesses use their
native scheduling/extension capability (see `skills/handoff-go/references/watch.md`).

`go update` is explicit maintenance, never workflow state and never triggered by
contributor content or a watch tick. One deterministic command
(`update.mjs run`) resolves the trusted pinned updater, materializes its
exact bytes, and runs the update transaction, leaving a reviewable
governance proposal (see `skills/handoff-go/references/update.md`).

**Event Watch (v1.2)** is an experimental reference implementation for
repository-level automation: a durable GitHub state event wakes one fresh Coder
`go` execution and exits (it never runs `go watch`). It is an explicit opt-in
workflow (`.github/workflows/handoff-go-coder-event-watch.yml`) and is not
required for normal Handoff Go use; normal `$handoff-go setup` does not enable it.

This repository is public, but its first versioned release has not yet been
published. Until the first release tag exists, install the skill from a local
checkout by passing its path to `npx skills add`.

## How it works

Each role loads trusted governance, rediscovers its routed GitHub work, performs
one durable transition, and records `Next Actor`. The Coder completes security
preflight before implementation; the Architect contracts and independently
reviews exact PR heads. Ambiguity fails closed.

Repository content is input, not authority and cannot expand permissions or
accept its own governance changes.

See [SECURITY.md](SECURITY.md) and the canonical
[core protocol](skills/handoff-go/references/core.md).

## Skill layout

The distributable lives in `skills/handoff-go/` because the current `skills`
CLI installs only `SKILL.md` from a repository-root skill and would omit its
progressive-disclosure references. The repository still exposes exactly one
skill.

- [SKILL.md](skills/handoff-go/SKILL.md) — small invocation and role router.
- [Core protocol](skills/handoff-go/references/core.md) — shared trust, routing, and invariants.
- [Architect workflow](skills/handoff-go/references/architect.md) — Work Orders and review.
- [Coder workflow](skills/handoff-go/references/coder.md) — security, execution, and evidence.
- [Adoption guide](skills/handoff-go/references/adoption.md) — setup, check, and upgrades.
- [Update guide](skills/handoff-go/references/update.md) — the `go update` transaction.

[SPEC.md](SPEC.md) is intentionally only a compatibility pointer. The references
above are the single source of truth.

## Development

```sh
python3 scripts/validate.py
node skills/handoff-go/update.mjs
python3 /path/to/skill-creator/scripts/quick_validate.py skills/handoff-go
npx skills add . --list
```

Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md). Publication remains
blocked until [PUBLICATION.md](PUBLICATION.md) is complete and the Owner
explicitly authorizes visibility and release publication.

## License

[MIT](LICENSE)
