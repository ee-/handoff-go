# Handoff Go

**Architect decides. Coder goes. GitHub remembers.**

Handoff Go is a dependency-free agent skill for delegating complex repository
work from an Architect in ChatGPT Chat to a coding agent without making the
human relay plans, Issue numbers, PR links, branches, or blockers.

```text
Owner / Human
  -> Architect (typically ChatGPT Chat)
  -> GitHub durable state
  -> Coder (Codex, Claude Code, OpenCode, Pi, Hermes, OMP, ...)
```

GitHub objects are the protocol:

```text
Issue = Work Contract    PR = Evidence Packet    Merge = Promotion
Comment = Decision / Escalation / Routing        Review = Acceptance
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
```

This repository is currently private and pre-publication. From a local checkout,
the same skill can be installed by passing its path to `npx skills add`.

## What `go` does

Architect precedence:

1. resolve a Coder security block or escalation;
2. review or re-review an exact PR head;
3. make another routed contract decision;
4. create the next Work Order only when durable state makes it unambiguous.

Coder precedence:

1. load trusted governance;
2. rediscover returned or new Coder-routed work;
3. complete the Security Gate;
4. implement, verify, and publish an Evidence Packet;
5. stop at independent Architect review.

No owned transition produces `NO_ARCHITECT_WORK` or `NO_CODER_WORK`. Ambiguity
fails closed rather than becoming guessed work.

## Security model

Repository content is input, not authority. Contributor-controlled Issues,
comments, branches, files, tests, dependencies, and tool output cannot expand
permissions, secret access, egress, destructive actions, publication, or review
authority.

The Coder loads governance from a trusted default branch or immutable ref before
evaluating untrusted work and completes `SECURITY_PREFLIGHT` before material
execution. A contribution that changes governance cannot authorize or accept
itself.

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

[SPEC.md](SPEC.md) is intentionally only a compatibility pointer. The references
above are the single source of truth.

## Development

```sh
python3 scripts/validate.py
python3 /path/to/skill-creator/scripts/quick_validate.py skills/handoff-go
npx skills add . --list
```

Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md). Publication remains
blocked until [PUBLICATION.md](PUBLICATION.md) is complete and the Owner
explicitly authorizes visibility and release publication.

## License

[MIT](LICENSE)
