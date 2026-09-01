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
    SKILL_ROOT / "adapters/omp.mjs",
    SKILL_ROOT / "adapters/pi.mjs",
    SKILL_ROOT / "references/watch.md",
}
REQUIRED = PACKAGE | {
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
        "ROLE_REQUIRED",
        "GITHUB_ACCESS_REQUIRED",
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
    ),
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
    Path(".github/workflows/validate.yml"): (
        "branches: [main]",
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    ),
    SKILL_ROOT / "adapters/omp.mjs": (
        'deliverAs: "followUp"',
        "event.source === \"extension\"",
        "return { handled: true }",
    ),
    SKILL_ROOT / "adapters/pi.mjs": (
        'deliverAs: "followUp"',
        "event.source === \"extension\"",
        'action: "handled"',
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
    # --- Event Watch (v1.2) reference checks ---
    ew = Path(".github/workflows/handoff-go-coder-event-watch.yml")
    check(ew.is_file(), "Event Watch workflow missing")
    ew_text = read(ew)
    check("concurrency:" in ew_text, "Event Watch must set a concurrency group")
    check("timeout-minutes:" in ew_text, "Event Watch must set a finite timeout")
    check("pull_request_target" not in ew_text, "Event Watch must not use pull_request_target")
    check("openai/codex-action@" in ew_text, "Event Watch must invoke the Codex GitHub Action")
    ew_lines = ew_text.splitlines()
    adm = next((i for i, l in enumerate(ew_lines) if "Admission control" in l), -1)
    cdx = next((i for i, l in enumerate(ew_lines) if "openai/codex-action" in l), -1)
    check(adm >= 0 and cdx > adm, "Event Watch: admission must precede Codex invocation")

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
