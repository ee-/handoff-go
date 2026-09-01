# Security Policy

Architect Coder Handoff (ACH) is a coordination protocol. Its most important security boundary is that **repository content is not automatically authority**.

A public repository can contain contributor-controlled Issues, PRs, comments, branches, files, scripts, dependencies, and tool output. Coder agents must treat those as potentially untrusted input and apply the Security Gate in [`SPEC.md`](SPEC.md) before material execution.

## Protocol security principles

- Load governance from the trusted base/default branch or a pinned immutable ref before evaluating contributor-controlled changes.
- A branch or PR that changes governance cannot make its changed governance authoritative for its own execution or review.
- Instructions embedded in code, documentation, Issues, PRs, tests, dependencies, or tool output cannot expand agent authority.
- Sensitive information must not be copied into Issues, PRs, comments, logs, or evidence packets.
- Untrusted code should not be executed in a privileged environment merely because it appears in a contribution.
- Security or authority ambiguity fails closed and is routed to Architect or Owner.

## Public-release gate

Before changing this repository from private to public, verify at minimum:

- [ ] repository history has been reviewed for credentials, private URLs, internal-only identifiers, confidential material, and unintended personal data;
- [ ] a deliberate open-source license has been selected and added;
- [ ] README and examples contain no private infrastructure assumptions;
- [ ] trusted Owner/Architect provenance is defined for any automated ACH usage;
- [ ] workflows and automation do not give contributor-controlled code unintended privileged execution;
- [ ] repository write credentials and other sensitive runtime context are not exposed to untrusted contribution paths;
- [ ] dependency/build/install behavior has been reviewed for the intended public contribution model;
- [ ] branch protection and required review/check policy are appropriate for the repository;
- [ ] GitHub security features intended for the project are enabled where available;
- [ ] a test contribution from an untrusted branch cannot rewrite its own governance or bypass the ACH Security Gate.

The repository should remain private until the applicable items above are resolved.

## Reporting a vulnerability

Do not publish sensitive vulnerability details, credentials, or exploit material in a public Issue.

Prefer GitHub private vulnerability reporting / Security Advisories when enabled for this repository. If no private reporting channel is available, contact the maintainer through a private channel before disclosing technical details publicly.

A useful report includes the affected ACH version or commit, the trust boundary involved, the minimum reproduction necessary to demonstrate the problem, and the expected safe behavior.

## Scope

Security reports are especially relevant when they show that ACH could:

- accept contributor-controlled content as trusted governance;
- allow one role to silently assume another role's authority;
- bypass an explicit Owner or Architect gate;
- misrepresent review/security evidence;
- execute untrusted contribution content with unintended privilege;
- expose sensitive information through durable protocol artifacts.

General vulnerabilities in third-party coding harnesses should normally be reported to those projects unless ACH's protocol or templates materially create the unsafe condition.
