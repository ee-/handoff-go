#!/usr/bin/env python3
"""Dependency-free Handoff Go repository validation.

Proves machine-relevant structure, authority, provenance, and security
invariants. It deliberately does NOT assert that particular explanatory
sentences survive byte-for-byte in documentation: prose is reviewed, not linted.
"""

import json
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
    SKILL_ROOT / "bootstrap.mjs",
    SKILL_ROOT / "adapters/watch.js",
    SKILL_ROOT / "references/watch.md",
    SKILL_ROOT / "references/update.md",
    SKILL_ROOT / "migrations.json",
}
REQUIRED = {
    Path(path)
    for path in (
        "README.md",
        "AGENTS.md",
        "CHANGELOG.md",
        "SECURITY.md",
        "CONTRIBUTING.md",
        "LICENSE",
        "VERSION",
        ".github/ISSUE_TEMPLATE/work-order.md",
        ".github/PULL_REQUEST_TEMPLATE.md",
        ".github/workflows/validate.yml",
    )
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
    # --- package structure ---
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

    # --- managed bootstrap: markers, command router, migration reachability ---
    adoption = read(SKILL_ROOT / "references/adoption.md")
    agents = read(Path("AGENTS.md"))
    declarations = {}
    for path, content in (("adoption reference", adoption), ("AGENTS.md", agents)):
        check(content.count("<!-- handoff-go:start -->") == 1,
              f"{path} must contain one start marker")
        check(content.count("<!-- handoff-go:end -->") == 1,
              f"{path} must contain one end marker")
        block = content.split("<!-- handoff-go:start -->")[1].split("<!-- handoff-go:end -->")[0]
        lines = [line for line in block.splitlines() if line.startswith("For the exact ordinary-text message")]
        check(len(lines) == 1,
              f"{path} managed block must hold exactly one routing declaration line, found {len(lines)}")
        declarations[path] = lines[0]
        for needle in (
            "this block claims those commands",
            "before consulting any checkout-local, harness-discovered, or globally installed skill",
            "load exactly that pinned implementation",
            "without rediscovering or reinterpreting the command",
            "keep normal skill discovery",
        ):
            check(needle in lines[0],
                  f"{path} routing declaration missing routing authority text: {needle}")
    check(len(set(declarations.values())) == 1,
          "AGENTS.md and the setup template must ship a byte-identical routing declaration")
    migrations = json.loads(read(SKILL_ROOT / "migrations.json"))
    targets = [op.get("replace") for op in migrations["operations"] if op.get("type") == "replace_routing"]
    check(declarations["AGENTS.md"] in targets,
          "migrations.json must migrate adopted blocks onto the current routing declaration")

    # --- authority: no role routes to itself, promotion is terminal, Owner is not executable ---
    protocol = " ".join(read(path) for path in PACKAGE if path.suffix == ".md")
    architect = read(SKILL_ROOT / "references/architect.md")
    check("Next Actor: CODER" not in read(SKILL_ROOT / "references/coder.md"),
          "Coder workflow contains self-routing")
    check("Next Actor: ARCHITECT" not in architect,
          "Architect workflow contains self-routing")
    check("PROMOTED" in architect and "Next Actor: NONE" in architect,
          "Architect workflow must return PROMOTED with Next Actor: NONE upon terminal promotion")
    check("Next Actor: OWNER" not in protocol,
          "protocol routes to Owner as an executable role")

    # --- Event Watch: authority split and forbidden triggers only ---
    ew = Path(".github/workflows/handoff-go-coder-event-watch.yml")
    check(ew.is_file(), "Event Watch workflow missing")
    ew_text = read(ew)
    for trigger in ("pull_request_target", "pull_request_review", "pull_request_review_comment"):
        check(trigger not in ew_text, f"Event Watch must not trigger on {trigger}")
    check("openai/codex-action@" in ew_text, "Event Watch must invoke the Codex GitHub Action")
    check("coder-reason" in ew_text and "coder-persist" in ew_text,
          "Event Watch must split reason (no write cred) from persist (write)")
    reason, _, persist = ew_text.partition("coder-persist:")
    check("openai-api-key:" in reason, "Event Watch reason job must run Codex with the model key")
    check("persist-credentials: false" in reason,
          "Event Watch reason checkout must not persist GitHub credentials")
    check("issues: read" in reason and "pull-requests: read" in reason,
          "Event Watch reason job must hold read-only Issues/PRs permission")
    check("issues: write" not in reason and "pull-requests: write" not in reason,
          "Event Watch reason job must not hold GitHub write permissions")
    check("issues: write" in persist and "pull-requests: write" in persist,
          "Event Watch persist job must hold write permissions")
    check("openai-api-key:" not in persist,
          "Event Watch persist job must not hold the model key")
    check("output-file:" in reason and "actions/upload-artifact@" in ew_text
          and "actions/download-artifact@" in ew_text,
          "Event Watch must hand the bounded result from reason to persist via pinned artifacts")
    check("DEFAULT_BRANCH" in persist,
          "Event Watch persist job must prohibit mutating default branch")
    # --- AC-4: reusable bootstrap/updater logic never carries a current SHA ---
    for path in sorted(p for p in PACKAGE if p.suffix in (".mjs", ".js")):
        code = read(path)
        check(re.search(r"\b[0-9a-f]{40}\b", code) is None,
              f"{path} hard-codes a 40-hex commit SHA; derive the ref from proven state")

    # --- every third-party action stays pinned to a full commit SHA ---
    for wf in (ROOT / ".github/workflows").glob("*.yml"):
        for uses in re.findall(r"uses:\s*(\S+)", wf.read_text(encoding="utf-8")):
            if "@" in uses:
                _, ref = uses.rsplit("@", 1)
                check(re.fullmatch(r"[0-9a-f]{40}", ref) is not None,
                      f"{wf.name}: action not pinned to a full SHA: {uses}")

    # --- stale names and broken local links ---
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
