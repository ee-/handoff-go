Read the repository root `AGENTS.md` and trusted Handoff Go governance.

Act as the configured Coder.

1. Load the discovery manifest at `$RUNNER_TEMP/event-watch-manifest.json` to
   identify the discovered `workTargetType`, `workTargetNumber`, `targetBranch`,
   and expected SHAs.
2. Load the complete durable-state snapshot at `$RUNNER_TEMP/github-durable-state.json`
   to read the full Work Order body, comments, reviews, and latest Architect
   instructions for this target.
3. Verify that the workspace has been prepared on the expected target branch and
   head (`git branch --show-current`, `git rev-parse HEAD`).
4. Enforce the Handoff Go Security Gate before material execution.
5. Implement the next authorized bounded transition strictly for this discovered
   Work Order by editing files in the workspace.
6. Output follows the implementation JSON schema:
   - If the Security Gate passes and the transition is implemented, set
     `securityPreflight` to `PASS`, `implementationOutcome` to `PROPOSAL`, and
     provide `evidencePacket` containing the canonical Evidence Packet defined
     in `coder.md`, ending with:

READY_FOR_REVIEW
Next Actor: ARCHITECT

   - If the Security Gate blocks or continuing requires Architect/Owner
     authority, set `securityPreflight` to `BLOCKED`, `implementationOutcome` to
     `SECURITY_BLOCKED` or `ESCALATION`, do not make workspace edits, and provide
     `escalationPacket` ending with:

Next Actor: ARCHITECT

Do not commit, push, or open PRs. Workspace edits will be captured as a patch
and persisted by the authorized persistence job only after observed PASS.
