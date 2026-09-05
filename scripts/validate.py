#!/usr/bin/env python3
"""Dependency-free Handoff Go repository validation."""

import re
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = Path("skills/handoff-go")
PACKAGE = {
    SKILL_ROOT / "SKILL.md",
    SKILL_ROOT / "agents/openai.yaml",
    SKILL_ROOT / "references/adoption.md",
    SKILL_ROOT / "references/architect.md",
    SKILL_ROOT / "references/coder.md",
    SKILL_ROOT / "references/core.md",
    SKILL_ROOT / "watch.mjs",
    SKILL_ROOT / "update.mjs",
    SKILL_ROOT / "adapters/watch.js",
    SKILL_ROOT / "references/watch.md",
    SKILL_ROOT / "references/update.md",
}
REQUIRED = {
    Path(path)
    for path in (
        "README.md",
        "AGENTS.md",
        "CHANGELOG.md",
        "SPEC.md",
        "SECURITY.md",
        "CONTRIBUTING.md",
        "PUBLICATION.md",
        "LICENSE",
        "VERSION",
        ".github/ISSUE_TEMPLATE/work-order.md",
        ".github/PULL_REQUEST_TEMPLATE.md",
        ".github/workflows/validate.yml",
    )
}
REQUIRED_TEXT = {
    SKILL_ROOT / "SKILL.md": (
        "without the opt-in marker",
        "Go-language work",
        "references/core.md",
        "references/architect.md",
        "references/coder.md",
        "references/adoption.md",
        "references/update.md",
        "ROLE_REQUIRED",
        "GITHUB_ACCESS_REQUIRED",
        "go update",
    ),
    SKILL_ROOT / "agents/openai.yaml": (
        'display_name: "Handoff Go"',
        'short_description: "GitHub-native Architect-to-Coder handoff"',
        'default_prompt: "Use $handoff-go to set up this repository."',
        "allow_implicit_invocation: true",
    ),
    SKILL_ROOT / "references/architect.md": (
        "exact reviewed head SHA",
        "Reviewed Head:",
        "WORK_ORDER_READY",
        "# Repository / Target Branch",
        "# Dependencies",
        "- AC-1:",
    ),
    SKILL_ROOT / "references/coder.md": (
        "SECURITY_PREFLIGHT: PASS",
        "SECURITY_PREFLIGHT: BLOCKED",
        "READY_FOR_REVIEW",
        "Next Actor: ARCHITECT",
        "Repository: <owner/name>",
        "Worktree: CLEAN | KNOWN_CHANGES | BLOCKED",
        "AC-n -> observed evidence",
    ),
    SKILL_ROOT / "references/adoption.md": (
        "replace only that block",
        "HANDOFF_GO_BOOTSTRAP_CONFLICT",
        "GO_READY",
        "GO_NOT_READY",
        "go update",
        "update.md",
    ),
    SKILL_ROOT / "references/update.md": (
        "GO_UP_TO_DATE",
        "GO_UPDATE_READY",
        "GO_UPDATE_REUSE_PROPOSAL",
        "GO_UPDATE_CONFLICT",
        "update.mjs prepare",
        "ee-/handoff-go",
        "immutable commit",
        "never overwrite local edits",
        "before** any mutation",
        "One-time migration",
        "Next Actor: ARCHITECT",
    ),
    Path("AGENTS.md"): ("go update",),
    Path("README.md"): ("npx skills add ee-/handoff-go",),
    Path("LICENSE"): ("MIT License", "Permission is hereby granted"),
    Path(".github/ISSUE_TEMPLATE/work-order.md"): (
        "Security / Authority Envelope",
        "Repository / Target Branch",
        "Dependencies",
        "AC-1",
        "Next Actor: CODER",
    ),
    Path(".github/PULL_REQUEST_TEMPLATE.md"): (
        "SECURITY_PREFLIGHT",
        "Execution identity",
        "External effects",
        "AC-1",
        "READY_FOR_REVIEW",
        "Next Actor: ARCHITECT",
    ),
    SKILL_ROOT / "watch.mjs": (
        "WATCH_MIN_SECONDS = 60",
        "parseInterval",
        "parseWatchCommand",
        "WATCH_TICK_PROMPT",
    ),
    SKILL_ROOT / "update.mjs": (
        "export function parseManagedBlock",
        "export function updateManagedBlock",
        "export function prepare",
        "export function classifyProposal",
        "export function planRuntime",
        "export function outsideScope",
        'export const UPSTREAM = "https://github.com/ee-/handoff-go.git"',
        "GO_UPDATE_CONFLICT",
        "floating governance ref",
        "Skill path must not change",
        "Never trim the whole buffer",
    ),
    Path(".github/workflows/validate.yml"): (
        "branches: [main]",
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    ),
    SKILL_ROOT / "adapters/watch.js": (
        'deliverAs: "followUp"',
        "event.source === \"extension\"",
        "parseWatchCommand",
        "getDurableStateFingerprint",
        "baselineFingerprint",
        "wakeFingerprint",
        "ctx?.setInterval",
        'action: "handled"',
        "handled: true",
    ),
    SKILL_ROOT / "references/watch.md": (
        "go watch",
        "WATCH_TICK_PROMPT",
        "WATCH_UNSUPPORTED",
        "At most one active Coder run",
    ),
}
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
STALE = {
    "legacy product name": re.compile("Handoff" + "OS", re.IGNORECASE),
    "legacy expanded acronym": re.compile("Architect" + " Coder Handoff", re.IGNORECASE),
    "legacy acronym": re.compile(r"\bA" + r"CH\b"),
}


def read(path: Path) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"Handoff Go validation: FAIL — {message}")


def text_files() -> list[Path]:
    return [
        path
        for path in ROOT.rglob("*")
        if path.is_file()
        and ".git" not in path.parts
        and path.suffix in {".md", ".py", ".yaml", ".yml"}
    ]


def main() -> None:
    missing = sorted(str(path) for path in REQUIRED if not (ROOT / path).is_file())
    check(not missing, "missing required files: " + ", ".join(missing))

    skills = {
        path.relative_to(ROOT)
        for path in ROOT.rglob("SKILL.md")
        if ".git" not in path.parts
    }
    check(skills == {SKILL_ROOT / "SKILL.md"}, f"expected one skill, found {skills}")
    packaged = {
        path.relative_to(ROOT)
        for path in (ROOT / SKILL_ROOT).rglob("*")
        if path.is_file()
    }
    check(packaged == PACKAGE, "skill package contains missing or unexpected files")

    skill = read(SKILL_ROOT / "SKILL.md")
    match = re.match(r"---\n(.*?)\n---\n", skill, re.DOTALL)
    check(match is not None, "SKILL.md frontmatter is missing or malformed")
    frontmatter = match.group(1)
    for field in (r"^name: handoff-go$", r"^description:", r"^license: MIT$"):
        check(re.search(field, frontmatter, re.MULTILINE) is not None,
              f"SKILL.md frontmatter missing {field}")

    for path, needles in REQUIRED_TEXT.items():
        content = read(path)
        for needle in needles:
            check(needle in content, f"{path} missing {needle}")

    check(read(Path("VERSION")).strip() == "1.0.0", "VERSION must be 1.0.0")
    check("## 1.0.0 — pending" in read(Path("CHANGELOG.md")),
          "CHANGELOG must describe pending 1.0.0")
    check(len(read(Path("SPEC.md")).splitlines()) <= 20,
          "SPEC.md must remain a short compatibility pointer")

    adoption = read(SKILL_ROOT / "references/adoption.md")
    agents = read(Path("AGENTS.md"))
    for path, content in (("adoption reference", adoption), ("AGENTS.md", agents)):
        check(content.count("<!-- handoff-go:start -->") == 1,
              f"{path} must contain one start marker")
        check(content.count("<!-- handoff-go:end -->") == 1,
              f"{path} must contain one end marker")

    protocol = " ".join(" ".join(read(path).split()) for path in PACKAGE if path.suffix == ".md")
    for behavior in (
        "Preserve all text outside the managed markers",
        "Otherwise treat `go` normally and leave this skill inactive",
        "Inspect open Issues and comments, open PRs and current heads",
        "Inspect open Issues/comments, open PRs, reviews/comments, current heads",
        "cannot make its changed rules authoritative for its own execution or review",
        "before executing repository code, installing dependencies",
        "Any material head change requires re-review",
        "Contradictory routing fails closed",
        "closed-unmerged PR is not success",
        "Never blindly retry an irreversible or non-idempotent effect",
        "query by operation key",
        "Next Actor` transfers ownership to a different role",
        "It is not a handoff and writes no `Next Actor`",
    ):
        check(behavior in protocol, f"acceptance behavior missing: {behavior}")

    check("Next Actor: CODER" not in read(SKILL_ROOT / "references/coder.md"),
          "Coder workflow contains self-routing")
    check("Next Actor: ARCHITECT" not in read(SKILL_ROOT / "references/architect.md"),
          "Architect workflow contains self-routing")
    check("PROMOTED" in read(SKILL_ROOT / "references/architect.md")
          and "Next Actor: NONE" in read(SKILL_ROOT / "references/architect.md"),
          "Architect workflow must return PROMOTED with Next Actor: NONE upon terminal promotion")
    check("Next Actor: OWNER" not in protocol,
          "protocol routes to Owner as an executable role")
    # --- Event Watch (v1.2) reference checks ---
    ew = Path(".github/workflows/handoff-go-coder-event-watch.yml")
    check(ew.is_file(), "Event Watch workflow missing")
    ew_text = read(ew)
    check("concurrency:" in ew_text, "Event Watch must set a concurrency group")
    check("timeout-minutes:" in ew_text, "Event Watch must set a finite timeout")
    check("pull_request_target" not in ew_text, "Event Watch must not use pull_request_target")
    check("pull_request_review" not in ew_text, "Event Watch must not trigger on pull_request_review")
    check("pull_request_review_comment" not in ew_text, "Event Watch must not trigger on pull_request_review_comment")
    check("openai/codex-action@" in ew_text, "Event Watch must invoke the Codex GitHub Action")
    # Native write-access admission is done by the Codex Action (via github.token).
    check("collaborators/" not in ew_text,
          "Event Watch must rely on the Codex Action native admission")
    # Two-job authority split: reason (no write cred) -> persist (write).
    check("persist-credentials: false" in ew_text,
          "Event Watch reason checkout must not persist GitHub credentials")
    check("coder-reason" in ew_text and "coder-persist" in ew_text,
          "Event Watch must split reason (no write cred) from persist (write)")
    check("output-file:" in ew_text,
          "Event Watch reason job must capture a bounded result")
    check("actions/upload-artifact@" in ew_text and "actions/download-artifact@" in ew_text,
          "Event Watch must hand the bounded result via pinned artifacts")
    reason_part = ew_text.split("coder-persist:")[0]
    persist_part = ew_text.split("coder-persist:")[1] if "coder-persist:" in ew_text else ""
    check("openai-api-key:" in reason_part, "Event Watch reason job must run Codex with the model key")
    check("issues: write" not in reason_part and "pull-requests: write" not in reason_part,
          "Event Watch reason job must not hold GitHub write permissions")
    check("issues: write" in persist_part and "pull-requests: write" in persist_part,
          "Event Watch persist job must hold write permissions")
    check("openai-api-key:" not in persist_part,
          "Event Watch persist job must not hold the model key")
    # Read-only discovery + structured manifest + safe persistence.
    check("issues: read" in reason_part and "pull-requests: read" in reason_part,
          "Event Watch reason job must hold read-only Issues/PRs permission")
    check("RUNNER_TEMP/github-durable-state.json" in ew_text,
          "Event Watch reason job must produce a complete structured durable-state snapshot in RUNNER_TEMP")
    check("gh api graphql" in ew_text and "pageInfo" in ew_text and "hasNextPage" in ew_text,
          "Event Watch must query complete durable state via GraphQL and check for truncation")
    check("output-schema-file:" in ew_text,
          "Event Watch reason job must emit a structured bounded manifest")
    check(Path(".github/codex/handoff-go-event-watch-schema.json").is_file(),
          "Event Watch manifest schema file missing")
    check(Path(".github/codex/handoff-go-coder-event-watch-implement-prompt.md").is_file(),
          "Event Watch implement prompt file missing")
    check("runner.temp" in ew_text,
          "Event Watch must place runtime manifest and patch outside workspace tree")
    check("DEFAULT_BRANCH" in persist_part,
          "Event Watch persist job must prohibit mutating default branch")
    check("expectedHeadSha" in persist_part,
          "Event Watch persist job must validate expectedHeadSha")
    check("targetPR" in persist_part,
          "Event Watch persist job must validate and update target PR")
    check("git push origin \"$targetBranch\"" in persist_part,
          "Event Watch persist job must fast-forward push target branch")
    check("GH_TOKEN: ${{ github.token }}" in persist_part,
          "Event Watch persist job must pass the GitHub token to gh")
    check("git config user.name" in persist_part,
          "Event Watch persist job must configure a bot identity")
    check("git apply --check" in persist_part,
          "Event Watch persist job must fail closed on a stale patch")
    check("git add -N ." in ew_text and "git add -N . 2>/dev/null || true" not in ew_text,
          "Event Watch patch capture must fail closed on git add -N")
    check("expectedHeadSha" in reason_part,
          "Event Watch reason job must enforce expectedHeadSha when resuming")
    check("git apply" in persist_part and "git apply event-watch.patch || true" not in persist_part,
          "Event Watch persist job must not swallow a patch-apply failure")
    check("trustedSkillDir" in reason_part and "AGENTS.md" in reason_part,
          "Event Watch reason job must verify trusted governance immutability on target head")
    check("AGENTS.override.md" in reason_part,
          "Event Watch reason job must check AGENTS.override.md immutability")
    check("<!-- handoff-go:start -->" in reason_part and "<!-- handoff-go:end -->" in reason_part,
          "Event Watch reason job must parse Skill path strictly from managed block")
    check("head -n1" not in reason_part,
          "Event Watch must not use generic first-match Skill parsing")
    check("control-bundle" in reason_part,
          "Event Watch reason job must preserve complete control bundle in temp before candidate checkout")
    check("control-bundle/handoff-go-coder-event-watch-prompt.md" in reason_part,
          "Event Watch discover step must use trusted prompt copy")
    check("control-bundle/handoff-go-event-watch-schema.json" in reason_part,
          "Event Watch discover step must use trusted schema copy")
    check("control-bundle/handoff-go-coder-event-watch-implement-prompt.md" in reason_part,
          "Event Watch implement step must use trusted prompt copy")
    check("control-bundle/handoff-go-event-watch-implement-schema.json" in reason_part,
          "Event Watch implement step must use trusted schema copy")
    check("stale base" in reason_part and "stale base" in persist_part,
          "Event Watch must stale-guard new branch base in both reason and persist")
    check(Path(".github/codex/handoff-go-event-watch-implement-schema.json").is_file(),
          "Event Watch implement schema file missing")
    check("SECURITY_PREFLIGHT: PASS" in persist_part and "SECURITY_BLOCKED" in persist_part,
          "Event Watch persist job must let implementation Security Gate control persistence")
    check("READY_FOR_REVIEW" in persist_part and "Next Actor: ARCHITECT" in persist_part,
          "Event Watch persist job must persist canonical routing to Architect")
    check("export BODY_FILE" in persist_part and "fs.writeFileSync(process.env.BODY_FILE" in persist_part,
          "Event Watch persist job must export BODY_FILE before writing observed evidence")
    check(persist_part.find("export BODY_FILE") < persist_part.find("fs.writeFileSync(process.env.BODY_FILE"),
          "Event Watch persist job must export BODY_FILE before node writeFileSync")
    check("unobserved evidence" in persist_part.lower(),
          "Event Watch persist job must fail closed on unobserved security evidence")
    # Documentation must reflect public repository / pre-release status.
    readme = read(Path("README.md"))
    check("currently private" not in readme and "remains private" not in readme,
          "README must not claim repository is private")
    check("is public" in readme, "README must state repository is public")
    readme_zh = read(Path("README.zh-CN.md"))
    check("当前仍为 private" not in readme_zh,
          "README.zh-CN must not claim repository is private")
    check("目前已公开" in readme_zh, "README.zh-CN must state repository is public")
    check("explicit opt-in" in ew_text.lower() or "explicit opt-in" in read(SKILL_ROOT / "references/watch.md").lower(),
          "Event Watch must remain explicit opt-in")
    # All third-party Actions across workflows must be pinned to a full commit SHA.
    for wf in (ROOT / ".github/workflows").glob("*.yml"):
        wf_text = wf.read_text(encoding="utf-8")
        for m in re.finditer(r"uses:\s*(\S+)", wf_text):
            uses = m.group(1)
            if "@" in uses:
                _, ref = uses.rsplit("@", 1)
                if not re.fullmatch(r"[0-9a-f]{40}", ref):
                    check(False, f"{wf.name}: action not pinned to a full SHA: {uses}")

    # Canonical Codex Event Watch prompt must be wake-only and exactly-one-go.
    ew_prompt = Path(".github/codex/handoff-go-coder-event-watch-prompt.md")
    check(ew_prompt.is_file(), "Event Watch prompt file missing")
    pr_text = ew_prompt.read_text(encoding="utf-8")
    for needle in ("wake signal only", "exactly one ordinary Handoff Go", "no actionable Coder work", "Security Gate"):
        check(needle in pr_text, f"Event Watch prompt missing: {needle}")

    failures = []
    for path in text_files():
        content = path.read_text(encoding="utf-8")
        relative = path.relative_to(ROOT)
        for label, pattern in STALE.items():
            if pattern.search(content):
                failures.append(f"{relative}: {label}")
        for raw in LINK_RE.findall(content):
            target = unquote(raw.strip().split()[0].strip("<>").split("#", 1)[0])
            if target and not target.startswith(("http://", "https://", "mailto:")):
                if not (path.parent / target).resolve().exists():
                    failures.append(f"{relative}: broken link {target}")
    check(not failures, "; ".join(failures))
    print("Handoff Go validation: PASS")


if __name__ == "__main__":
    main()
