# Contributing

Handoff Go treats workflow and authority text as executable governance.

1. Open a bounded Work Order or explain the intended behavior in the PR.
2. Keep one canonical meaning in one reference; use `skills/handoff-go/SKILL.md` only for routing
   and instructions needed on every invocation.
3. Preserve the trust boundary, exact-head review, durable routing, and
   no-silent-wait invariants.
4. Run `python3 scripts/validate.py` and report the observed result.
5. Include acceptance evidence and `SECURITY_PREFLIGHT` in the PR body.

Protocol, role, security, and root `AGENTS.md` changes require independent
review bound to the exact PR head. Do not include secrets or private
infrastructure details in Issues, PRs, fixtures, or commit history.
