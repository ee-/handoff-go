# Publication Checklist

Handoff Go is prepared for open source but remains private. Publication is a
three-phase, gated transition ordered below. The invariant at every phase
boundary is:

```text
public != released
```

## Phase A — Pre-public gate

Everything below must pass **before** the repository's visibility changes.

### Readiness

- [x] Public name and slug selected: Handoff Go / `handoff-go`.
- [x] Version set to `1.0.0`.
- [x] MIT license added.
- [x] README, contribution guide, security policy, and changelog added.
- [x] Single distributable skill package and UI metadata validate.
- [x] Package layout preserves supporting references with the current `skills` CLI.
- [x] No runtime dependencies, hooks, plugins, or host-specific adapters.
- [x] Release candidate validation passes on the exact release head.
- [ ] Exact release head independently reviewed and accepted.
- [ ] Owner explicitly authorizes changing repository visibility.

### Security and privacy

- [x] All refs and commits scanned for credentials and private keys.
- [x] URLs, email addresses, personal data, and internal identifiers manually reviewed.
- [x] Contributor-controlled governance cannot authorize itself by protocol.
- [x] Privileged execution requires a passed Security Gate.

## Phase B — Public visibility transition

After the Owner authorizes making the repository public:

- [ ] Repository visibility changed to public.
- [ ] Repository renamed to `ee-/handoff-go` if not already done.
- [ ] Branch protection / ruleset or equivalent available protection configured.
- [ ] GitHub private vulnerability reporting enabled where available.
- [ ] Repository description and topics configured if appropriate.
- [ ] Real public install path verified: `npx skills add ee-/handoff-go`.

Passing Phase B makes the repository public; it does **not** mean v1.0.0 is
released.

## Phase C — Release gate

Only after every Phase B check passes:

- [ ] Owner explicitly authorizes the `v1.0.0` release/publication.
- [ ] `v1.0.0` tag created.
- [ ] GitHub Release prepared and published.
- [ ] Released install path verified.

Changing visibility or publishing the release is outside the current Work Order.

## Verification record

- Secret-pattern scan covered every commit reachable from every local and
  remote-tracking ref; no credential or private-key candidate was found.
- Current-tree review found only the public `vercel-labs/skills` documentation
  URL. History contained no embedded URL. The sole identity finding was the
  repository owner's existing Git author name/email in commit metadata; it is
  accepted as normal authorship attribution. No internal identifier was found.
- The bundled skill validator, repository validator, whitespace check, and
  official `skills` CLI discovery passed. A temporary project-local install
  contained exactly `SKILL.md`, `agents/openai.yaml`, and the four references.
- The repository validator checks the required markers for setup preservation,
  unopted `go`, role rediscovery, untrusted governance, preflight ordering,
  stale-head rejection, and contradictory-routing failure.
- The repository is private on `main`. GitHub currently returns HTTP 403 for
  branch protection on this private repository under the present account plan;
  required review/check protection therefore remains a Phase B gate.
- Private vulnerability reporting could not be verified through the repository
  API while private and remains a Phase B gate.
