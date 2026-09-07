// Deterministic tests for the `go update` deterministic bootstrap (Work Order #41).
// Run: node tests/update-bootstrap.test.mjs
//
// These run the ACTUAL shipped command from `references/update.md` against
// crafted temporary git repositories (local "origin" consumer and a local
// stand-in for the fixed upstream via `git url.*.insteadOf`). They assert the
// canonical terminal outcome, the non-zero exit, and that no update mutation or
// prepare invocation happens on the negative paths.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The shipped bootstrap command (single source of truth: update.md "Run").
const UPDATE_MD = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "skills/handoff-go/references/update.md"),
  "utf8",
);
const CMD = UPDATE_MD.match(/```sh\n([\s\S]*?)\n```/)[1];

const SKILL_MD = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "skills/handoff-go/SKILL.md"),
  "utf8",
);

// The SKILL.md `go update` route must ship a behavior-equivalent command (it is
// the collapsed single-line form of update.md's multi-line `\`-continued command).
// Normalize both (strip the outer backticks, collapse line continuations and
// whitespace runs) so a divergence between the two copies fails the suite.
function normalizeCommand(cmd) {
  return cmd.replace(/\\[ \t]*\n/g, " ").replace(/\s+/g, " ").trim();
}
{
  const skillLine = SKILL_MD.split("\n").find((l) => l.includes("HG_TMP=\"\""));
  assert.ok(skillLine, "SKILL.md ships the go update bootstrap command");
  const skillCmd = skillLine.trim().replace(/^`/, "").replace(/`$/, "");
  assert.equal(
    normalizeCommand(skillCmd),
    normalizeCommand(CMD),
    "SKILL.md and update.md must ship the same go update bootstrap command",
  );
}

const UPSTREAM_URL = "https://github.com/ee-/handoff-go.git";
const VALID_PIN = "abc123abc123abc123abc123abc123abc123abcd";

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

// Create a consumer repo whose remote default branch (main) AGENTS.md has the
// given text (or no AGENTS.md when `agentsText` is null). Returns { root, repo }.
function initConsumer(agentsText) {
  const root = mkdtempSync(join(tmpdir(), "hg-boot-consumer-"));
  const repo = join(root, "repo");
  const remote = join(root, "repo.git");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t");
  git(repo, "config", "user.name", "t");
  if (agentsText != null) writeFileSync(join(repo, "AGENTS.md"), agentsText);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init", "--allow-empty");
  git(repo, "init", "--bare", "-q", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  return { root, repo, remote };
}

// Make a local stand-in for the fixed upstream holding exactly one pinned commit
// at `sha` with a stub `prepare` (or a custom `updateSource`). Returns { bare, sha }.
function initFixedUpstream(updateSource) {
  const up = mkdtempSync(join(tmpdir(), "hg-boot-upstream-"));
  const work = join(up, "w");
  const bare = join(up, "u.git");
  mkdirSync(join(work, "skills/handoff-go"), { recursive: true });
  git(work, "init", "-q", "-b", "main");
  git(work, "config", "user.email", "t@t");
  git(work, "config", "user.name", "t");
  writeFileSync(
    join(work, "skills/handoff-go/update.mjs"),
    updateSource || 'if (process.argv[2] === "prepare") { console.log("STUB_PREPARE_RAN"); process.exit(0); }\n',
  );
  writeFileSync(join(work, "VERSION"), "1.0.0\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "pin");
  git(work, "init", "--bare", "-q", bare);
  git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
  git(work, "remote", "add", "origin", bare);
  git(work, "push", "-q", "origin", "main");
  const sha = git(work, "rev-parse", "HEAD");
  return { bare, sha };
}

// Pre-provision the cache's object store so `git -C "$STORE" fetch <upstream>`
// is redirected to the local fixed-upstream stand-in.
function prepStore(cacheHome, upstreamBare) {
  const store = join(cacheHome, "handoff-go", "objects.git");
  mkdirSync(store, { recursive: true });
  git(store, "init", "--bare", "-q");
  git(store, "config", `url.${upstreamBare}.insteadOf`, UPSTREAM_URL);
  return store;
}

const BASH = execFileSync("bash", ["-lc", "command -v bash"], { encoding: "utf8" }).trim() || "/bin/bash";

function runCommand(repo, { cacheHome, env = {} } = {}) {
  const res = spawnSync(BASH, ["-c", CMD], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: cacheHome, ...env },
  });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

// A valid managed block pinning `ref`.
function validBlock(ref) {
  return `# Consumer\n<!-- handoff-go:start -->\n## Handoff Go\n- Version: 1.0.0\n- Immutable ref: \`${ref}\`\n- Skill: \`skills/handoff-go/SKILL.md\`\n- Trusted default branch: \`main\`\nFor the exact ordinary-text messages \`go\` and \`go update\`, use the pinned Handoff Go skill above.\n<!-- handoff-go:end -->\n`;
}

function expectOutcome(res, token, re) {
  assert.ok(res.status !== 0, `non-zero exit (got ${res.status}): ${res.stdout}\n${res.stderr}`);
  const combined = `${res.stdout}\n${res.stderr}`;
  assert.ok(combined.includes(token), `emits ${token}: ${combined}`);
  assert.ok(re.test(combined), `emits one actionable reason (${re}): ${combined}`);
  // Exactly ONE canonical outcome, and no stray tooling diagnostics. The bootstrap
  // owns its failure reporting; it must not leak git/node/tar errors.
  const tokens = combined.match(/GO_UPDATE_(CONFLICT|ERROR)/g) || [];
  assert.equal(tokens.length, 1, `exactly one canonical outcome (got ${tokens.length}): ${combined}`);
  assert.ok(
    !/fatal:|command not found|SyntaxError|Node\.js v|npm ERR|cannot open .*No such file|usr\/bin\/node|zsh:|sh: /i.test(combined),
    `no stray tooling diagnostics: ${combined}`,
  );
}

// --------------------------------------------------------------------------
// 1. AC-2: trusted remote default branch has no managed block -> GO_UPDATE_CONFLICT.
//    This is the observed class: the local checkout happens to contain a block,
//    but the remote does not; there must be no local fallback.
// --------------------------------------------------------------------------
{
  const cache = mkdtempSync(join(tmpdir(), "hg-boot-cache-"));
  try {
    // Remote default branch HAS a plain AGENTS.md but NO managed block, while the
    // local working tree DOES carry a block. The command must read only the remote
    // (FETCH_HEAD) and never fall back to the local working-tree AGENTS.md.
    const { root, repo } = initConsumer("# plain repo, no handoff block\n");
    writeFileSync(join(repo, "AGENTS.md"), validBlock(VALID_PIN));
    const res = runCommand(repo, { cacheHome: cache });
    expectOutcome(res, "GO_UPDATE_CONFLICT", /no Handoff Go managed block found; repository is not opted in/);
    // Zero mutation: no fetch of the fixed upstream into the fresh store.
    assert.ok(!existsSync(join(cache, "handoff-go/objects.git/refs/heads/main")), "no upstream materialization");
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// 2. AC-1 / AC-4: infrastructure failures -> GO_UPDATE_ERROR, one line, stop.
// --------------------------------------------------------------------------
{
  // (a) remote default branch cannot be fetched (no origin) -> GO_UPDATE_ERROR.
  const cacheA = mkdtempSync(join(tmpdir(), "hg-boot-cache-"));
  try {
    const { root, repo } = initConsumer(validBlock(VALID_PIN));
    git(repo, "remote", "remove", "origin");
    const res = runCommand(repo, { cacheHome: cacheA });
    expectOutcome(res, "GO_UPDATE_ERROR", /cannot fetch the trusted default branch/);
  } finally {
    rmSync(cacheA, { recursive: true, force: true });
  }

  // (b) remote default branch has no AGENTS.md -> GO_UPDATE_CONFLICT.
  const cacheB = mkdtempSync(join(tmpdir(), "hg-boot-cache-"));
  try {
    const { root, repo } = initConsumer(null);
    const res = runCommand(repo, { cacheHome: cacheB });
    expectOutcome(res, "GO_UPDATE_CONFLICT", /trusted default branch has no readable AGENTS\.md/);
  } finally {
    rmSync(cacheB, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// 3. AC-3: malformed / floating Immutable ref -> GO_UPDATE_CONFLICT, zero prepare.
// --------------------------------------------------------------------------
{
  const cache = mkdtempSync(join(tmpdir(), "hg-boot-cache-"));
  try {
    for (const [label, ref, re] of [
      ["floating", "main", /refusing floating governance ref/],
      ["malformed", "not-a-ref!!", /malformed Immutable ref/],
      ["missing", VALID_PIN, /expected exactly one Immutable ref entry/],
    ]) {
      const { root, repo } = initConsumer(validBlock(ref));
      if (label === "missing") {
        const p = join(repo, "AGENTS.md");
        writeFileSync(p, readFileSync(p, "utf8").replace(`- Immutable ref: \`${ref}\`\n`, ""));
        git(repo, "add", "-A");
        git(repo, "commit", "-qm", "no-ref");
        git(repo, "push", "-q", "origin", "main");
      }
      const res = runCommand(repo, { cacheHome: cache });
      expectOutcome(res, "GO_UPDATE_CONFLICT", re);
    }
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// 4. AC-4: pinned-upstream materialization failure (valid ref, absent upstream)
//    -> GO_UPDATE_ERROR. Deterministic via local upstream redirect.
// --------------------------------------------------------------------------
{
  const cache = mkdtempSync(join(tmpdir(), "hg-boot-cache-"));
  try {
    const { bare, sha } = initFixedUpstream();
    // Pin a ref that is NOT in the upstream.
    const absent = "e".repeat(40);
    prepStore(cache, bare);
    const { root, repo } = initConsumer(validBlock(absent));
    const res = runCommand(repo, { cacheHome: cache });
    expectOutcome(res, "GO_UPDATE_ERROR", /cannot materialize pinned Handoff Go/);
    assert.ok(!existsSync(join(cache, "handoff-go/objects.git/refs/heads/main")), "no mutation on materialization failure");
    void sha;
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// 4b. A pinned updater that cannot start (syntax corruption) emits exactly one
//     GO_UPDATE_ERROR with no stray Node diagnostics; prepare is NOT reached.
// --------------------------------------------------------------------------
{
  const cache = mkdtempSync(join(tmpdir(), "hg-boot-cache-"));
  try {
    const { bare, sha } = initFixedUpstream("const this is broken syntax = ;\n");
    prepStore(cache, bare);
    const { root, repo } = initConsumer(validBlock(sha));
    const res = runCommand(repo, { cacheHome: cache });
    expectOutcome(res, "GO_UPDATE_ERROR", /pinned Handoff Go updater is not loadable/);
    assert.ok(!res.stdout.includes("STUB_PREPARE_RAN") && !res.stderr.includes("STUB_PREPARE_RAN"), "prepare is never invoked");
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// 4b2. A pinned updater with valid syntax but an unresolvable ES module import
//      passes `node --check` but fails at module load; the bootstrap must emit
//      exactly one GO_UPDATE_ERROR with no raw module-loader diagnostics.
// --------------------------------------------------------------------------
{
  const cache = mkdtempSync(join(tmpdir(), "hg-boot-cache-"));
  try {
    const { bare, sha } = initFixedUpstream('import "./missing-module.mjs";\nconsole.log("should not reach here");\n');
    prepStore(cache, bare);
    const { root, repo } = initConsumer(validBlock(sha));
    const res = runCommand(repo, { cacheHome: cache });
    expectOutcome(res, "GO_UPDATE_ERROR", /pinned Handoff Go updater is not loadable/);
    assert.ok(!res.stdout.includes("should not reach here") && !res.stderr.includes("should not reach here"), "updater body never executes");
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// 4c. `node` absent: the bootstrap emits exactly one GO_UPDATE_ERROR (the
//     `command -v node` guard) instead of a raw "command not found".
// --------------------------------------------------------------------------
{
  const cache = mkdtempSync(join(tmpdir(), "hg-boot-cache-"));
  try {
    const { root, repo } = initConsumer(validBlock("d".repeat(40)));
    // Build a PATH that has the tools the bootstrap needs but NOT node.
    const bin = mkdtempSync(join(tmpdir(), "hg-boot-bin-"));
    const real = (cmd) => execFileSync(BASH, ["-lc", `command -v ${cmd}`], { encoding: "utf8" }).trim();
    for (const cmd of ["git", "tar", "grep", "mktemp"]) {
      const p = real(cmd);
      if (p) execFileSync("ln", ["-s", p, join(bin, cmd)]);
    }
    const res = runCommand(repo, { cacheHome: cache, env: { PATH: bin } });
    expectOutcome(res, "GO_UPDATE_ERROR", /node is required to run go update/);
    assert.ok(!/command not found/.test(res.stderr), "no raw command-not-found leaked");
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// 5. AC-5: happy path unchanged — a valid pin materializes the pinned updater
//    and invokes `prepare` (stub prints the marker).
// --------------------------------------------------------------------------
{
  const cache = mkdtempSync(join(tmpdir(), "hg-boot-cache-"));
  try {
    const { bare, sha } = initFixedUpstream();
    prepStore(cache, bare);
    const { root, repo } = initConsumer(validBlock(sha));
    const res = runCommand(repo, { cacheHome: cache });
    assert.equal(res.status, 0, `happy path exits 0 (got ${res.status}): ${res.stdout}\n${res.stderr}`);
    assert.ok(res.stdout.includes("STUB_PREPARE_RAN"), "materialized pinned updater prepare invoked");
    assert.ok(!/GO_UPDATE_(CONFLICT|ERROR)/.test(res.stdout), "happy path emits no canonical outcome wrapper");
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

console.log("go update bootstrap tests: PASS");
