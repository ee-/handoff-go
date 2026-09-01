# Publication Checklist

Handoff Go is prepared for open source but remains private. Publication requires
an explicit Owner decision after all applicable boxes are checked against the
exact release head.

## Repository

- [x] Public name and slug selected: Handoff Go / `handoff-go`.
- [x] Version set to `1.0.0`.
- [x] MIT license added.
- [x] README, contribution guide, security policy, and changelog added.
- [x] Single distributable skill package and UI metadata validate.
- [x] Package layout preserves supporting references with the current `skills` CLI.
- [x] No runtime dependencies, hooks, plugins, or host-specific adapters.
- [ ] Exact release head independently reviewed and accepted.
- [ ] Repository renamed to `ee-/handoff-go` after merge.
- [ ] Description and topics configured after rename.

## Security and privacy

- [x] All refs and commits scanned for credentials and private keys.
- [x] URLs, email addresses, personal data, and internal identifiers manually reviewed.
- [x] Contributor-controlled governance cannot authorize itself by protocol.
- [x] Privileged execution requires a passed Security Gate.
- [ ] Branch protection and required review/check policy configured.
- [ ] GitHub private vulnerability reporting enabled where available.

## Distribution

- [x] Local project installation smoke test passes on the release candidate.
- [ ] `v1.0.0` tag created after merge.
- [ ] Draft GitHub release prepared while the repository remains private.
- [ ] Public install command verified after visibility changes.
- [ ] Owner explicitly authorizes repository and release publication.

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
- The repository validator exercises setup preservation/idempotency, unopted
  `go`, role rediscovery, untrusted governance, preflight ordering, stale-head
  rejection, and contradictory-routing failure markers.
- The repository is private on `main`. GitHub currently returns HTTP 403 for
  branch protection on this private repository under the present account plan;
  required review/check protection therefore remains a publication gate.
- Private vulnerability reporting could not be verified through the repository
  API while private and remains a publication gate.
