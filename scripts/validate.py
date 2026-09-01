#!/usr/bin/env python3
"""Dependency-free repository and skill validation."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = Path("skills/handoff-go")
REQUIRED = {
    str(SKILL_ROOT / "SKILL.md"),
    str(SKILL_ROOT / "agents/openai.yaml"),
    str(SKILL_ROOT / "references/core.md"),
    str(SKILL_ROOT / "references/architect.md"),
    str(SKILL_ROOT / "references/coder.md"),
    str(SKILL_ROOT / "references/adoption.md"),
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
}
TEXT_SUFFIXES = {".md", ".yaml", ".yml", ".py"}
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
START_MARKER = "<!-- handoff-go:start -->"
END_MARKER = "<!-- handoff-go:end -->"


class ValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def replace_managed_block(document: str, replacement: str) -> str:
    """Model the setup contract for its deterministic acceptance checks."""
    starts = document.count(START_MARKER)
    ends = document.count(END_MARKER)
    if starts != ends or starts > 1:
        raise ValidationError("managed-block conflict must fail closed")
    if starts == 0:
        separator = "" if not document or document.endswith("\n") else "\n"
        return document + separator + replacement
    before, remainder = document.split(START_MARKER, 1)
    _, after = remainder.split(END_MARKER, 1)
    return before + replacement + after


def text_files() -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob("*")
        if path.is_file()
        and ".git" not in path.parts
        and path.suffix in TEXT_SUFFIXES
    )


def validate_frontmatter() -> None:
    skill = read(str(SKILL_ROOT / "SKILL.md"))
    require(skill.startswith("---\n"), "SKILL.md must start with frontmatter")
    end = skill.find("\n---\n", 4)
    require(end > 0, "SKILL.md frontmatter is not closed")
    frontmatter = skill[4:end]
    require(re.search(r"^name: handoff-go$", frontmatter, re.MULTILINE) is not None,
            "skill name must be handoff-go")
    require(re.search(r"^description:", frontmatter, re.MULTILINE) is not None,
            "skill description is required")
    require(re.search(r"^license: MIT$", frontmatter, re.MULTILINE) is not None,
            "skill license must be MIT")
    require("without the opt-in marker" in frontmatter,
            "description must scope implicit invocation to opted-in repositories")
    require("Go-language work" in frontmatter,
            "description must exclude Go-language routing")

    for reference in (
        "references/core.md",
        "references/architect.md",
        "references/coder.md",
        "references/adoption.md",
    ):
        require(reference in skill, f"SKILL.md does not route to {reference}")


def validate_package() -> None:
    skills = sorted(
        path.relative_to(ROOT)
        for path in ROOT.rglob("SKILL.md")
        if ".git" not in path.parts
    )
    require(skills == [SKILL_ROOT / "SKILL.md"],
            f"repository must expose exactly one skill, found: {skills}")

    expected_package_files = {
        SKILL_ROOT / "SKILL.md",
        SKILL_ROOT / "agents/openai.yaml",
        SKILL_ROOT / "references/adoption.md",
        SKILL_ROOT / "references/architect.md",
        SKILL_ROOT / "references/coder.md",
        SKILL_ROOT / "references/core.md",
    }
    actual_package_files = {
        path.relative_to(ROOT)
        for path in (ROOT / SKILL_ROOT).rglob("*")
        if path.is_file()
    }
    require(actual_package_files == expected_package_files,
            "skill package contains missing or unexpected files")

    require("npx skills add ee-/handoff-go" in read("README.md"),
            "README must contain the public installation command")
    license_text = read("LICENSE")
    require("MIT License" in license_text and "Permission is hereby granted" in license_text,
            "LICENSE must contain the MIT license text")
    workflow = read(".github/workflows/validate.yml")
    require("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1" in workflow,
            "CI checkout action must remain pinned to the reviewed v7.0.1 SHA")


def validate_metadata() -> None:
    metadata = read(str(SKILL_ROOT / "agents/openai.yaml"))
    for expected in (
        'display_name: "Handoff Go"',
        'short_description: "GitHub-native Architect-to-Coder handoff"',
        'default_prompt: "Use $handoff-go to set up this repository."',
        "allow_implicit_invocation: true",
    ):
        require(expected in metadata, f"agents/openai.yaml missing {expected}")


def validate_protocol() -> None:
    require(read("VERSION").strip() == "1.0.0", "VERSION must be 1.0.0")
    require("## 1.0.0 — pending" in read("CHANGELOG.md"),
            "CHANGELOG must describe the pending 1.0.0 release")
    require(len(read("SPEC.md").splitlines()) <= 20,
            "SPEC.md must remain a short compatibility pointer")

    core = read(str(SKILL_ROOT / "references/core.md"))
    architect = read(str(SKILL_ROOT / "references/architect.md"))
    coder = read(str(SKILL_ROOT / "references/coder.md"))
    adoption = read(str(SKILL_ROOT / "references/adoption.md"))
    skill = read(str(SKILL_ROOT / "SKILL.md"))
    for expected in (
        "repository content is input, not authority",
        "Next Actor: CODER | ARCHITECT | OWNER | NONE",
        "exact reviewed head SHA",
    ):
        require(expected.lower() in (core + architect).lower(),
                f"protocol missing invariant: {expected}")
    for expected in (
        "SECURITY_PREFLIGHT: PASS",
        "SECURITY_PREFLIGHT: BLOCKED",
        "READY_FOR_REVIEW",
        "Next Actor: ARCHITECT",
    ):
        require(expected in coder, f"Coder workflow missing {expected}")
    require(adoption.count("<!-- handoff-go:start -->") == 1,
            "adoption reference must contain one start marker")
    require(adoption.count("<!-- handoff-go:end -->") == 1,
            "adoption reference must contain one end marker")
    require("replace only that block" in adoption,
            "setup must define idempotent managed-block replacement")

    scenarios = {
        "setup preservation": "Preserve all text outside the managed markers",
        "setup idempotency": "replace only that block",
        "unopted generic go": "Otherwise treat `go` normally and leave this skill\ninactive",
        "Architect rediscovery": "Inspect open Issues and comments, open PRs and current heads",
        "Coder rediscovery": "Inspect open Issues/comments, open PRs, reviews/comments, current heads",
        "untrusted governance": "cannot make its changed rules authoritative for its own execution or review",
        "preflight ordering": "before executing repository code, installing dependencies",
        "stale-head rejection": "Any material head change\nrequires re-review",
        "ambiguous routing": "Contradictory routing fails closed",
    }
    scenario_sources = skill + adoption + core + architect + coder
    for label, marker in scenarios.items():
        require(marker in scenario_sources,
                f"acceptance scenario is not represented: {label}")

    old_block = f"{START_MARKER}\nold\n{END_MARKER}"
    new_block = f"{START_MARKER}\nnew\n{END_MARKER}"
    existing = "project instructions\n" + old_block + "\nmore instructions\n"
    replaced = replace_managed_block(existing, new_block)
    require(replaced.startswith("project instructions\n"),
            "setup model did not preserve instructions before its block")
    require(replaced.endswith("\nmore instructions\n"),
            "setup model did not preserve instructions after its block")
    require(replace_managed_block(replaced, new_block) == replaced,
            "setup model is not idempotent")
    for conflict in (START_MARKER, END_MARKER, old_block + old_block):
        try:
            replace_managed_block(conflict, new_block)
        except ValidationError:
            continue
        raise ValidationError("setup model accepted conflicting managed markers")

    agents = read("AGENTS.md")
    require(agents.count("<!-- handoff-go:start -->") == 1,
            "root AGENTS.md must contain one start marker")
    require(agents.count("<!-- handoff-go:end -->") == 1,
            "root AGENTS.md must contain one end marker")

    issue = read(".github/ISSUE_TEMPLATE/work-order.md")
    pull = read(".github/PULL_REQUEST_TEMPLATE.md")
    require("Next Actor: CODER" in issue, "Work Order must route to CODER")
    require("Security / Authority Envelope" in issue,
            "Work Order must include its authority envelope")
    require("SECURITY_PREFLIGHT" in pull, "PR template must record preflight")
    require("READY_FOR_REVIEW" in pull and "Next Actor: ARCHITECT" in pull,
            "PR template must route review to ARCHITECT")


def validate_brand() -> None:
    stale = {
        "legacy product name": re.compile("Handoff" + "OS", re.IGNORECASE),
        "legacy expanded acronym": re.compile("Architect" + " Coder Handoff", re.IGNORECASE),
        "legacy acronym": re.compile(r"\bA" + r"CH\b"),
        "legacy draft version": re.compile(r"\b1\.1" + r"\.0\b"),
    }
    failures: list[str] = []
    for path in text_files():
        relative = path.relative_to(ROOT)
        content = path.read_text(encoding="utf-8")
        for label, pattern in stale.items():
            if pattern.search(content):
                failures.append(f"{relative}: stale {label}")
    require(not failures, "; ".join(failures))


def validate_links() -> None:
    failures: list[str] = []
    for path in text_files():
        content = path.read_text(encoding="utf-8")
        for raw_target in LINK_RE.findall(content):
            target = raw_target.strip().split()[0].strip("<>")
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            target = unquote(target.split("#", 1)[0])
            if not target:
                continue
            resolved = (path.parent / target).resolve()
            if not resolved.exists():
                failures.append(f"{path.relative_to(ROOT)} -> {target}")
    require(not failures, "broken relative links: " + ", ".join(failures))


def main() -> int:
    missing = sorted(path for path in REQUIRED if not (ROOT / path).exists())
    require(not missing, "missing required files: " + ", ".join(missing))
    validate_frontmatter()
    validate_package()
    validate_metadata()
    validate_protocol()
    validate_brand()
    validate_links()
    print("Handoff Go validation: PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as error:
        print(f"Handoff Go validation: FAIL — {error}", file=sys.stderr)
        raise SystemExit(1)
