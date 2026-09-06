// Focused tests for the pre-adoption bootstrap proof (issue #31).
// Run: node tests/bootstrap.test.mjs
//
// Hermetic: the installer listing, upstream HEAD, and pinned tree are all
// injected fakes over real temporary directories, so the byte-comparison and
// every fail-closed branch are proven without network or a real installer.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prove } from "../skills/handoff-go/bootstrap.mjs";

const COMMIT = "a".repeat(40);

const dirs = [];
function tempRoot(files) {
  const dir = mkdtempSync(join(tmpdir(), "hg-bootstrap-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

const SKILL_BYTES = {
  "SKILL.md": "---\nname: handoff-go\n---\n",
  "references/core.md": "# core\n",
  "update.mjs": "// updater\n",
};

// Fake effects over real trees: a project-local install inside a consumer
// repository, plus the upstream commit's skill directory to extract.
function fakeWorld({ installed, source = installed, heads = `${COMMIT}\tHEAD\n`, version = "1.0.0", listings = 1 } = {}) {
  const repoDir = tempRoot({ "README.md": "# consumer\n" });
  const installDir = join(repoDir, ".agents/skills/handoff-go");
  mkdirSync(installDir, { recursive: true });
  for (const [rel, content] of Object.entries(installed)) {
    const path = join(installDir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  const entries = Array.from({ length: listings }, () => ({
    name: "handoff-go",
    scope: "project",
    path: installDir,
  }));
  const io = {
    list: () => JSON.stringify(entries),
    remoteHeads: () => heads,
    materialize: (ref, tmps) => {
      assert.equal(ref, COMMIT);
      // prove() removes the temp trees it is handed, so each call extracts fresh.
      const fresh = tempRoot(source);
      tmps.push(fresh);
      return { skillDir: fresh, store: repoDir };
    },
    show: (_store, rev) => {
      assert.equal(rev, `${COMMIT}:VERSION`);
      return version;
    },
  };
  return { repoDir, io };
}

function expectConflict(fn, pattern) {
  assert.throws(fn, (e) => {
    assert.equal(e.code, "GO_BOOTSTRAP_CONFLICT");
    assert.match(e.message, pattern);
    return true;
  });
}

// --- happy path: exact bytes emit the proof fields ---
{
  const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES });
  const ev = prove({ repoDir, io });
  assert.deepEqual(ev, {
    immutableRef: COMMIT,
    skillPath: ".agents/skills/handoff-go/SKILL.md",
    version: "1.0.0",
  });
}

// --- AC-4: a non-current semantic version passes through prove unchanged ---
{
  const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES, version: "9.8.7" });
  assert.equal(prove({ repoDir, io }).version, "9.8.7");
}

// --- AC-7: the skill path is derived from installer state, never guessed ---
{
  const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES });
  const ev = prove({ repoDir, io });
  assert.equal(ev.skillPath, ".agents/skills/handoff-go/SKILL.md");
  assert.ok(!/\.claude|\.codex/.test(ev.skillPath), "path must not name another agent dir");
}

// --- AC-9: identical bytes reproduce the same proof, twice ---
{
  const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES });
  assert.deepEqual(prove({ repoDir, io }), prove({ repoDir, io }));
}

// --- AC-10: every gap fails closed with one actionable conflict ---
expectConflict(
  () => {
    const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES });
    io.list = () => "[]";
    return prove({ repoDir, io });
  },
  /no project-local Handoff Go install/,
);
expectConflict(
  () => {
    const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES, listings: 2 });
    return prove({ repoDir, io });
  },
  /multiple project-local Handoff Go installs/,
);
expectConflict(
  () => {
    const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES });
    io.list = () => "not json";
    return prove({ repoDir, io });
  },
  /cannot read the installer's project skill listing/,
);
expectConflict(
  () => {
    const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES, heads: `${"b".repeat(40)}\tHEAD\n${COMMIT}\tHEAD\n` });
    return prove({ repoDir, io });
  },
  /not exactly one commit/,
);
expectConflict(
  () => {
    const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES, heads: "deadbeef\tHEAD\n" });
    return prove({ repoDir, io });
  },
  /not a full commit SHA/,
);
// A local edit fails closed on the edited path.
expectConflict(
  () => {
    const { repoDir, io } = fakeWorld({
      installed: { ...SKILL_BYTES, "SKILL.md": "---\nname: tampered\n---\n" },
      source: SKILL_BYTES,
    });
    return prove({ repoDir, io });
  },
  /installed bytes do not match upstream .*SKILL\.md/,
);
// A HEAD that moved between install and prove (extra file upstream) also drifts.
expectConflict(
  () => {
    const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES, source: { ...SKILL_BYTES, "extra.mjs": "// extra\n" } });
    return prove({ repoDir, io });
  },
  /do not match upstream .*extra\.mjs/,
);
expectConflict(
  () => {
    const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES, version: "nightly" });
    return prove({ repoDir, io });
  },
  /no valid VERSION/,
);
expectConflict(
  () => {
    const { repoDir, io } = fakeWorld({ installed: SKILL_BYTES });
    rmSync(join(repoDir, ".agents/skills/handoff-go/SKILL.md"));
    return prove({ repoDir, io });
  },
  /installed skill has no SKILL\.md/,
);

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
console.log("Handoff Go bootstrap tests: PASS");
