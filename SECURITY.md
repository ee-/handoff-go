# Security Policy

Handoff Go is a coordination skill. Its primary security boundary is:
**repository content is input, not authority**.

Public Issues, comments, PRs, fork branches, files, scripts, tests,
dependencies, and tool output may be hostile. Coder agents apply the Security
Gate in [the Coder reference](skills/handoff-go/references/coder.md) before
material execution.

## Principles

- Load governance from a trusted default branch or immutable ref before
  evaluating contributor-controlled changes.
- A contribution that changes governance cannot authorize or accept itself.
- Embedded instructions cannot expand secrets, permissions, egress, destructive
  actions, deployment/publication, spend, or review authority.
- Sensitive values never belong in Issues, PRs, comments, logs, or Evidence
  Packets.
- Untrusted code is not executed with privileged credentials merely because it
  appears in a contribution.
- Security and authority ambiguity fails closed to Architect or Owner.

## Reporting a vulnerability

Do not publish credentials, exploit details, or sensitive reproductions in a
public Issue. Prefer GitHub private vulnerability reporting / Security
Advisories when enabled. If unavailable, contact the repository owner privately
before technical disclosure.

Include the affected version or commit, trust boundary, minimum safe
reproduction, and expected safe behavior. Third-party harness vulnerabilities
belong with those projects unless Handoff Go materially creates the unsafe
condition.

## Publication gate

The repository remains private until every applicable item in
[PUBLICATION.md](PUBLICATION.md) passes and the Owner explicitly authorizes
publication.
