// Deterministic tests for Handoff Go update transaction seam and fail-closed decisions.
// Run: node tests/update.test.mjs

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  UPSTREAM,
  HARNESS_RUNTIME,
  applyDeclarativeMigrations,
  detectHarness,
  materializeHarnessRuntime,
  materializePinned,
  parseManagedBlock,
  prepare,
  productionIO,
  report,
  resolveTrusted,
  updateManagedBlock,
} from "../skills/handoff-go/update.mjs";

// Tests must be deterministic regardless of the harness that runs them: a dev
// session inside OMP exports OMPCODE=1, so unset it so `detectHarness()` default
// is provably "not OMP". OMP-detected cases inject `harness: "omp"` explicitly.
delete process.env.OMPCODE;

const START = "<!-- handoff-go:start -->";
const END = "<!-- handoff-go:end -->";
const OLD_REF = "1".repeat(40);
const NEW_REF = "2".repeat(40);
const COMMIT_SHA = "3".repeat(40);

const SAMPLE_AGENTS = [
  "# Repo Header",
  "",
  START,
  "## Handoff Go",
  "",
  "- Version: 1.0.0",
  `- Immutable ref: \`${OLD_REF}\` (applied at release)`,
  "- Skill: `skills/handoff-go/SKILL.md`",
  "- Trusted default branch: `main`",
  "",
  "For the exact ordinary-text messages `go` and `go update`, use the pinned Handoff Go skill above (`go update` is maintenance only, never workflow state): this block claims those commands, so resolve them here before consulting any checkout-local, harness-discovered, or globally installed skill, then load exactly that pinned implementation and execute it without rediscovering or reinterpreting the command; requests this block does not claim keep normal skill discovery.",
  END,
  "",
  "Footer text outside the block that MUST survive.",
].join("\n");

const SKILL_FRONTMATTER = [
  "---",
  "name: handoff-go",
  "description: Deterministic Handoff Go skill",
  "license: MIT",
  "---",
  "",
  "# Handoff Go",
].join("\n");

// In-process recording fake adapter
export function createRecordingFakeIO(options = {}) {
  const calls = [];
  const trace = [];

  const record = (type, dir, args, result) => {
    calls.push({ type, dir, args, result });
    trace.push([type, dir, args]);
  };

  const defaultGraphql = () => {
    const head = options.trustedHead || OLD_REF;
    const branch = options.trustedBranch || "main";
    const agentsText = options.agentsText !== undefined ? options.agentsText : SAMPLE_AGENTS;
    const openPrs = options.openPrs || [];
    const hasNextPage = options.hasNextPage || false;
    return JSON.stringify({
      data: {
        repository: {
          defaultBranchRef: {
            name: branch,
            target: {
              oid: head,
              file: {
                object: agentsText !== null ? { text: agentsText } : null,
              },
            },
          },
          pullRequests: {
            nodes: openPrs,
            pageInfo: { hasNextPage },
          },
        },
      },
    });
  };

  return {
    calls,
    trace,
    git(dir, ...args) {
      const entry = { type: "git", dir, args, result: null };
      calls.push(entry);
      trace.push(["git", dir, args]);

      if (options.onGit) {
        const custom = options.onGit(dir, args);
        if (custom !== undefined) {
          entry.result = custom;
          return custom;
        }
      }
      const cmd = args[0];
      let res = "";
      if (cmd === "remote" && args[1] === "get-url") {
        res = options.originUrl || "https://github.com/ee-/handoff-go.git";
      } else if (cmd === "config") {
        // Real `git config --get` semantics: exit 0 with the value when set;
        // silent exit 1 when simply absent; exit 1 + "fatal:" stderr when the
        // config itself is unparseable (modeled via configFatal).
        const key = args[args.length - 1];
        const val = key === "core.sshCommand" ? options.coreSshCommand
          : key === "ssh.variant" ? options.sshVariant : undefined;
        if (val) res = val;
        else {
          const err = new Error(options.configFatal ? "fatal: bad config line 11 in file .git/config" : "config absent");
          err.status = 1;
          err.stderr = options.configFatal ? "fatal: bad config line 11 in file .git/config" : "";
          if (options.configFatal128) { err.status = 128; err.stderr = "fatal: bad config"; }
          throw err;
        }
      } else if (cmd === "ls-remote") {
        if (options.lsRemoteError) throw options.lsRemoteError;
        res = (options.upstreamHead !== undefined ? options.upstreamHead : NEW_REF) + "\tHEAD";
      } else if (cmd === "rev-parse" && args.includes("--verify")) {
        const ref = args[args.length - 1];
        const branchName = ref.replace(/^refs\/heads\//, "");
        if (options.existingBranches && options.existingBranches.includes(branchName)) {
          res = "branch-exists";
        } else {
          const err = new Error(`fatal: Needed a single revision`);
          err.stderr = `fatal: Needed a single revision`;
          throw err;
        }
      } else if (cmd === "init" && args.includes("--bare")) {
        res = "";
      } else if (cmd === "fetch" && args.includes("origin")) {
        if (options.fetchOriginError) throw options.fetchOriginError;
        res = "";
      } else if (cmd === "fetch") {
        if (options.fetchUpstreamError) throw options.fetchUpstreamError;
        res = "";
      } else if (cmd === "rev-parse" && args[1] === "FETCH_HEAD") {
        res = options.fetchedHead !== undefined ? options.fetchedHead : (options.trustedHead || OLD_REF);
      } else if (cmd === "worktree" && args[1] === "add") {
        if (options.worktreeAddError) throw options.worktreeAddError;
        const wtDir = args[args.length - 2];
        if (options.populateWorktree) {
          options.populateWorktree(wtDir);
        }
        res = "";
      } else if (cmd === "worktree" && args[1] === "remove") {
        res = "";
      } else if (cmd === "branch" && args.includes("-D")) {
        res = "";
      } else if (cmd === "cat-file" && args.includes("VERSION")) {
        res = options.targetVersion !== undefined ? options.targetVersion : "1.1.0\n";
      } else if (cmd === "add") {
        res = "";
      } else if (cmd === "status") {
        if (options.statusOutput !== undefined) {
          res = options.statusOutput;
        } else if (options.computeStatus) {
          res = options.computeStatus(dir);
        } else {
          res = " M .omp/watch.mjs\0 M AGENTS.md\0 M skills/handoff-go/SKILL.md\0";
        }
      } else if (cmd === "commit") {
        if (options.commitError) throw options.commitError;
        res = `[handoff-go/update ${NEW_REF.slice(0, 8)}] update`;
      } else if (cmd === "rev-parse" && args[1] === "HEAD") {
        res = options.commitSha || COMMIT_SHA;
      }
      entry.result = res;
      return res;
    },
    ssh(host) {
      const entry = { type: "ssh", dir: "", args: [host], result: null };
      calls.push(entry);
      trace.push(["ssh", "", [host]]);
      if (options.sshError) throw options.sshError;
      const res = options.sshResolvedHost !== undefined ? `user git\nhostname ${options.sshResolvedHost}\nport 22\n` : "";
      entry.result = res;
      return res;
    },
    gh(dir, args) {
      const entry = { type: "gh", dir, args, result: null };
      calls.push(entry);
      trace.push(["gh", dir, args]);

      if (options.onGh) {
        const custom = options.onGh(dir, args);
        if (custom !== undefined) {
          entry.result = custom;
          return custom;
        }
      }
      if (options.ghError) throw options.ghError;
      const res = defaultGraphql();
      entry.result = res;
      return res;
    },
    extractSkill(cache, sha, tmps) {
      calls.push({ type: "extractSkill", dir: cache, args: [sha], result: null });
      trace.push(["extractSkill", cache, [sha]]);
      if (options.onExtractSkill) {
        return options.onExtractSkill(cache, sha, tmps);
      }
      if (sha === (options.upstreamHead !== undefined ? options.upstreamHead : NEW_REF)) {
        return options.newSkillDir;
      }
      return options.oldSkillDir;
    },
  };
}

function setupEnvironment() {
  const root = mkdtempSync(join(tmpdir(), "hg-test-env-"));
  const oldSkillDir = join(root, "old-skill");
  const newSkillDir = join(root, "new-skill");
  const repoDir = join(root, "repo");

  mkdirSync(join(oldSkillDir, "adapters"), { recursive: true });
  mkdirSync(join(newSkillDir, "adapters"), { recursive: true });
  mkdirSync(repoDir, { recursive: true });

  // Pinned OLD skill
  writeFileSync(join(oldSkillDir, "SKILL.md"), SKILL_FRONTMATTER);
  writeFileSync(join(oldSkillDir, "watch.mjs"), `export const version = "1.0.0";\n`);
  writeFileSync(join(oldSkillDir, "adapters/watch.js"), `export default function watch() {}\n`);
  writeFileSync(join(oldSkillDir, "migrations.json"), JSON.stringify({ version: 1, operations: [] }));

  // Upstream NEW skill
  writeFileSync(join(newSkillDir, "SKILL.md"), SKILL_FRONTMATTER);
  writeFileSync(join(newSkillDir, "watch.mjs"), `export const version = "1.1.0";\n`);
  writeFileSync(join(newSkillDir, "adapters/watch.js"), `export default function watch() {}\n`);
  writeFileSync(
    join(newSkillDir, "migrations.json"),
    JSON.stringify({
      version: 1,
      operations: [
        {
          type: "set_field",
          field: "Version",
          value: "1.1.0",
        },
      ],
    }),
  );

  const populateWorktree = (wt) => {
    mkdirSync(join(wt, "skills/handoff-go/adapters"), { recursive: true });
    mkdirSync(join(wt, ".omp"), { recursive: true });
    writeFileSync(join(wt, "AGENTS.md"), SAMPLE_AGENTS);
    writeFileSync(join(wt, "skills/handoff-go/SKILL.md"), SKILL_FRONTMATTER);
    writeFileSync(join(wt, "skills/handoff-go/watch.mjs"), `export const version = "1.0.0";\n`);
    writeFileSync(join(wt, "skills/handoff-go/adapters/watch.js"), `export default function watch() {}\n`);
    writeFileSync(join(wt, "skills/handoff-go/migrations.json"), JSON.stringify({ version: 1, operations: [] }));
    writeFileSync(join(wt, ".omp/watch.mjs"), `export const version = "1.0.0";\n`);
  };

  const cleanup = () => {
    rmSync(root, { recursive: true, force: true });
  };

  return { root, oldSkillDir, newSkillDir, repoDir, populateWorktree, cleanup };
}

// --------------------------------------------------------------------------
// 1. Transaction tests through prepare() with recording fake adapter
// --------------------------------------------------------------------------

{
  // Test 1: Successful PREPARED and bounded effect trace (AC-3, AC-4, AC-11)
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: env.populateWorktree,
    });

    const ev = prepare({ repoDir: env.repoDir, io: fake });

    assert.equal(ev.result, "PREPARED", "result must be internal status PREPARED");
    assert.equal(ev.oldRef, OLD_REF, "oldRef matches pinned governance");
    assert.equal(ev.newRef, NEW_REF, "newRef matches upstream HEAD");
    assert.equal(ev.commit, COMMIT_SHA, "commit matches local commit");
    assert.equal(ev.transitions.insideUpdater, 4, "insideUpdater transition count is 4");
    assert.equal(ev.transitions.outsidePlanned, 2, "outsidePlanned transitions is 2 (push + PR create)");
    assert.equal(ev.validation.installedMatchesNew, true, "installed matches NEW");
    assert.equal(ev.validation.pinMatchesNew, true, "pin matches NEW");
    assert.equal(ev.validation.outsideBytesPreserved, true, "outside bytes preserved");
    assert.equal(ev.runtime.refreshed.includes(".omp/watch.mjs"), true, ".omp/watch.mjs refreshed");

    // AC-11 trace verification: prove bounded effect sequence
    const traceTypes = fake.trace.map((t) => t[0]);
    assert.deepEqual(
      traceTypes,
      [
        "git", // remote get-url origin
        "gh",  // api graphql discovery
        "git", // ls-remote upstream HEAD
        "git", // rev-parse verify branch
        "git", // cache init bare
        "git", // cache fetch upstream
        "extractSkill", // extract NEW
        "extractSkill", // extract OLD
        "git", // cat-file VERSION
        "git", // fetch origin main
        "git", // rev-parse FETCH_HEAD
        "git", // worktree add
        "git", // worktree add -A
        "git", // worktree status -z
        "git", // worktree commit
        "git", // worktree rev-parse HEAD
        "git", // worktree remove
      ],
      "prepare() executes the exact bounded effect sequence",
    );

    // Verify branch was kept on success (no branch -D)
    assert.equal(
      fake.calls.some((c) => c.args.includes("-D")),
      false,
      "proposal branch must be kept on success",
    );
    // Verify worktree was removed in finally
    assert.equal(
      fake.calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove"),
      true,
      "worktree must be removed in finally",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 2: UP_TO_DATE path (AC-4)
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      upstreamHead: OLD_REF, // upstream is already at OLD_REF
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
    });

    const ev = prepare({ repoDir: env.repoDir, io: fake });
    assert.equal(ev.result, "UP_TO_DATE", "returns UP_TO_DATE when newRef === oldRef");
    assert.equal(ev.oldRef, OLD_REF);
    assert.equal(ev.newRef, OLD_REF);
    // Must stop before any cache/fetch/worktree mutation
    assert.equal(fake.calls.some((c) => c.args[0] === "worktree"), false, "no worktree created on UP_TO_DATE");
    assert.equal(fake.calls.some((c) => c.args[0] === "fetch"), false, "no fetch on UP_TO_DATE");
  } finally {
    env.cleanup();
  }
}

{
  // Test 3: Existing same-NEW proposal reuse (AC-4, AC-6)
  const env = setupEnvironment();
  try {
    const proposalBranch = `handoff-go/update-${NEW_REF.slice(0, 8)}`;
    const fake = createRecordingFakeIO({
      openPrs: [
        {
          headRefName: proposalBranch,
          baseRefName: "main",
          isCrossRepository: false,
          url: "https://github.com/ee-/handoff-go/pull/42",
        },
      ],
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
    });

    const ev = prepare({ repoDir: env.repoDir, io: fake });
    assert.equal(ev.result, "REUSE", "existing proposal reuses idempotently");
    assert.equal(ev.existingProposal.url, "https://github.com/ee-/handoff-go/pull/42");
    assert.equal(fake.calls.some((c) => c.args[0] === "worktree"), false, "no mutation on REUSE");
  } finally {
    env.cleanup();
  }
}

{
  // Test 4: Conflicting proposal targeting different ref fails closed (AC-4, AC-6)
  const env = setupEnvironment();
  try {
    const otherBranch = "handoff-go/update-deadbeef";
    const fake = createRecordingFakeIO({
      openPrs: [
        {
          headRefName: otherBranch,
          baseRefName: "main",
          isCrossRepository: false,
          url: "https://github.com/ee-/handoff-go/pull/99",
        },
      ],
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
    });

    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      /open Handoff Go update proposal .* targets handoff-go\/update-deadbeef; supersede or close it/,
      "different proposal ref fails closed",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 5: Proposal targeting wrong base branch fails closed (AC-4)
  const env = setupEnvironment();
  try {
    const proposalBranch = `handoff-go/update-${NEW_REF.slice(0, 8)}`;
    const fake = createRecordingFakeIO({
      openPrs: [
        {
          headRefName: proposalBranch,
          baseRefName: "release",
          isCrossRepository: false,
          url: "https://github.com/ee-/handoff-go/pull/101",
        },
      ],
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
    });

    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      /targets base release, not the trusted default branch main/,
      "same-repo proposal on wrong base fails closed",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 6: Local proposal branch already exists fails closed (AC-4)
  const env = setupEnvironment();
  try {
    const proposalBranch = `handoff-go/update-${NEW_REF.slice(0, 8)}`;
    const fake = createRecordingFakeIO({
      existingBranches: [proposalBranch],
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
    });

    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      /local branch handoff-go\/update-.* already exists and is not a recognized durable proposal/,
      "existing local proposal branch fails closed",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 7: Trusted default branch moved during preparation fails closed (AC-4)
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      trustedHead: "1".repeat(40),
      fetchedHead: "9".repeat(40), // head moved during preparation
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: env.populateWorktree,
    });

    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      /trusted default branch main moved from 11111111 to 99999999 during preparation/,
      "trusted head movement fails closed",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 8: Trusted branch mismatch between AGENTS.md and repo default branch fails closed (AC-4)
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      trustedBranch: "release", // repository resolves release, but AGENTS.md specifies main
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
    });

    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      /trusted managed block names default branch main, but the repository resolves release/,
      "default branch mismatch fails closed",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 9: Upstream target resolution failure fails closed (AC-4)
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      lsRemoteError: new Error("network down or repository not found"),
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
    });

    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      /cannot reach trusted upstream https:\/\/github\.com\/ee-\/handoff-go\.git/,
      "upstream unreachable fails closed",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 10: Installed bytes drift detection fails closed (AC-4)
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: (wt) => {
        env.populateWorktree(wt);
        // Introduce drift in installed SKILL.md
        writeFileSync(join(wt, "skills/handoff-go/SKILL.md"), "drifted content\n");
      },
    });

    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      /installed Handoff Go bytes differ from pinned/,
      "installed byte drift fails closed",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 11: Scope guard rejects foreign changes (AC-4)
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: env.populateWorktree,
      statusOutput: " M AGENTS.md\0A  src/index.js\0",
    });

    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      /prepared changes outside Handoff Go managed scope: src\/index\.js/,
      "outside scope change fails closed",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 12: Scope guard rejects empty changes when refs differ (AC-4)
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: env.populateWorktree,
      statusOutput: "",
    });

    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      /no changes prepared although the pinned ref differs from NEW/,
      "empty changes on differing ref fails closed",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 13: Failure cleanup cleans worktree AND deletes proposal branch (AC-4)
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: env.populateWorktree,
      commitError: new Error("commit failed due to unconfigured git author"),
    });

    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      /commit failed/,
      "commit failure propagates",
    );

    // Verify cleanup in finally:
    const removedWorktree = fake.calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove");
    const deletedBranch = fake.calls.some((c) => c.args[0] === "branch" && c.args.includes("-D"));
    assert.equal(removedWorktree, true, "worktree was cleaned up on failure");
    assert.equal(deletedBranch, true, "uncommitted proposal branch was deleted on failure");
  } finally {
    env.cleanup();
  }
}

{
  // Test 14: Dry run prepares but does not commit, leaves branch deleted (AC-4)
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: env.populateWorktree,
    });

    const ev = prepare({ repoDir: env.repoDir, dryRun: true, io: fake });
    assert.equal(ev.result, "PREPARED");
    assert.equal(ev.dryRun, true);
    assert.equal(ev.transitions.outsidePlanned, 0, "no outside transitions in dry-run");
    assert.equal(fake.calls.some((c) => c.args[0] === "commit"), false, "no commit executed in dry-run");
    assert.equal(fake.calls.some((c) => c.args[0] === "branch" && c.args.includes("-D")), true, "branch cleaned up after dry-run");
  } finally {
    env.cleanup();
  }
}

{
  // Test 15: Legacy runtime copy migration through prepare()
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: (wt) => {
        env.populateWorktree(wt);
        // Add legacy adapter copy
        mkdirSync(join(wt, ".omp/extensions"), { recursive: true });
        writeFileSync(join(wt, ".omp/extensions/handoff-go-watch.mjs"), "export default function watch() {}\n");
      },
    });

    const ev = prepare({ repoDir: env.repoDir, io: fake });
    assert.equal(ev.result, "PREPARED");
    assert.equal(
      ev.runtime.migrated.includes(".omp/extensions/handoff-go-watch.mjs -> .omp/extensions/handoff-go-watch.js"),
      true,
      "legacy runtime adapter migrated to .js",
    );
  } finally {
    env.cleanup();
  }
}

{
  // Test 16: Fork PR or unproven PR never carries update authority in prepare()
  const env = setupEnvironment();
  try {
    const proposalBranch = `handoff-go/update-${NEW_REF.slice(0, 8)}`;
    const fake = createRecordingFakeIO({
      openPrs: [
        {
          headRefName: proposalBranch,
          baseRefName: "main",
          isCrossRepository: true, // fork PR
          url: "https://github.com/fork/handoff-go/pull/1",
        },
        {
          headRefName: proposalBranch,
          baseRefName: "main",
          url: "https://github.com/unproven/handoff-go/pull/2",
        },
      ],
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: env.populateWorktree,
    });

    const ev = prepare({ repoDir: env.repoDir, io: fake });
    assert.equal(ev.result, "PREPARED", "fork or unproven PR ignored, proceeds to prepare proposal");
  } finally {
    env.cleanup();
  }
}

// --------------------------------------------------------------------------
// 2. Migrated load-bearing regression tests from demo() (AC-7, AC-8)
// --------------------------------------------------------------------------

{
  // Managed block parsing and rewrite
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

  assert.equal(parseManagedBlock(agents).skillPath, "skills/handoff-go/SKILL.md", "parses skill path");
  assert.equal(parseManagedBlock(agents).immutableRef.startsWith("aaaa"), true, "parses immutable ref");
  assert.equal(parseManagedBlock(agents).trustedBranch, "main", "parses trusted default branch");
  assert.equal(parseManagedBlock(agents).immutableRef, "a".repeat(40), "trailing prose never leaks into the pin");

  const swapRef = (ref) => agents.replace(/- Immutable ref:.*/, `- Immutable ref: \`${ref}\``);
  assert.throws(() => parseManagedBlock(swapRef("+refs/heads/*:refs/heads/*")), /malformed Immutable ref/);
  assert.throws(() => parseManagedBlock(swapRef("v1.0.0 --upload-pack=x")), /malformed Immutable ref/);

  const updated = updateManagedBlock(agents, { ref: "b".repeat(40), version: "1.9.9" });
  assert.equal(parseManagedBlock(updated).immutableRef, "b".repeat(40), "ref rewritten");
  assert.equal(parseManagedBlock(updated).version, "1.9.9", "version rewritten");
  assert.equal(updated.includes("Unrelated trailing governance prose that MUST survive."), true, "inner prose preserved");
  assert.equal(updated.includes("Footer text outside the block that MUST survive."), true, "outer prose preserved");
  assert.equal(updated.includes("# Repo"), true, "pre-block header preserved");
  assert.equal(parseManagedBlock(updated).skillPath, "skills/handoff-go/SKILL.md", "skill path untouched");
  assert.equal(updated.split("\n").length, agents.split("\n").length, "line count unchanged");

  // Legacy routing upgrades
  const legacyRoutingAgents = agents.replace(
    "Unrelated trailing governance prose that MUST survive.",
    "For the exact ordinary-text message `go`, use the pinned Handoff Go skill above.\nLoad this block from main.",
  );
  const upgradedRouting = updateManagedBlock(legacyRoutingAgents, { ref: "c".repeat(40) });
  assert.equal(
    upgradedRouting.includes(
      "For the exact ordinary-text messages `go` and `go update`, use the pinned Handoff Go skill above (`go update` is maintenance only, never workflow state).",
    ),
    true,
    "legacy command routing upgraded",
  );
  assert.equal(upgradedRouting.includes("Load this block from main."), true, "surrounding prose preserved");

  // Upgrades even if go update appears in other prose
  const noteAgents = legacyRoutingAgents.replace("Load this block from main.", "Note: `go update` exists.\nLoad this block from main.");
  const upgradedNote = updateManagedBlock(noteAgents, { ref: "c".repeat(40) });
  assert.equal(upgradedNote.includes("For the exact ordinary-text messages `go` and `go update`"), true);

  // Multiple routing sentences fail closed
  const multiRouting = legacyRoutingAgents.replace("Load this block from main.", "For the exact ordinary-text message `go`, use foo.");
  assert.throws(() => updateManagedBlock(multiRouting, { ref: "c".repeat(40) }), /ambiguous command routing/);

  // Unrecognized routing sentence fails closed
  const weirdRouting = agents.replace("Unrelated trailing governance prose", "For the exact ordinary-text message `custom`, use skill.");
  assert.throws(() => updateManagedBlock(weirdRouting, { ref: "c".repeat(40) }), /unrecognized ordinary command routing/);

  // Shipped manifest migration reachability
  const migrationsPath = join(dirname(fileURLToPath(import.meta.url)), "../skills/handoff-go/migrations.json");
  const shipped = JSON.parse(readFileSync(migrationsPath, "utf8"));
  const routerDeclaration =
    "For the exact ordinary-text messages `go` and `go update`, use the pinned Handoff Go skill above (`go update` is maintenance only, never workflow state): this block claims those commands, so resolve them here before consulting any checkout-local, harness-discovered, or globally installed skill, then load exactly that pinned implementation and execute it without rediscovering or reinterpreting the command; requests this block does not claim keep normal skill discovery.";
  const shapes = {
    "legacy one-line": "For the exact ordinary-text message `go`, use the pinned Handoff Go skill above.",
    "legacy wrapped": "For the exact ordinary-text message `go`, use the pinned\nHandoff Go skill above.",
    "current one-line":
      "For the exact ordinary-text messages `go` and `go update`, use the pinned Handoff Go skill above (`go update` is maintenance only, never workflow state).",
    "current wrapped":
      "For the exact ordinary-text messages `go` and `go update`, use the pinned\nHandoff Go skill above (`go update` is maintenance only, never workflow state).",
    "current wrapped without `pinned`":
      "For the exact ordinary-text messages `go` and `go update`, use the Handoff Go\nskill above (`go update` is maintenance only, never\nworkflow state).",
    "router already applied": routerDeclaration,
  };
  for (const [shape, declaration] of Object.entries(shapes)) {
    const block = agents.replace(
      "Unrelated trailing governance prose that MUST survive.",
      `${declaration} Same-line prose MUST survive.\nLoad this block from main.`,
    );
    const out = updateManagedBlock(block, { ref: "e".repeat(40), migrations: shipped });
    assert.equal(out.includes("Same-line prose MUST survive."), true, `same-line prose preserved: ${shape}`);
    assert.equal(out.includes(routerDeclaration), true, `router declaration migrated: ${shape}`);
    assert.equal(out.includes("Load this block from main."), true, `surrounding prose preserved: ${shape}`);
    assert.equal([...out.matchAll(/For the exact ordinary-text message/g)].length, 1, `exactly one declaration: ${shape}`);
    assert.equal(updateManagedBlock(out, { ref: "e".repeat(40), migrations: shipped }), out, `migration idempotent: ${shape}`);
  }

  // Declarative migrations: replace_routing
  const legacyBlock = `- Version: 1.0.0\n- Immutable ref: \`aaaa\`\nFor the exact ordinary-text message \`go\`, use the pinned Handoff Go skill above.\nLoad this block.`;
  const routeManifest = {
    version: 1,
    operations: [
      {
        type: "replace_routing",
        match: "For the exact ordinary-text message `go`, use the pinned Handoff Go skill above.",
        replace:
          "For the exact ordinary-text messages `go` and `go update`, use the pinned Handoff Go skill above (`go update` is maintenance only, never workflow state).",
      },
    ],
  };
  const migratedRoute = applyDeclarativeMigrations(legacyBlock, routeManifest);
  assert.equal(migratedRoute.includes("For the exact ordinary-text messages `go` and `go update`"), true);
  assert.equal(applyDeclarativeMigrations(migratedRoute, routeManifest), migratedRoute);

  // Declarative migrations: set_field and delete_field on schema fields
  const fieldManifest = {
    version: 1,
    operations: [
      { type: "set_field", field: "Version", value: "2.0.0" },
      { type: "delete_field", field: "Pre-release" },
    ],
  };
  const blockWithPre = `- Version: \`1.0.0\`\n- Pre-release: dogfood\n- Immutable ref: \`aaaa\`\n- Owner: \`@old-owner\`\n`;
  const migratedFields = applyDeclarativeMigrations(blockWithPre, fieldManifest);
  assert.equal(migratedFields.includes("- Version: `2.0.0`"), true);
  assert.equal(migratedFields.includes("Pre-release"), false);
  assert.equal(migratedFields.includes("- Owner: `@old-owner`"), true);

  // Protected authority and provenance fields
  for (const f of ["Owner", "Skill", "Trusted default branch", "Architect", "Coder", "Immutable ref"]) {
    assert.throws(
      () => applyDeclarativeMigrations(legacyBlock, { version: 1, operations: [{ type: "set_field", field: f, value: "hacked" }] }),
      /disallowed or unknown managed field/,
    );
    assert.throws(
      () => applyDeclarativeMigrations(legacyBlock, { version: 1, operations: [{ type: "delete_field", field: f }] }),
      /disallowed or unknown managed field/,
    );
  }

  // Newline injection rejection
  assert.throws(
    () =>
      applyDeclarativeMigrations(legacyBlock, {
        version: 1,
        operations: [
          {
            type: "replace_routing",
            match: "For the exact ordinary-text message `go`, use the pinned Handoff Go skill above.",
            replace: "For the exact ordinary-text messages `go` and `go update`...\n- Owner: @hacker",
          },
        ],
      }),
    /must be a single-line string/,
  );
  assert.throws(
    () =>
      applyDeclarativeMigrations(legacyBlock, {
        version: 1,
        operations: [{ type: "set_field", field: "Version", value: "2.0.0\n- Owner: @hacker" }],
      }),
    /must be a single-line string/,
  );

  // Missing routing declaration fails closed
  assert.throws(
    () => applyDeclarativeMigrations(`- Version: \`1.0.0\`\n- Immutable ref: \`aaaa\`\nLoad this block.`, routeManifest),
    /missing ordinary command routing declaration/,
  );

  // Disallowed migration schema rules
  assert.throws(() => applyDeclarativeMigrations(legacyBlock, { version: 2, operations: [] }), /unsupported migration schema version/);
  assert.throws(() => applyDeclarativeMigrations(legacyBlock, { version: 1, operations: [{ type: "run_shell" }] }), /unrecognized migration operation type/);
  assert.throws(() => applyDeclarativeMigrations(legacyBlock, { version: 1, operations: [{ type: "set_field", field: "Unknown", value: "x" }] }), /disallowed or unknown managed field/);
  assert.throws(() => applyDeclarativeMigrations(legacyBlock, { version: 1, operations: [{ type: "delete_field", field: "Unknown" }] }), /disallowed or unknown managed field/);

  // Malformed managed blocks fail closed
  assert.throws(() => parseManagedBlock("no block here"), /not opted in/);
  assert.throws(() => parseManagedBlock(agents + agents), /exactly one managed block/);
  assert.throws(() => parseManagedBlock(agents.replace(/- Skill:.*/, "- Skill: `a/SKILL.md`\n- Skill: `b/SKILL.md`")), /exactly one Skill/);
  assert.throws(() => parseManagedBlock(agents.replace(/- Immutable ref:.*/, "- Immutable ref: `main`")), /floating governance ref/);
  assert.throws(() => updateManagedBlock(agents, { ref: "main" }), /immutable commit/);

  // Resolve trusted checks
  const repoAbs = "/tmp/consumer";
  const good = resolveTrusted({ agentsText: agents, resolvedBranch: "main", repoAbs });
  assert.equal(good.oldRef.startsWith("aaaa"), true);
  assert.equal(good.skillDirRel, "skills/handoff-go");
  assert.equal(good.trustedBranch, "main");

  assert.throws(
    () => resolveTrusted({ agentsText: agents.replace("- Skill: `skills/handoff-go/SKILL.md`", "- Skill: `SKILL.md`"), resolvedBranch: "main", repoAbs }),
    /resolves to the repository root/,
  );
  assert.throws(
    () => resolveTrusted({ agentsText: agents.replace("- Skill: `skills/handoff-go/SKILL.md`", "- Skill: `./SKILL.md`"), resolvedBranch: "main", repoAbs }),
    /resolves to the repository root/,
  );
  assert.throws(
    () => resolveTrusted({ agentsText: agents.replace("- Skill: `skills/handoff-go/SKILL.md`", "- Skill: `sub/../../escape/SKILL.md`"), resolvedBranch: "main", repoAbs }),
    /escaping Skill path/,
  );
  assert.throws(
    () => resolveTrusted({ agentsText: "no managed block", resolvedBranch: "main", repoAbs }),
    /not opted in/,
  );

  // Materialize pinned revalidation
  assert.throws(() => materializePinned("main", []), /floating ref is not executable authority|floating ref executable authority/);
  assert.throws(() => materializePinned("v1 --upload-pack=x", []), /malformed Handoff Go ref/);
}

{
  // report() terminal outcome format and stop boundary invariants (AC-9)
  const captured = [];
  const realLog = console.log;
  console.log = (line) => captured.push(String(line));
  try {
    report({
      result: "PREPARED",
      oldRef: "a".repeat(40),
      newRef: "b".repeat(40),
      proposalBranch: `handoff-go/update-${"b".repeat(8)}`,
      changedPaths: ["AGENTS.md"],
      transitions: { insideUpdater: 4 },
    });
    report(
      {
        result: "PREPARED",
        oldRef: "a".repeat(40),
        newRef: "b".repeat(40),
        proposalBranch: `handoff-go/update-${"b".repeat(8)}`,
        changedPaths: ["AGENTS.md"],
        transitions: { insideUpdater: 4 },
      },
      { verbose: true },
    );
    report({
      result: "REUSE",
      oldRef: "a".repeat(40),
      newRef: "b".repeat(40),
      existingProposal: { url: "https://example.invalid/pr/1" },
    });
    report({ result: "UP_TO_DATE", oldRef: "a".repeat(40) });
    report(
      { result: "UP_TO_DATE", oldRef: "a".repeat(40), provenance: { repository: "o/r" }, transitions: { insideUpdater: 2 } },
      { verbose: true },
    );
  } finally {
    console.log = realLog;
  }
  assert.equal(captured[0].split("\n")[0].startsWith("PREPARED"), true, "prepared report is not a protocol state");
  assert.equal(captured[0].includes("Changed:"), false, "quiet prepared report omits Changed paths");
  assert.equal(captured[0].includes("Transitions inside updater:"), false, "quiet prepared report omits Transitions");
  assert.equal(captured[1].includes("Changed: AGENTS.md"), true, "verbose prepared report includes Changed paths");
  assert.equal(captured[1].includes("Transitions inside updater: 4"), true, "verbose prepared report includes Transitions");
  assert.equal(captured[2].split("\n")[0], "GO_UPDATE_READY", "reuse reports the standard outcome");
  assert.equal(captured[2].includes("Old ref: aaaaaaaa"), true, "reuse reports short old ref by default");
  assert.equal(captured[2].includes("PR: https://example.invalid/pr/1"), true, "reuse reports the durable PR");
  assert.equal(captured[0].includes("Do NOT clean up old branches"), true, "prepared instructions include maintenance stop boundary");
  assert.equal(captured[0].includes("Emit every terminal outcome verbatim"), true, "prepared instructions require verbatim outcome emission");
  assert.equal(captured[2].includes("Next Actor: ARCHITECT"), true, "reuse routes to the Architect");
  assert.equal(captured[3], `GO_UP_TO_DATE\nCurrent ref: ${"a".repeat(8)}`, "quiet up-to-date output matches target format");
  assert.equal(
    captured[4].includes(`Current ref: ${"a".repeat(40)}`) && captured[4].includes("Provenance:"),
    true,
    "verbose up-to-date output includes diagnostic fields",
  );
}

// --------------------------------------------------------------------------
// 2b. Repository identity resolution across SSH host aliases (issue #35)
// --------------------------------------------------------------------------

{
  // AC-1: standard SSH origin resolves exactly as before — direct host match,
  // no identity effects beyond reading the remote.
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      originUrl: "git@github.com:ee-/handoff-go.git",
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: env.populateWorktree,
    });
    const ev = prepare({ repoDir: env.repoDir, io: fake });
    assert.equal(ev.result, "PREPARED");
    assert.equal(ev.provenance.repository, "ee-/handoff-go", "canonical identity from standard SSH origin");
    assert.equal(fake.calls.filter((t) => t.type === "ssh").length, 0, "direct github.com SSH does not consult ssh config");
    assert.equal(fake.calls.filter((c) => c.type === "git" && c.args[0] === "config").length, 0, "direct match does not probe transports");
  } finally {
    env.cleanup();
  }
}
{
  // AC-2/AC-7: generic SSH `Host` alias — the alias string alone never passes;
  // identity resolves because the transport's own ssh endpoint resolves to
  // github.com. Normal trusted discovery and proposal flow then continue.
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      originUrl: "git@gh-work:acme/widgets.git",
      sshResolvedHost: "github.com",
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: env.populateWorktree,
    });
    const ev = prepare({ repoDir: env.repoDir, io: fake });
    assert.equal(ev.result, "PREPARED", "alias-shaped origin no longer fails identity resolution");
    assert.equal(ev.provenance.repository, "acme/widgets");
    const gh = fake.calls.find((c) => c.type === "gh");
    assert.ok(gh.args.includes("owner=acme") && gh.args.includes("name=widgets"), "discovery queries the alias's canonical repo");
    const sshCall = fake.calls.find((c) => c.type === "ssh");
    assert.deepEqual(sshCall.args, ["gh-work"], "the alias itself, not github.com, is what ssh resolves");
  } finally {
    env.cleanup();
  }
}

{
  // AC-3: arbitrary SSH hosts fail closed BEFORE any GitHub discovery or
  // mutation; the error names the concrete remediation (AC-4).
  for (const [label, opts] of [
    ["host resolves elsewhere", { originUrl: "git@corp-git.invalid:acme/widgets.git", sshResolvedHost: "gitlab.example" }],
    ["host does not resolve at all", { originUrl: "git@corp-git.invalid:acme/widgets.git", sshError: new Error("ssh: Could not resolve hostname") }],
    ["ssh client emits no hostname", { originUrl: "git@corp-git.invalid:acme/widgets.git" }],
    ["non-git ssh user", { originUrl: "deploy@gh-work:acme/widgets.git", sshResolvedHost: "github.com" }],
    ["not an ssh form", { originUrl: "/srv/local-checkout", sshResolvedHost: "github.com" }],
  ]) {
    const env = setupEnvironment();
    const fake = createRecordingFakeIO({ ...opts, oldSkillDir: env.oldSkillDir, newSkillDir: env.newSkillDir });
    try {
      assert.throws(
        () => prepare({ repoDir: env.repoDir, io: fake }),
        (e) => {
          assert.equal(e.code, "GO_UPDATE_ERROR", label);
          assert.match(e.message, /cannot derive a GitHub owner\/name/, label);
          assert.match(e.message, /GH_REPO=owner\/name/, `${label}: remediation is concrete`);
          return true;
        },
        label,
      );
      assert.equal(fake.calls.some((c) => c.type === "gh"), false, `${label}: no GitHub discovery`);
      assert.equal(fake.calls.some((c) => c.args?.includes("worktree")), false, `${label}: no mutation effects`);
    } finally {
      env.cleanup();
    }
  }
}

{
  // AC-3 (review blocker): the standard fast path recognizes only the EXACT
  // GitHub host — hosts that merely contain "github.com" must not shortcut it.
  // The SSH negative must fall through INTO the bounded alias proof (ssh is
  // consulted for the foreign host, then fails closed), never return identity.
  const envA = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      originUrl: "git@evilgithub.com:acme/widgets.git",
      oldSkillDir: envA.oldSkillDir,
      newSkillDir: envA.newSkillDir,
    });
    assert.throws(
      () => prepare({ repoDir: envA.repoDir, io: fake }),
      (e) => {
        assert.equal(e.code, "GO_UPDATE_ERROR");
        assert.match(e.message, /cannot derive a GitHub owner\/name/);
        return true;
      },
      "evilgithub.com SSH is not the GitHub fast path",
    );
    const sshCall = fake.calls.find((c) => c.type === "ssh");
    assert.ok(sshCall && sshCall.args[0] === "evilgithub.com", "fell through to the alias proof, which then failed closed");
    assert.equal(fake.calls.some((c) => c.type === "gh"), false, "no GitHub discovery");
  } finally {
    envA.cleanup();
  }
  // HTTPS equivalents with substring hosts must not match the anchored https
  // form either; they are not sshEndpoint forms, so identity fails directly.
  for (const bad of [
    "https://evilgithub.com/acme/widgets.git",
    "https://github.com.evil.invalid/acme/widgets.git",
    "ssh://git@evil-github.com:22/acme/widgets.git",
  ]) {
    const env = setupEnvironment();
    try {
      const fake = createRecordingFakeIO({ originUrl: bad, oldSkillDir: env.oldSkillDir, newSkillDir: env.newSkillDir });
      assert.throws(() => prepare({ repoDir: env.repoDir, io: fake }), /cannot derive a GitHub owner\/name/, bad);
      assert.equal(fake.calls.some((c) => c.type === "gh"), false, `${bad}: no GitHub discovery`);
    } finally {
      env.cleanup();
    }
  }
  // Standard positive regressions still short-circuit with zero extra effects.
  for (const [ok, origin] of [
    ["https", "https://github.com/ee-/handoff-go.git"],
    ["https userinfo", "https://oauth2@github.com/ee-/handoff-go.git"],
    ["ssh scp", "git@github.com:ee-/handoff-go.git"],
    ["ssh url", "ssh://git@github.com/ee-/handoff-go.git"],
    ["ssh.github.com", "git@ssh.github.com:ee-/handoff-go.git"],
  ]) {
    const env = setupEnvironment();
    try {
      const fake = createRecordingFakeIO({
        originUrl: origin,
        oldSkillDir: env.oldSkillDir,
        newSkillDir: env.newSkillDir,
        populateWorktree: env.populateWorktree,
      });
      const ev = prepare({ repoDir: env.repoDir, io: fake });
      assert.equal(ev.provenance.repository, "ee-/handoff-go", `${ok} fast path preserved`);
      assert.equal(fake.calls.filter((c) => c.type === "ssh").length, 0, `${ok}: no ssh consultation`);
      assert.equal(fake.calls.filter((c) => c.type === "git" && c.args[0] === "config").length, 0, `${ok}: no transport probes`);
    } finally {
      env.cleanup();
    }
  }
}

{
  // BLOCKER 2 guard: when git's SSH transport is not the default OpenSSH
  // client, the bare `ssh -G` proof would describe a command git never runs.
  // The alias path must fail closed — before consulting ssh at all — even
  // when the alias would otherwise resolve to github.com.
  for (const [label, extra] of [
    ["core.sshCommand", { coreSshCommand: "plink -ssh -agent" }],
    ["ssh.variant", { sshVariant: "plink" }],
    ["GIT_SSH_COMMAND env", {}],
    ["GIT_SSH env", {}],
  ]) {
    const env = setupEnvironment();
    const fake = createRecordingFakeIO({
      originUrl: "git@gh-work:acme/widgets.git",
      sshResolvedHost: "github.com", // would succeed if consulted — it must not be
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      ...extra,
    });
    try {
      if (label === "GIT_SSH_COMMAND env") process.env.GIT_SSH_COMMAND = "plink -ssh";
      if (label === "GIT_SSH env") process.env.GIT_SSH = "/usr/bin/plink";
      assert.throws(
        () => prepare({ repoDir: env.repoDir, io: fake }),
        (e) => {
          assert.equal(e.code, "GO_UPDATE_ERROR", label);
          assert.match(e.message, /cannot derive a GitHub owner\/name/, label);
          assert.match(e.message, /GH_REPO=owner\/name/, label);
          return true;
        },
        label,
      );
      assert.equal(fake.calls.some((c) => c.type === "ssh"), false, `${label}: ssh -G never consulted under an alternate transport`);
      assert.equal(fake.calls.some((c) => c.type === "gh"), false, `${label}: no GitHub discovery`);
    } finally {
      delete process.env.GIT_SSH_COMMAND;
      delete process.env.GIT_SSH;
      env.cleanup();
    }
  }
}
{
  // Review blocker (AC-3): an ABNORMAL config-probe failure is not proof of
  // "no alternate transport". Only the silent exit-1 absent answer may pass;
  // fatal/unreadable results must fail closed BEFORE ssh -G, gh, or mutation —
  // even when the alias would otherwise resolve to github.com.
  for (const [label, opts] of [
    ["exit 1 + fatal stderr (bad config line)", { configFatal: true }],
    ["exit 128 (fatal)", { configFatal128: true }],
  ]) {
    const env = setupEnvironment();
    const fake = createRecordingFakeIO({
      originUrl: "git@gh-work:acme/widgets.git",
      sshResolvedHost: "github.com", // would succeed if consulted — it must not be
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      ...opts,
    });
    try {
      assert.throws(
        () => prepare({ repoDir: env.repoDir, io: fake }),
        (e) => {
          assert.equal(e.code, "GO_UPDATE_ERROR", label);
          assert.match(e.message, /cannot verify git's SSH transport/, label);
          assert.match(e.message, /GH_REPO=owner\/name/, `${label}: remediation concrete`);
          return true;
        },
        label,
      );
      assert.equal(fake.calls.some((c) => c.type === "ssh"), false, `${label}: ssh -G not consulted`);
      assert.equal(fake.calls.some((c) => c.type === "gh"), false, `${label}: no GitHub discovery`);
      assert.equal(fake.calls.some((c) => c.args?.includes("worktree")), false, `${label}: no mutation`);
    } finally {
      env.cleanup();
    }
  }
  // Contrast: the ordinary silent absent-key exit still proceeds to the alias
  // proof (covered implicitly by the AC-2 happy-alias test above, which relies
  // on this same fake semantics and resolves).
}


{
  // AC-4: GH_REPO stays the explicit override — even ahead of a valid origin —
  // and an unusable one falls through to origin resolution unchanged.
  const env = setupEnvironment();
  try {
    process.env.GH_REPO = "env/override";
    try {
      const fake = createRecordingFakeIO({
        originUrl: "git@gh-work:acme/widgets.git", // unresolvable without ssh config
        oldSkillDir: env.oldSkillDir,
        newSkillDir: env.newSkillDir,
        populateWorktree: env.populateWorktree,
      });
      const ev = prepare({ repoDir: env.repoDir, io: fake });
      assert.equal(ev.result, "PREPARED");
      assert.equal(ev.provenance.repository, "env/override", "explicit override wins");
      assert.equal(fake.calls.some((c) => c.type === "ssh"), false, "override skips transport/ssh effects");
    } finally {
      delete process.env.GH_REPO;
    }
    // Malformed GH_REPO is not authority; origin path still runs.
    process.env.GH_REPO = "not-a-slug";
    try {
      const fake = createRecordingFakeIO({
        originUrl: "https://github.com/ee-/handoff-go.git",
        oldSkillDir: env.oldSkillDir,
        newSkillDir: env.newSkillDir,
        populateWorktree: env.populateWorktree,
      });
      const ev = prepare({ repoDir: env.repoDir, io: fake });
      assert.equal(ev.provenance.repository, "ee-/handoff-go", "malformed GH_REPO falls through to origin");
    } finally {
      delete process.env.GH_REPO;
    }
  } finally {
    env.cleanup();
  }
}

{
  // AC-4: missing origin is also a bounded error with the concrete remediation.
  const env = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      onGit: (dir, args) => {
        if (args[0] === "remote") {
          const err = new Error("error: No such remote 'origin'");
          throw err;
        }
      },
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
    });
    assert.throws(
      () => prepare({ repoDir: env.repoDir, io: fake }),
      (e) => {
        assert.equal(e.code, "GO_UPDATE_ERROR");
        assert.match(e.message, /no origin remote/);
        assert.match(e.message, /GH_REPO=owner\/name/);
        return true;
      },
      "missing origin names GH_REPO remediation",
    );
  } finally {
    env.cleanup();
  }
}

// --------------------------------------------------------------------------
// 2c. Harness-aware runtime materialization and OMP migration (Work Order #39)
// --------------------------------------------------------------------------

// detectHarness: OMP identity comes from the harness's own child shell env
// (OMPCODE=1), never from a `.omp/` directory or other contributor-controlled
// project state. Pi is never auto-detected (UNVERIFIED).
{
  assert.equal(detectHarness({ OMPCODE: "1" }), "omp", "OMPCODE=1 identifies OMP");
  assert.equal(detectHarness({ OMPCODE: "1", PI: "1" }), "omp", "OMP wins over any other signal");
  assert.equal(detectHarness({}), null, "no signal -> not OMP");
  assert.equal(detectHarness({ OMPCODE: "0" }), null, "OMPCODE=0 is not OMP");
  assert.equal(detectHarness({ OMPCODE: "true" }), null, "non-1 OMPCODE is not OMP");

  // HARNESS_RUNTIME must be closed to the two supported harnesses only.
  assert.deepEqual(
    Object.keys(HARNESS_RUNTIME).sort(),
    ["omp", "pi"],
    "runtime entries cover exactly OMP and Pi",
  );
}

// materializeHarnessRuntime: byte-identical, idempotent, fails closed on an
// unknown harness. Covers AC-1 (first-setup) and AC-6 (idempotence/alignment).
{
  const root = mkdtempSync(join(tmpdir(), "hg-materialize-"));
  try {
    const skillDir = join(root, "skill");
    const repoDir = join(root, "repo");
    mkdirSync(join(skillDir, "adapters"), { recursive: true });
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(skillDir, "watch.mjs"), "WATCH_CORE\n");
    writeFileSync(join(skillDir, "adapters/watch.js"), "WATCH_ADAPTER\n");

    // First setup materializes exactly the OMP pair.
    const first = materializeHarnessRuntime({ skillDir, repoDir, harness: "omp" });
    assert.deepEqual(first, [".omp/watch.mjs", ".omp/extensions/handoff-go-watch.js"], "OMP pair materialized");
    const core = readFileSync(join(repoDir, ".omp/watch.mjs"), "utf8");
    const adapter = readFileSync(join(repoDir, ".omp/extensions/handoff-go-watch.js"), "utf8");
    assert.equal(core, "WATCH_CORE\n", "core byte-identical to pinned skill");
    assert.equal(adapter, "WATCH_ADAPTER\n", "adapter byte-identical to pinned skill");

    // Re-running is idempotent: identical bytes, identical return.
    const second = materializeHarnessRuntime({ skillDir, repoDir, harness: "omp" });
    assert.deepEqual(second, first, "idempotent re-run reports the same paths");
    assert.equal(readFileSync(join(repoDir, ".omp/watch.mjs"), "utf8"), "WATCH_CORE\n", "no drift on re-run");

    // A changed pinned source is propagated (update alignment), not silently kept.
    writeFileSync(join(skillDir, "watch.mjs"), "WATCH_CORE_V2\n");
    materializeHarnessRuntime({ skillDir, repoDir, harness: "omp" });
    assert.equal(readFileSync(join(repoDir, ".omp/watch.mjs"), "utf8"), "WATCH_CORE_V2\n", "pinned update aligns runtime bytes");

    // Pi harness uses `.pi/`, never `.omp/`.
    const pi = materializeHarnessRuntime({ skillDir, repoDir, harness: "pi" });
    assert.deepEqual(pi, [".pi/watch.mjs", ".pi/extensions/handoff-go-watch.js"], "Pi pair materialized");
    assert.ok(existsSync(join(repoDir, ".omp/watch.mjs")), "OMP core still present after Pi materialization");
    assert.equal(readFileSync(join(repoDir, ".pi/watch.mjs"), "utf8"), "WATCH_CORE_V2\n", "Pi core byte-identical");

    // An unknown harness is a caller bug: fails closed, never guesses.
    assert.throws(() => materializeHarnessRuntime({ skillDir, repoDir, harness: "bogus" }), /unknown harness/);
    assert.throws(() => materializeHarnessRuntime({ skillDir, repoDir, harness: null }), /unknown harness/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// AC-4 existing-adopter migration: `prepare` with a detected OMP harness brings
// a missing `.omp/` integration setup-complete (create), while a non-OMP harness
// leaves it absent.
{
  const env = setupEnvironment();
  try {
    // Worktree WITHOUT any `.omp/` files (a pre-fix OMP consumer that never
    // manually copied, or a first adoption via an older setup).
    const populateNoOmp = (wt) => {
      mkdirSync(join(wt, "skills/handoff-go/adapters"), { recursive: true });
      writeFileSync(join(wt, "AGENTS.md"), SAMPLE_AGENTS);
      writeFileSync(join(wt, "skills/handoff-go/SKILL.md"), SKILL_FRONTMATTER);
      writeFileSync(join(wt, "skills/handoff-go/watch.mjs"), `export const version = "1.0.0";\n`);
      writeFileSync(join(wt, "skills/handoff-go/adapters/watch.js"), `export default function watch() {}\n`);
      writeFileSync(join(wt, "skills/handoff-go/migrations.json"), JSON.stringify({ version: 1, operations: [] }));
    };

    // OMP detected via harness option -> missing `.omp/*` is created.
    const fake = createRecordingFakeIO({
      oldSkillDir: env.oldSkillDir,
      newSkillDir: env.newSkillDir,
      populateWorktree: populateNoOmp,
    });
    const ev = prepare({ repoDir: env.repoDir, io: fake, harness: "omp" });
    assert.deepEqual(ev.runtime.created, [".omp/watch.mjs", ".omp/extensions/handoff-go-watch.js"], "OMP missing integration created");
    // OMP is detected; only the undetected Pi entries stay absent (fail closed).
    assert.deepEqual(ev.runtime.absent, [".pi/watch.mjs", ".pi/extensions/handoff-go-watch.js"], "Pi entries stay absent when only OMP detected");
    assert.equal(ev.runtime.refreshed.length, 0, "nothing present to refresh");
    assert.equal(ev.result, "PREPARED", "migration produces a prepared proposal");
  } finally {
    env.cleanup();
  }

  // Non-OMP / ambiguous harness: absent `.omp/*` stays absent (AC-5).
  const env2 = setupEnvironment();
  try {
    const fake = createRecordingFakeIO({
      oldSkillDir: env2.oldSkillDir,
      newSkillDir: env2.newSkillDir,
      populateWorktree: (wt) => {
        mkdirSync(join(wt, "skills/handoff-go/adapters"), { recursive: true });
        writeFileSync(join(wt, "AGENTS.md"), SAMPLE_AGENTS);
        writeFileSync(join(wt, "skills/handoff-go/SKILL.md"), SKILL_FRONTMATTER);
        writeFileSync(join(wt, "skills/handoff-go/watch.mjs"), `export const version = "1.0.0";\n`);
        writeFileSync(join(wt, "skills/handoff-go/adapters/watch.js"), `export default function watch() {}\n`);
        writeFileSync(join(wt, "skills/handoff-go/migrations.json"), JSON.stringify({ version: 1, operations: [] }));
      },
    });
    // No harness option and the test process is not OMP -> null harness.
    const ev = prepare({ repoDir: env2.repoDir, io: fake });
    assert.deepEqual(ev.runtime.created, [], "non-OMP harness creates nothing");
    assert.deepEqual(ev.runtime.refreshed, [], "nothing present to refresh");
    assert.ok(ev.runtime.absent.includes(".omp/watch.mjs"), ".omp entry stays absent when harness unknown");
  } finally {
    env2.cleanup();
  }
}

// --------------------------------------------------------------------------
// 3. Production adapter verification
// --------------------------------------------------------------------------

{
  assert.equal(typeof productionIO.git, "function", "productionIO provides git");
  assert.equal(typeof productionIO.gh, "function", "productionIO provides gh");
  assert.equal(typeof productionIO.extractSkill, "function", "productionIO provides extractSkill");
}

console.log("update transaction tests: PASS");
