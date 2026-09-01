# Adopting Handoff Go

Install the skill project-locally:

```sh
npx skills add ee-/handoff-go
```

Then run `$handoff-go setup`. It adds or updates one managed Handoff Go block in
root `AGENTS.md`, preserving all unrelated project instructions. Run
`$handoff-go check` before using ordinary-text `go`.

The canonical setup, validation, upgrade, trust-boundary, and acceptance rules
live in [the adoption reference](skills/handoff-go/references/adoption.md). They
are kept there so the installed skill and this repository do not maintain two
protocol copies.

Use an immutable release tag or commit. A floating branch is not a governance
pin.
