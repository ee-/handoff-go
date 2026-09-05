// Deterministic Handoff Go update mechanics — dependency-free (git + gh only).
//
// Script = mechanism, not policy. This module performs only the mechanically
// unique work of ONE `go update`: locating and executing the updater bytes that
// trusted governance pins (`run`), and preparing the update transaction
// (`prepare`: resolve, drift check, exact install, recognized runtime refresh,
// validate, one local commit on a proposal branch). Acceptance, approval, Work
// Order selection, routing, Security Gate authorization, and default-branch
// promotion are decided in update.md — never here.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

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

// Managed field values are written as inline code, optionally followed by
// explanatory prose (`- Immutable ref: `<sha>` (applied at release)`). Take the
// first code span when present so trailing prose never leaks into a value that
// later becomes a git refspec or filesystem path.
function fieldValue(value) {
  const code = value.match(/`([^`]+)`/);
  if (code) return code[1].trim();
  return value.trim().replace(/^["']+|["']+$/g, "").trim();
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

  const skills = fields(inner, "Skill").map(fieldValue);
  if (skills.length !== 1) {
    throw conflicts(`expected exactly one Skill entry in managed block, found ${skills.length}`);
  }
  const skillPath = skills[0];
  if (!skillPath || skillPath.startsWith("/") || skillPath.includes("..")) {
    throw conflicts(`malformed or escaping Skill path: ${skillPath}`);
  }

  const refs = fields(inner, "Immutable ref").map(fieldValue);
  if (refs.length !== 1) {
    throw conflicts(`expected exactly one Immutable ref entry in managed block, found ${refs.length}`);
  }
  const immutableRef = refs[0];
  if (!immutableRef) throw conflicts("empty Immutable ref in managed block");
  // The pin becomes a git refspec, so only a commit SHA or a plain tag may pass.
  if (!/^(?:[0-9a-f]{40}|[A-Za-z0-9][A-Za-z0-9._\/-]*)$/.test(immutableRef)) {
    throw conflicts(`malformed Immutable ref in managed block: ${immutableRef}`);
  }
  if (/^(main|master|develop|trunk|HEAD)$/i.test(immutableRef)) {
    throw conflicts(`refusing floating governance ref: ${immutableRef}`);
  }

  const versions = fields(inner, "Version").map(fieldValue);
  if (versions.length > 1) throw conflicts("multiple Version entries in managed block");

  const branches = fields(inner, "Trusted default branch").map(fieldValue);
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

// Git's object store is content-addressed, so a tree archived out of an exact
// commit is provably that commit's bytes. That makes it the whole verification
// mechanism for cached updater bytes: no side-car manifest, and a missing or
// unusable cache is simply refetched from the immutable ref.
function objectStore() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const store = join(base, "handoff-go", "objects.git");
  if (!existsSync(join(store, "HEAD"))) {
    mkdirSync(store, { recursive: true });
    run("git", ["init", "--bare", "-q"], { cwd: store });
  }
  return store;
}

// Materialize the skill tree of one immutable Handoff Go ref. Extraction is
// always fresh, so no temporary path is ever remembered between sessions.
export function materializePinned(ref, tmps) {
  if (!/^(?:[0-9a-f]{40}|[A-Za-z0-9][A-Za-z0-9._\/-]*)$/.test(ref)) {
    throw conflicts(`refusing to materialize a malformed Handoff Go ref: ${ref}`);
  }
  if (/^(main|master|develop|trunk|HEAD)$/i.test(ref)) {
    throw conflicts(`refusing to make a floating ref executable authority: ${ref}`);
  }
  const store = objectStore();
  let cached = true;
  try {
    run("git", ["-C", store, "cat-file", "-e", `${ref}^{commit}`]);
  } catch {
    cached = false;
  }
  if (!cached) {
    try {
      run("git", ["-C", store, "fetch", "--depth", "1", "-q", UPSTREAM, ref]);
    } catch (e) {
      throw conflicts(`cannot materialize trusted Handoff Go ${ref} from ${UPSTREAM}: ${firstLine(e)}`);
    }
  }
  let skillDir;
  try {
    skillDir = extractSkill(store, ref, tmps);
  } catch (e) {
    throw conflicts(
      `cannot read the ${UPSTREAM_SKILL} tree of trusted Handoff Go ${ref}: ${firstLine(e)}; remove ${store} to re-materialize from the immutable ref`,
    );
  }
  return { skillDir, cached, store };
}

// One bounded query establishes repository provenance independently of the
// caller's checkout: the default branch, its exact head, its trusted
// `AGENTS.md`, and every open pull request (with truncation visible).
const DISCOVERY = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){` +
  `defaultBranchRef{name target{... on Commit{oid file(path:"AGENTS.md"){object{... on Blob{text}}}}}}` +
  `pullRequests(states:OPEN,first:100){nodes{number url headRefName baseRefName isCrossRepository}pageInfo{hasNextPage}}}}`;

// Repository identity comes from remote metadata, never from tracked content.
function repoSlug(repoDir) {
  const env = (process.env.GH_REPO || "").trim();
  if (/^[^/\s]+\/[^/\s]+$/.test(env)) return env.split("/");
  let url;
  try {
    url = git(repoDir, "remote", "get-url", "origin");
  } catch {
    throw errored("no origin remote, so trusted repository provenance cannot be established");
  }
  const m = url.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) throw errored(`cannot derive a GitHub owner/name from origin ${url}`);
  return [m[1], m[2]];
}

function discover(repoDir) {
  const [owner, name] = repoSlug(repoDir);
  let raw;
  try {
    raw = run("gh", ["api", "graphql", "-f", `query=${DISCOVERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`], { cwd: repoDir });
  } catch (e) {
    throw errored(`gh api graphql failed (install and authenticate gh): ${firstLine(e)}`);
  }
  const repository = JSON.parse(raw)?.data?.repository;
  const ref = repository?.defaultBranchRef;
  const branch = ref?.name;
  const head = ref?.target?.oid;
  const agentsText = ref?.target?.file?.object?.text;
  if (!branch || !head) throw errored(`cannot resolve the default branch of ${owner}/${name}`);
  if (typeof agentsText !== "string") {
    throw conflicts(`trusted default branch ${branch} has no readable AGENTS.md; the repository is not opted in`);
  }
  if (repository.pullRequests.pageInfo.hasNextPage) {
    throw conflicts(
      "open pull request discovery is truncated, so an existing Handoff Go update proposal cannot be ruled out; supersede or close it manually",
    );
  }
  return { owner, name, branch, head, agentsText, openPrs: repository.pullRequests.nodes };
}

// Every authority-bearing field is derived from the trusted default-branch
// copy. The working tree is input, never authority, so it is not consulted.
export function resolveTrusted({ agentsText, resolvedBranch, repoAbs }) {
  const parsed = parseManagedBlock(agentsText);
  if (parsed.trustedBranch && parsed.trustedBranch !== resolvedBranch) {
    throw conflicts(
      `trusted managed block names default branch ${parsed.trustedBranch}, but the repository resolves ${resolvedBranch}; fix the bootstrap before updating`,
    );
  }
  // The skill directory is deleted and reinstalled, so it must be a dedicated
  // directory strictly inside the repository — never the repository root.
  const skillDirRel = dirname(parsed.skillPath);
  const skillDirAbs = resolve(repoAbs, skillDirRel);
  if (skillDirRel === "." || skillDirRel === "" || skillDirRel === "/" || skillDirAbs === repoAbs) {
    throw conflicts(
      `Skill path ${parsed.skillPath} resolves to the repository root; pin it to a dedicated project-relative skill directory (e.g. .agents/skills/handoff-go/SKILL.md)`,
    );
  }
  if (!skillDirAbs.startsWith(`${repoAbs}/`)) {
    throw conflicts(`Skill path ${parsed.skillPath} resolves outside the repository`);
  }
  return {
    oldRef: parsed.immutableRef,
    version: parsed.version,
    skillPath: parsed.skillPath,
    skillDirRel,
    trustedBranch: resolvedBranch,
  };
}

// Governance executable provenance = governance data provenance. The updater
// that runs is the one the trusted managed bootstrap pins, never the bytes that
// happen to sit in the current checkout.
export function resolveTrustedUpdater({ repoDir = process.cwd() }, tmps) {
  const repo = resolve(repoDir);
  const found = discover(repo);
  const trusted = resolveTrusted({ agentsText: found.agentsText, resolvedBranch: found.branch, repoAbs: repo });
  const { skillDir, cached } = materializePinned(trusted.oldRef, tmps);
  const updater = join(skillDir, "update.mjs");
  if (!existsSync(updater)) {
    throw conflicts(
      `trusted Handoff Go pin ${trusted.oldRef} ships no update.mjs; follow the one-time migration in references/update.md`,
    );
  }
  if (!/export function prepare/.test(readFileSync(updater, "utf8"))) {
    throw conflicts(
      `trusted Handoff Go pin ${trusted.oldRef} predates 'update.mjs prepare'; follow the one-time migration in references/update.md`,
    );
  }
  return {
    repo,
    updater,
    ref: trusted.oldRef,
    cached,
    trustedBranch: trusted.trustedBranch,
    repository: `${found.owner}/${found.name}`,
  };
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
    provenance: {},
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

  // 1 — trusted provenance. The caller may sit on any feature branch; its
  // working tree never supplies the pin, Skill path, or trusted branch.
  const found = discover(repo);
  ev.transitions.insideUpdater += 1;
  const trusted = resolveTrusted({ agentsText: found.agentsText, resolvedBranch: found.branch, repoAbs: repo });
  const { skillDirRel, trustedBranch } = trusted;
  ev.provenance = {
    repository: `${found.owner}/${found.name}`,
    trustedBranch,
    trustedHead: found.head,
    bootstrapSource: `${trustedBranch}:AGENTS.md`,
    workingTreeIsAuthority: false,
  };
  ev.oldRef = trusted.oldRef;
  ev.skillPath = trusted.skillPath;

  // 2 — resolve the canonical trusted upstream head to one immutable commit.
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

  // 3 — existing proposals, before any mutation, from the same bounded query.
  const verdict = classifyProposal(found.openPrs, branch, trustedBranch);
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

    // 4 — bounded proposal worktree at the exact discovered trusted head.
    try {
      git(repo, "fetch", "-q", "origin", trustedBranch);
    } catch (e) {
      throw errored(`cannot fetch trusted default branch origin/${trustedBranch}: ${firstLine(e)}`);
    }
    ev.transitions.insideUpdater += 1;
    const fetched = git(repo, "rev-parse", "FETCH_HEAD");
    if (fetched !== found.head) {
      throw conflicts(
        `trusted default branch ${trustedBranch} moved from ${found.head.slice(0, 8)} to ${fetched.slice(0, 8)} during preparation; re-run against the current trusted head`,
      );
    }
    worktree = mkdtempSync(join(tmpdir(), "hg-wt-"));
    tmps.push(worktree);
    git(repo, "worktree", "add", "-q", "-b", branch, worktree, found.head);

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
      updateManagedBlock(beforeAgents, { ref: newRef, version: trusted.version ? ev.version : null }),
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
    if (after.skillPath !== trusted.skillPath) throw errored("Skill path must not change");
    const cut = (t) => [t.slice(0, t.indexOf(START)), t.slice(t.indexOf(END))];
    const [preBefore, postBefore] = cut(beforeAgents);
    const [preAfter, postAfter] = cut(afterAgents);
    if (preBefore !== preAfter || postBefore !== postAfter) {
      throw errored("bytes outside the managed block were not preserved");
    }
    if (!/^name:\s*handoff-go\s*$/m.test(readFileSync(join(worktree, trusted.skillPath), "utf8"))) {
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
  assert(parseManagedBlock(agents).immutableRef === "a".repeat(40), "trailing prose never leaks into the pin");
  const swapRef = (ref) => agents.replace(/- Immutable ref:.*/, `- Immutable ref: \`${ref}\``);
  throws(() => parseManagedBlock(swapRef("+refs/heads/*:refs/heads/*")), /malformed Immutable ref/, "refspec-shaped pin");
  throws(() => parseManagedBlock(swapRef("v1.0.0 --upload-pack=x")), /malformed Immutable ref/, "pin carrying arguments");

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

  // Authority is derived from the trusted copy, and destructive paths are
  // rejected before any filesystem step.
  const repoAbs = "/tmp/consumer";
  const hostile = agents
    .replace("- Immutable ref: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (applied at release)", "- Immutable ref: `cccccccccccccccccccccccccccccccccccccccc`")
    .replace("- Skill: `skills/handoff-go/SKILL.md`", "- Skill: `SKILL.md`")
    .replace("- Trusted default branch: `main`", "- Trusted default branch: `attacker`");
  const good = resolveTrusted({ agentsText: agents, resolvedBranch: "main", repoAbs });
  assert(good.oldRef.startsWith("aaaa") && good.skillDirRel === "skills/handoff-go", "trusted copy supplies pin and skill dir");
  assert(good.trustedBranch === "main", "trusted branch is the independently resolved one");
  throws(
    () => resolveTrusted({ agentsText: hostile, resolvedBranch: "main", repoAbs }),
    /names default branch attacker/,
    "bootstrap contradicting the resolved default branch",
  );
  throws(
    () => resolveTrusted({ agentsText: agents.replace("- Skill: `skills/handoff-go/SKILL.md`", "- Skill: `SKILL.md`"), resolvedBranch: "main", repoAbs }),
    /resolves to the repository root/,
    "root Skill path",
  );
  throws(
    () => resolveTrusted({ agentsText: agents.replace("- Skill: `skills/handoff-go/SKILL.md`", "- Skill: `./SKILL.md`"), resolvedBranch: "main", repoAbs }),
    /resolves to the repository root/,
    "dot-relative root Skill path",
  );
  throws(
    () => resolveTrusted({ agentsText: agents.replace("- Skill: `skills/handoff-go/SKILL.md`", "- Skill: `sub/../../escape/SKILL.md`"), resolvedBranch: "main", repoAbs }),
    /escaping Skill path/,
    "escaping Skill path",
  );
  throws(
    () => resolveTrusted({ agentsText: "no managed block", resolvedBranch: "main", repoAbs }),
    /not opted in/,
    "trusted copy without a managed block",
  );

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

  // The pinned ref reaches `git fetch`, so the launcher revalidates it too.
  throws(() => materializePinned("main", []), /floating ref is not executable authority|floating ref executable authority/, "floating ref is not executable authority");
  throws(() => materializePinned("v1 --upload-pack=x", []), /malformed Handoff Go ref/, "ref carrying arguments");

  console.log("update core: PASS");
}

// Compare realpaths: on hosts where the temporary directory is a symlink
// (macOS `/var` -> `/private/var`), `file://${process.argv[1]}` never matches
// and the CLI would load and exit silently instead of running.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const [mode, ...rest] = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = rest.indexOf(name);
    return i === -1 ? fallback : rest[i + 1];
  };
  const fail = (e) => {
    const kind = e.code || "GO_UPDATE_ERROR";
    console.error(`${kind}\n${e.message.replace(`${kind}: `, "")}`);
    process.exit(kind === "GO_UPDATE_CONFLICT" ? 1 : 2);
  };
  if (!mode) {
    demo();
  } else if (mode === "prepare") {
    try {
      const ev = prepare({ repoDir: flag("--repo-dir", process.cwd()), dryRun: rest.includes("--dry-run") });
      if (rest.includes("--json")) console.log(JSON.stringify(ev, null, 2));
      else report(ev);
    } catch (e) {
      fail(e);
    }
  } else if (mode === "run") {
    // Pure launcher: establish the trusted executable, then hand the whole
    // transaction to it. It re-establishes governance provenance itself, so no
    // discovered value is passed in from these possibly stale bytes.
    const tmps = [];
    try {
      const t = resolveTrustedUpdater({ repoDir: flag("--repo-dir", process.cwd()) }, tmps);
      process.stderr.write(
        `trusted updater ${t.ref.slice(0, 8)} for ${t.repository} (${t.cached ? "cache hit" : "materialized"})\n`,
      );
      // Pass the realpath: an updater guarded with `file://${process.argv[1]}`
      // silently no-ops when a symlinked temporary path is handed to it.
      const args = [realpathSync(t.updater), "prepare", "--repo-dir", t.repo];
      if (rest.includes("--dry-run")) args.push("--dry-run");
      if (rest.includes("--json")) args.push("--json");
      const child = spawnSync(process.execPath, args, { encoding: "utf8" });
      if (child.stdout) process.stdout.write(child.stdout);
      if (child.stderr) process.stderr.write(child.stderr);
      if (child.status === 0 && !String(child.stdout || "").trim()) {
        throw errored(`trusted updater ${t.ref} produced no result; refusing to report an unobserved update`);
      }
      for (const dir of tmps) rmSync(dir, { recursive: true, force: true });
      process.exit(child.status ?? 2);
    } catch (e) {
      for (const dir of tmps) rmSync(dir, { recursive: true, force: true });
      fail(e);
    }
  } else {
    console.error("usage: node update.mjs [run|prepare] [--repo-dir DIR] [--dry-run] [--json]");
    process.exit(2);
  }
}
