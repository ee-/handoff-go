// Deterministic Handoff Go update mechanics — dependency-free (git + gh only).
//
// Script = mechanism, not policy. This module performs only the mechanically
// unique work of ONE `go update`: locating the single managed AGENTS.md block
// and rewriting ONLY its pin fields, and preparing the update transaction
// (resolve, drift check, exact install, recognized runtime refresh, validate,
// one local commit on a proposal branch). Acceptance, approval, Work Order
// selection, routing, Security Gate authorization, and default-branch promotion
// are decided in update.md — never here.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const START = "<!-- handoff-go:start -->";
const END = "<!-- handoff-go:end -->";

// Trusted and fixed: project or contributor content can never redirect it.
export const UPSTREAM = "https://github.com/ee-/handoff-go.git";
const UPSTREAM_SKILL = "skills/handoff-go";
const BRANCH_PREFIX = "handoff-go/update-";

// Recognized managed runtime copies: repo-relative path -> skill-relative source.
const RUNTIME = {
  ".omp/watch.mjs": "watch.mjs",
  ".pi/watch.mjs": "watch.mjs",
  ".omp/extensions/handoff-go-watch.js": "adapters/watch.js",
  ".pi/extensions/handoff-go-watch.js": "adapters/watch.js",
};
// Legacy runtime entries migrated onto the current native entry.
const LEGACY = {
  ".omp/extensions/handoff-go-watch.mjs": ".omp/extensions/handoff-go-watch.js",
  ".pi/extensions/handoff-go-watch.mjs": ".pi/extensions/handoff-go-watch.js",
};

function conflicts(detail) {
  const err = new Error(`GO_UPDATE_CONFLICT: ${detail}`);
  err.code = "GO_UPDATE_CONFLICT";
  return err;
}

function errored(detail) {
  const err = new Error(`GO_UPDATE_ERROR: ${detail}`);
  err.code = "GO_UPDATE_ERROR";
  return err;
}

function stripQuotes(value) {
  return value.trim().replace(/^[`"']+|[`"']+$/g, "").trim();
}

// Locate the unique managed block, returning { pre, inner, post } so the
// surrounding bytes can be rejoined without modification.
function locateBlock(text) {
  const starts = text.split(START).length - 1;
  const ends = text.split(END).length - 1;
  if (starts === 0 && ends === 0) {
    throw conflicts("no Handoff Go managed block found; repository is not opted in");
  }
  if (starts !== 1 || ends !== 1) {
    throw conflicts(`expected exactly one managed block, found start=${starts} end=${ends}`);
  }
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (s >= e) throw conflicts("managed block markers are inverted");
  return { pre: text.slice(0, s), inner: text.slice(s + START.length, e), post: text.slice(e + END.length) };
}

function fields(inner, label) {
  return [...inner.matchAll(new RegExp(`^[ \\t]*-[ \\t]*${label}:[ \\t]*(.+)$`, "gm"))].map((m) => m[1]);
}

// Parse the trusted bootstrap: exactly one Skill path and one immutable ref.
export function parseManagedBlock(text) {
  const { inner } = locateBlock(text);

  const skills = fields(inner, "Skill").map(stripQuotes);
  if (skills.length !== 1) {
    throw conflicts(`expected exactly one Skill entry in managed block, found ${skills.length}`);
  }
  const skillPath = skills[0];
  if (!skillPath || skillPath.startsWith("/") || skillPath.includes("..")) {
    throw conflicts(`malformed or escaping Skill path: ${skillPath}`);
  }

  const refs = fields(inner, "Immutable ref").map(stripQuotes);
  if (refs.length !== 1) {
    throw conflicts(`expected exactly one Immutable ref entry in managed block, found ${refs.length}`);
  }
  const immutableRef = refs[0];
  if (!immutableRef) throw conflicts("empty Immutable ref in managed block");
  if (/^(main|master|develop|trunk|HEAD)$/i.test(immutableRef)) {
    throw conflicts(`refusing floating governance ref: ${immutableRef}`);
  }

  const versions = fields(inner, "Version").map(stripQuotes);
  if (versions.length > 1) throw conflicts("multiple Version entries in managed block");

  const branches = fields(inner, "Trusted default branch").map(stripQuotes);
  if (branches.length > 1) throw conflicts("multiple Trusted default branch entries in managed block");

  return {
    skillPath,
    immutableRef,
    version: versions[0] || null,
    trustedBranch: branches[0] || null,
  };
}

// Replace the pin lines of the managed block; preserve every other byte,
// including any leading inline backticks so surrounding formatting is intact.
function replacePinLine(inner, label, value) {
  const ms = fields(inner, label);
  if (ms.length !== 1) {
    throw conflicts(`expected exactly one ${label} line, found ${ms.length}`);
  }
  const re = new RegExp(`^([ \\t]*-[ \\t]*${label}:[ \\t]*)(.+)$`, "m");
  return inner.replace(re, (_all, lead, original) => {
    const quoted = /^\s*[`"']/.test(original);
    return `${lead}${quoted ? "`" : ""}${value}${quoted ? "`" : ""}`;
  });
}

export function updateManagedBlock(text, { ref, version = null }) {
  if (!ref || /^(main|master|develop|trunk|HEAD)$/i.test(ref)) {
    throw conflicts(`ref must be an immutable commit or tag, got: ${ref}`);
  }
  const { pre, inner, post } = locateBlock(text);
  const before = parseManagedBlock(text);

  let next = replacePinLine(inner, "Immutable ref", ref);
  if (version !== null) next = replacePinLine(next, "Version", version);

  const out = `${pre}${START}${next}${END}${post}`;
  const after = parseManagedBlock(out);
  if (after.immutableRef !== ref) throw conflicts("Immutable ref rewrite did not apply");
  if (version !== null && after.version !== version) throw conflicts("Version rewrite did not apply");
  if (after.skillPath !== before.skillPath) throw conflicts("Skill path must not change");
  return out;
}

// --- deterministic decisions (pure, so they are cheap to check) ---

// `git status --porcelain=v1 -z` emits "XY path\0"; a rename adds a bare source
// entry. Never trim the whole buffer: the first entry's leading status space is
// significant and trimming shifts every path by one byte.
export function changedPaths(zText) {
  return zText
    .split("\0")
    .filter(Boolean)
    .map((entry) => (entry.length > 3 && entry[2] === " " ? entry.slice(3) : entry));
}

// Any prepared change outside the managed surface fails the transaction.
export function outsideScope(paths, skillDirRel) {
  const managed = (p) =>
    p === "AGENTS.md" ||
    p === skillDirRel ||
    p.startsWith(`${skillDirRel}/`) ||
    Object.hasOwn(RUNTIME, p) ||
    Object.hasOwn(LEGACY, p);
  return paths.filter((p) => !managed(p));
}

// Only a same-repository PR onto the trusted default branch can be an update
// proposal: a fork PR may use any head branch name and never carries update
// authority. One proposal for this exact NEW is reused; another ref, or a
// same-repo proposal onto the wrong base, is a bounded conflict.
export function classifyProposal(openPrs, branch, trustedBranch) {
  const named = (openPrs || []).filter((pr) => (pr.headRefName || "").startsWith(BRANCH_PREFIX));
  const sameRepo = named.filter((pr) => pr.isCrossRepository === false);
  const wrongBase = sameRepo.find((pr) => pr.baseRefName !== trustedBranch);
  if (wrongBase) return { kind: "conflict", pr: wrongBase, reason: "base" };
  const exact = sameRepo.find((pr) => pr.headRefName === branch);
  if (exact) return { kind: "reuse", pr: exact, reason: null };
  if (sameRepo.length) return { kind: "conflict", pr: sameRepo[0], reason: "ref" };
  return { kind: "none", pr: null, reason: null };
}

// Only recognized copies that are actually enabled are touched; absent
// integration stays absent.
export function planRuntime(presentPaths) {
  const refresh = [];
  const migrate = [];
  const absent = [];
  for (const [rel, src] of Object.entries(RUNTIME)) {
    if (presentPaths.includes(rel)) refresh.push([rel, src]);
    else absent.push(rel);
  }
  for (const [legacyRel, nativeRel] of Object.entries(LEGACY)) {
    if (presentPaths.includes(legacyRel)) migrate.push([legacyRel, nativeRel, RUNTIME[nativeRel]]);
  }
  return { refresh, migrate, absent };
}

function treeFiles(dir) {
  const out = [];
  const walk = (d, base) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(d, entry.name), rel);
      else out.push(rel);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out;
}

// Byte-exact tree comparison; returns the relative paths that differ.
export function diffTree(a, b) {
  const all = [...new Set([...treeFiles(a), ...treeFiles(b)])].sort();
  return all.filter((rel) => {
    const pa = join(a, rel);
    const pb = join(b, rel);
    if (!existsSync(pa) || !existsSync(pb)) return true;
    return !readFileSync(pa).equals(readFileSync(pb));
  });
}

// --- prepared transaction ---

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function git(dir, ...args) {
  return run("git", ["-C", dir, ...args]).trim();
}

function branchPresent(dir, branch) {
  try {
    git(dir, "rev-parse", "--verify", "-q", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

function firstLine(e) {
  return String(e.stderr || e.message || "").trim().split("\n")[0];
}

function sameBytes(actual, expected, label) {
  if (!existsSync(expected) || !readFileSync(actual).equals(readFileSync(expected))) {
    throw conflicts(`recognized managed runtime copy drifted or is unverifiable: ${label}`);
  }
}

// Extract one upstream commit's skill tree locally (no network).
function extractSkill(cache, sha, tmps) {
  const dir = mkdtempSync(join(tmpdir(), "hg-tree-"));
  tmps.push(dir);
  const tarball = join(dir, "tree.tar");
  run("git", ["-C", cache, "archive", "--format=tar", "-o", tarball, sha, UPSTREAM_SKILL]);
  run("tar", ["-xf", tarball, "-C", dir]);
  rmSync(tarball, { force: true });
  return join(dir, UPSTREAM_SKILL);
}

// One invocation prepares the whole normal-path update; it never pushes, never
// opens a PR, and never writes the default branch. Its success is the internal
// status PREPARED, never the durable protocol state `GO_UPDATE_READY`: that one
// may only be emitted once the proposal PR itself exists.
export function prepare({ repoDir = process.cwd(), dryRun = false } = {}) {
  const repo = resolve(repoDir);
  const ev = {
    result: null,
    upstream: UPSTREAM,
    oldRef: null,
    newRef: null,
    version: null,
    skillPath: null,
    proposalBranch: null,
    existingProposal: null,
    changedPaths: [],
    runtime: { refreshed: [], migrated: [], absent: [] },
    validation: {},
    transitions: { insideUpdater: 0, outsidePlanned: 0 },
  };

  const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
  const current = parseManagedBlock(agents);
  const trustedBranch = current.trustedBranch || "main";
  ev.oldRef = current.immutableRef;
  ev.skillPath = current.skillPath;

  // The skill directory is deleted and reinstalled, so it must be a dedicated
  // directory strictly inside the repository — never the repository root.
  const skillDirRel = dirname(current.skillPath);
  const skillDirAbs = resolve(repo, skillDirRel);
  if (skillDirRel === "." || skillDirRel === "" || skillDirRel === "/" || skillDirAbs === repo) {
    throw conflicts(
      `Skill path ${current.skillPath} resolves to the repository root; pin it to a dedicated project-relative skill directory (e.g. .agents/skills/handoff-go/SKILL.md)`,
    );
  }
  if (!skillDirAbs.startsWith(`${repo}/`)) {
    throw conflicts(`Skill path ${current.skillPath} resolves outside the repository`);
  }

  // 1 — resolve the canonical trusted upstream head to one immutable commit.
  let head;
  try {
    head = run("git", ["ls-remote", UPSTREAM, "HEAD"], { cwd: repo });
  } catch (e) {
    throw errored(`cannot reach trusted upstream ${UPSTREAM}: ${firstLine(e)}`);
  }
  ev.transitions.insideUpdater += 1;
  const newRef = (head.split(/\s+/)[0] || "").trim();
  if (!/^[0-9a-f]{40}$/.test(newRef)) throw errored(`could not resolve upstream HEAD from ${UPSTREAM}`);
  ev.newRef = newRef;
  if (newRef === ev.oldRef) {
    ev.result = "UP_TO_DATE";
    return ev;
  }

  const branch = BRANCH_PREFIX + newRef.slice(0, 8);
  ev.proposalBranch = branch;

  // 2 — existing proposals, before any mutation. Bounded query that must prove
  // its own completeness: a truncated page cannot prove no proposal exists.
  const PR_PAGE = 100;
  let openPrs;
  try {
    openPrs = JSON.parse(
      run(
        "gh",
        [
          "pr", "list", "--state", "open", "--limit", String(PR_PAGE),
          "--json", "number,url,headRefName,baseRefName,isCrossRepository",
        ],
        { cwd: repo },
      ),
    );
  } catch (e) {
    throw errored(`gh pr list failed (install and authenticate gh): ${firstLine(e)}`);
  }
  ev.transitions.insideUpdater += 1;
  if (openPrs.length >= PR_PAGE) {
    throw conflicts(
      `open pull request list hit the ${PR_PAGE}-item query bound, so an existing Handoff Go update proposal cannot be ruled out; reduce open PRs or supersede the proposal manually`,
    );
  }
  const verdict = classifyProposal(openPrs, branch, trustedBranch);
  ev.existingProposal = verdict.pr;
  if (verdict.kind === "reuse") {
    ev.result = "REUSE";
    return ev;
  }
  if (verdict.kind === "conflict") {
    throw conflicts(
      verdict.reason === "base"
        ? `open Handoff Go update proposal ${verdict.pr.url} targets base ${verdict.pr.baseRefName}, not the trusted default branch ${trustedBranch}; close or retarget it first`
        : `open Handoff Go update proposal ${verdict.pr.url} targets ${verdict.pr.headRefName}; supersede or close it before preparing ${branch}`,
    );
  }

  const tmps = [];
  const cache = mkdtempSync(join(tmpdir(), "hg-cache-"));
  tmps.push(cache);
  // Never reset an existing local proposal branch: it may hold unpushed work.
  if (branchPresent(repo, branch)) {
    throw conflicts(
      `local branch ${branch} already exists and is not a recognized durable proposal; inspect and remove it before preparing an update`,
    );
  }
  let worktree = null;
  let keepBranch = false;

  try {
    // 3 — acquire OLD and NEW in one bounded fetch; all comparisons are local.
    run("git", ["init", "--bare", "-q"], { cwd: cache });
    try {
      run("git", ["-C", cache, "fetch", "--depth", "1", "-q", UPSTREAM, newRef, ev.oldRef]);
    } catch (e) {
      throw conflicts(`cannot fetch pinned ${ev.oldRef.slice(0, 8)} and ${newRef.slice(0, 8)} from upstream: ${firstLine(e)}`);
    }
    ev.transitions.insideUpdater += 1;
    const newSkill = extractSkill(cache, newRef, tmps);
    const oldSkill = extractSkill(cache, ev.oldRef, tmps);
    ev.version = git(cache, "cat-file", "blob", `${newRef}:VERSION`) || null;

    // 4 — bounded proposal worktree from the trusted default head.
    try {
      git(repo, "fetch", "-q", "origin", trustedBranch);
    } catch (e) {
      throw errored(`cannot fetch trusted default branch origin/${trustedBranch}: ${firstLine(e)}`);
    }
    ev.transitions.insideUpdater += 1;
    worktree = mkdtempSync(join(tmpdir(), "hg-wt-"));
    tmps.push(worktree);
    git(repo, "worktree", "add", "-q", "-b", branch, worktree, `origin/${trustedBranch}`);

    // verify the trusted head's installed bytes and enabled copies against OLD
    const wtSkill = join(worktree, skillDirRel);
    const drift = diffTree(wtSkill, oldSkill);
    if (drift.length) {
      throw conflicts(`installed Handoff Go bytes differ from pinned ${ev.oldRef.slice(0, 8)}: ${drift.slice(0, 5).join(", ")}`);
    }
    const present = [...Object.keys(RUNTIME), ...Object.keys(LEGACY)].filter((p) => existsSync(join(worktree, p)));
    const plan = planRuntime(present);
    for (const [rel, src] of plan.refresh) sameBytes(join(worktree, rel), join(oldSkill, src), rel);
    for (const [legacyRel, , src] of plan.migrate) {
      const legacyOld = join(oldSkill, "adapters/watch.mjs");
      sameBytes(join(worktree, legacyRel), existsSync(legacyOld) ? legacyOld : join(oldSkill, src), legacyRel);
    }

    // install exact NEW bytes, rewrite only the managed pin fields
    const agentsPath = join(worktree, "AGENTS.md");
    const beforeAgents = readFileSync(agentsPath, "utf8");
    rmSync(wtSkill, { recursive: true, force: true });
    cpSync(newSkill, wtSkill, { recursive: true });
    writeFileSync(
      agentsPath,
      updateManagedBlock(beforeAgents, { ref: newRef, version: current.version ? ev.version : null }),
    );

    for (const [rel, src] of plan.refresh) {
      writeFileSync(join(worktree, rel), readFileSync(join(newSkill, src)));
      ev.runtime.refreshed.push(rel);
    }
    for (const [legacyRel, nativeRel, src] of plan.migrate) {
      writeFileSync(join(worktree, nativeRel), readFileSync(join(newSkill, src)));
      rmSync(join(worktree, legacyRel), { force: true });
      ev.runtime.migrated.push(`${legacyRel} -> ${nativeRel}`);
    }
    const created = new Set(plan.migrate.map(([, nativeRel]) => nativeRel));
    ev.runtime.absent = plan.absent.filter((rel) => !created.has(rel));

    // consumer-side validation: exact installation + project integration only
    const installed = diffTree(wtSkill, newSkill);
    if (installed.length) throw errored(`installed bytes do not match NEW: ${installed.slice(0, 5).join(", ")}`);
    const afterAgents = readFileSync(agentsPath, "utf8");
    const after = parseManagedBlock(afterAgents);
    if (after.immutableRef !== newRef) throw errored("managed pin was not rewritten to NEW");
    if (after.skillPath !== current.skillPath) throw errored("Skill path must not change");
    const cut = (t) => [t.slice(0, t.indexOf(START)), t.slice(t.indexOf(END))];
    const [preBefore, postBefore] = cut(beforeAgents);
    const [preAfter, postAfter] = cut(afterAgents);
    if (preBefore !== preAfter || postBefore !== postAfter) {
      throw errored("bytes outside the managed block were not preserved");
    }
    if (!/^name:\s*handoff-go\s*$/m.test(readFileSync(join(worktree, current.skillPath), "utf8"))) {
      throw errored("installed SKILL.md frontmatter is not handoff-go");
    }
    ev.validation = {
      installedMatchesNew: true,
      pinMatchesNew: true,
      outsideBytesPreserved: true,
      skillFrontmatter: "handoff-go",
      upstreamSuiteRerun: false,
    };

    // scope guard, then exactly one local commit on the proposal branch
    git(worktree, "add", "-A");
    ev.changedPaths = changedPaths(run("git", ["-C", worktree, "status", "--porcelain=v1", "-z"]));
    const foreign = outsideScope(ev.changedPaths, skillDirRel);
    if (foreign.length) throw conflicts(`prepared changes outside Handoff Go managed scope: ${foreign.join(", ")}`);
    if (!ev.changedPaths.length) throw errored("no changes prepared although the pinned ref differs from NEW");

    if (!dryRun) {
      try {
        git(worktree, "commit", "-q", "-m", `chore(handoff-go): update ${ev.oldRef.slice(0, 8)} -> ${newRef.slice(0, 8)}`);
      } catch (e) {
        throw errored(`commit failed (configure git user.name/user.email): ${firstLine(e)}`);
      }
      ev.commit = git(worktree, "rev-parse", "HEAD");
      keepBranch = true;
      ev.transitions.outsidePlanned = 2;
    } else {
      ev.dryRun = true;
    }
    // Internal status only. `GO_UPDATE_READY` belongs to the Coder, after the
    // proposal PR is durably created.
    ev.result = "PREPARED";
    return ev;
  } finally {
    if (worktree) {
      try {
        git(repo, "worktree", "remove", "--force", worktree);
      } catch {
        /* already gone */
      }
    }
    if (!keepBranch) {
      try {
        git(repo, "branch", "-q", "-D", branch);
      } catch {
        /* never created */
      }
    }
    for (const dir of tmps) rmSync(dir, { recursive: true, force: true });
  }
}

function report(ev) {
  const short = (r) => (r ? r.slice(0, 8) : "?");
  if (ev.result === "UP_TO_DATE") {
    console.log(`GO_UP_TO_DATE\nCurrent ref: ${ev.oldRef}`);
    return;
  }
  if (ev.result === "REUSE") {
    // The durable proposal already exists, so the protocol state is reportable.
    console.log(
      [
        "GO_UPDATE_READY",
        `Old ref: ${ev.oldRef}`,
        `New ref: ${ev.newRef}`,
        `PR: ${ev.existingProposal.url}`,
        "Next Actor: ARCHITECT",
      ].join("\n"),
    );
    return;
  }
  console.log(
    [
      "PREPARED (internal status — not a durable protocol state)",
      `Old ref: ${ev.oldRef}`,
      `New ref: ${ev.newRef}`,
      `Branch: ${ev.proposalBranch}${ev.dryRun ? " (dry run, not committed)" : ""}`,
      `Changed: ${ev.changedPaths.join(", ")}`,
      `Transitions inside updater: ${ev.transitions.insideUpdater}`,
      "",
      "Persist (2 external transitions), then report GO_UPDATE_READY with the PR:",
      `  git push -u origin ${ev.proposalBranch}`,
      `  gh pr create --base <trusted-default-branch> --head ${ev.proposalBranch} --title "chore(handoff-go): update ${short(ev.oldRef)} -> ${short(ev.newRef)}" --body-file <evidence.md>`,
      "",
      "Emit GO_UPDATE_READY only after both succeed; on failure report",
      "GO_UPDATE_CONFLICT/GO_UPDATE_ERROR and never claim a persisted update.",
    ].join("\n"),
  );
}

// One runnable check for the non-trivial block rewrite and update decisions.
function demo() {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  const throws = (fn, re, m) => {
    try { fn(); } catch (e) { if (re.test(e.message)) return; throw new Error(`FAIL(${m}): wrong error: ${e.message}`); }
    throw new Error(`FAIL: ${m}: did not throw`);
  };
  const agents = [
    "# Repo",
    "",
    START,
    "## Handoff Go",
    "",
    "- Version: `1.0.0`",
    "- Immutable ref: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (applied at release)",
    "- Skill: `skills/handoff-go/SKILL.md`",
    "- Trusted default branch: `main`",
    "",
    "Unrelated trailing governance prose that MUST survive.",
    END,
    "",
    "Footer text outside the block that MUST survive.",
  ].join("\n");

  assert(parseManagedBlock(agents).skillPath === "skills/handoff-go/SKILL.md", "parses skill path");
  assert(parseManagedBlock(agents).immutableRef.startsWith("aaaa"), "parses immutable ref");
  assert(parseManagedBlock(agents).trustedBranch === "main", "parses trusted default branch");

  const updated = updateManagedBlock(agents, { ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", version: "1.9.9" });
  assert(parseManagedBlock(updated).immutableRef === "b".repeat(40), "ref rewritten");
  assert(parseManagedBlock(updated).version === "1.9.9", "version rewritten");
  assert(updated.includes("Unrelated trailing governance prose that MUST survive."), "inner prose preserved");
  assert(updated.includes("Footer text outside the block that MUST survive."), "outer prose preserved");
  assert(updated.includes("# Repo"), "pre-block header preserved");
  assert(parseManagedBlock(updated).skillPath === "skills/handoff-go/SKILL.md", "skill path untouched");
  assert(updated.split("\n").length === agents.split("\n").length, "line count unchanged");

  throws(() => parseManagedBlock("no block here"), /not opted in/, "missing block");
  throws(() => parseManagedBlock(agents + agents), /exactly one managed block/, "duplicate block");
  const dupSkill = agents.replace(/- Skill:.*/, "- Skill: `a/SKILL.md`\n- Skill: `b/SKILL.md`");
  throws(() => parseManagedBlock(dupSkill), /exactly one Skill/, "duplicate skill");
  const floating = agents.replace(/- Immutable ref:.*/, "- Immutable ref: `main`");
  throws(() => parseManagedBlock(floating), /floating governance ref/, "floating ref");
  throws(() => updateManagedBlock(agents, { ref: "main" }), /immutable commit/, "update to floating ref");

  // porcelain -z parsing: the first entry's leading status space is significant
  const status = " M .agents/skills/handoff-go/SKILL.md\0A  .omp/watch.mjs\0R  new/p\0old/p\0";
  assert(
    JSON.stringify(changedPaths(status)) ===
      JSON.stringify([".agents/skills/handoff-go/SKILL.md", ".omp/watch.mjs", "new/p", "old/p"]),
    "porcelain -z paths keep their first byte",
  );

  const skillDirRel = ".agents/skills/handoff-go";
  assert(outsideScope(changedPaths(status), skillDirRel).length === 2, "unmanaged paths are rejected");
  assert(outsideScope(["AGENTS.md", `${skillDirRel}/watch.mjs`, ".omp/extensions/handoff-go-watch.js"], skillDirRel).length === 0, "managed surface allowed");

  // Only same-repo PRs onto the trusted base can be update authority.
  const branch = `${BRANCH_PREFIX}deadbeef`;
  const own = (headRefName, baseRefName = "main") => ({ headRefName, baseRefName, isCrossRepository: false, url: "u" });
  const fork = (headRefName, baseRefName = "main") => ({ headRefName, baseRefName, isCrossRepository: true, url: "f" });
  assert(classifyProposal([], branch, "main").kind === "none", "no proposal");
  assert(classifyProposal([own(branch)], branch, "main").kind === "reuse", "same ref reuses");
  assert(classifyProposal([own(`${BRANCH_PREFIX}0badcafe`)], branch, "main").kind === "conflict", "other ref conflicts");
  assert(classifyProposal([own("feature/x")], branch, "main").kind === "none", "unrelated PR ignored");
  assert(classifyProposal([fork(branch)], branch, "main").kind === "none", "fork PR is never update authority");
  const wrongBase = classifyProposal([own(branch, "release")], branch, "main");
  assert(wrongBase.kind === "conflict" && wrongBase.reason === "base", "same-repo proposal onto wrong base conflicts");
  assert(classifyProposal([{ headRefName: branch, baseRefName: "main", url: "u" }], branch, "main").kind === "none", "unproven same-repo flag is not authority");

  const plan = planRuntime([".omp/watch.mjs", ".omp/extensions/handoff-go-watch.mjs"]);
  assert(JSON.stringify(plan.refresh) === JSON.stringify([[".omp/watch.mjs", "watch.mjs"]]), "refreshes only enabled copies");
  assert(plan.migrate[0][1] === ".omp/extensions/handoff-go-watch.js", "legacy .mjs migrates to .js");
  assert(plan.absent.includes(".pi/watch.mjs"), "absent integration stays absent");

  // A root-level Skill path must be rejected before any destructive step.
  const scratch = mkdtempSync(join(tmpdir(), "hg-guard-"));
  try {
    writeFileSync(join(scratch, "AGENTS.md"), agents.replace("- Skill: `skills/handoff-go/SKILL.md`", "- Skill: `SKILL.md`"));
    throws(() => prepare({ repoDir: scratch }), /resolves to the repository root/, "root Skill path");
    writeFileSync(join(scratch, "AGENTS.md"), agents.replace("- Skill: `skills/handoff-go/SKILL.md`", "- Skill: `./SKILL.md`"));
    throws(() => prepare({ repoDir: scratch }), /resolves to the repository root/, "dot-relative root Skill path");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // `GO_UPDATE_READY` may only head a report that carries a durable PR.
  const captured = [];
  const realLog = console.log;
  console.log = (line) => captured.push(String(line));
  try {
    report({ result: "PREPARED", oldRef: "a".repeat(40), newRef: "b".repeat(40), proposalBranch: `${BRANCH_PREFIX}bbbbbbbb`, changedPaths: ["AGENTS.md"], transitions: { insideUpdater: 4 } });
    report({ result: "REUSE", oldRef: "a".repeat(40), newRef: "b".repeat(40), existingProposal: { url: "https://example.invalid/pr/1" } });
  } finally {
    console.log = realLog;
  }
  assert(captured[0].split("\n")[0].startsWith("PREPARED"), "prepared report is not a protocol state");
  assert(!captured[0].split("\n")[0].includes("GO_UPDATE_READY"), "prepared report never leads with GO_UPDATE_READY");
  assert(captured[1].split("\n")[0] === "GO_UPDATE_READY", "reuse reports the standard outcome");
  assert(captured[1].includes("PR: https://example.invalid/pr/1"), "reuse reports the durable PR");
  assert(captured[1].includes("Next Actor: ARCHITECT"), "reuse routes to the Architect");

  console.log("update core: PASS");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, ...rest] = process.argv.slice(2);
  if (!mode) {
    demo();
  } else if (mode === "prepare") {
    const flag = (name, fallback) => {
      const i = rest.indexOf(name);
      return i === -1 ? fallback : rest[i + 1];
    };
    try {
      const ev = prepare({ repoDir: flag("--repo-dir", process.cwd()), dryRun: rest.includes("--dry-run") });
      if (rest.includes("--json")) console.log(JSON.stringify(ev, null, 2));
      else report(ev);
    } catch (e) {
      const kind = e.code || "GO_UPDATE_ERROR";
      console.error(`${kind}\n${e.message.replace(`${kind}: `, "")}`);
      process.exit(kind === "GO_UPDATE_CONFLICT" ? 1 : 2);
    }
  } else {
    console.error("usage: node update.mjs [prepare [--repo-dir DIR] [--dry-run] [--json]]");
    process.exit(2);
  }
}
