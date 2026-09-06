// Deterministic Handoff Go first-time adoption proof — dependency-free
// (git plus the `skills` CLI that adoption already requires).
//
// Script = mechanism, not policy. This module does ONLY what is necessary
// before the pinned skill becomes authoritative:
//   1. discover the actual project-local install path from the installer's own
//      machine-readable state (the Coder never guesses an agent directory);
//   2. resolve the fixed trusted upstream to exactly one immutable commit;
//   3. materialize that commit's skill tree from the content-addressed object
//      store and byte-compare it with the installed tree.
// Installed bytes and the emitted immutable ref therefore describe the same
// upstream revision, or the proof fails closed.
//
// It writes nothing, resolves no roles, parses no AGENTS.md, and implements no
// workflow semantics. The canonical pinned setup (references/adoption.md)
// consumes this output and owns the managed block.

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Same trusted constant as the updater: project or contributor content can
// never redirect the provenance source.
import { UPSTREAM, diffTree, materializePinned } from "./update.mjs";

function conflict(remediation) {
  const err = new Error(`GO_BOOTSTRAP_CONFLICT: ${remediation}`);
  err.code = "GO_BOOTSTRAP_CONFLICT";
  return err;
}

// The only effects the proof needs, so every fail-closed branch is testable
// without network or a real installer.
export const productionIO = {
  list(repoDir) {
    return execFileSync("npx", ["--yes", "skills", "ls", "--json"], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  },
  remoteHeads() {
    return execFileSync("git", ["ls-remote", UPSTREAM, "HEAD"], { encoding: "utf8" });
  },
  materialize(ref, tmps) {
    return materializePinned(ref, tmps);
  },
  show(store, rev) {
    return execFileSync("git", ["-C", store, "show", rev], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  },
};

// Locate the one project-local handoff-go install from the installer's own
// machine-readable listing, so the skill path is never guessed.
function discoverInstall(repoDir, io) {
  let entries;
  try {
    entries = JSON.parse(io.list(repoDir));
  } catch {
    throw conflict(
      "cannot read the installer's project skill listing; install with `npx skills add ee-/handoff-go` and prove again",
    );
  }
  if (!Array.isArray(entries)) {
    throw conflict("the installer's skill listing is not a list; re-run `npx skills add ee-/handoff-go`");
  }
  const found = entries.filter((e) => e && e.name === "handoff-go" && e.scope === "project");
  if (found.length === 0) {
    throw conflict("no project-local Handoff Go install found; run `npx skills add ee-/handoff-go` in this repository");
  }
  if (found.length > 1) {
    throw conflict(
      `multiple project-local Handoff Go installs found (${found.map((e) => e.path).join(", ")}); keep exactly one and prove again`,
    );
  }
  const installed = resolve(String(found[0].path));
  if (!existsSync(join(installed, "SKILL.md"))) {
    throw conflict(`the installed skill has no SKILL.md: ${installed}; re-run \`npx skills add ee-/handoff-go\``);
  }
  return installed;
}

// The proof. A HEAD that moved between install and prove shows up as a byte
// drift conflict; the caller re-installs once and proves again.
export function prove({ repoDir = process.cwd(), io = productionIO } = {}) {
  // Canonicalize both sides with realpath: the installer may report either
  // form, and on hosts where paths sit under a symlinked mount (macOS
  // `/tmp` -> `/private/tmp`) a raw `relative()` would falsely escape the repo.
  repoDir = realpathSync(resolve(repoDir));
  const installed = realpathSync(discoverInstall(repoDir, io));

  const heads = [...new Set(
    io.remoteHeads()
      .split("\n")
      .map((line) => line.split("\t")[0].trim())
      .filter(Boolean),
  )];
  if (heads.length !== 1) {
    throw conflict(`the trusted upstream HEAD is not exactly one commit (saw: ${heads.join(", ") || "none"})`);
  }
  const commit = heads[0];
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw conflict(`the trusted upstream HEAD is not a full commit SHA: ${commit}`);
  }

  const tmps = [];
  try {
    const { skillDir, store } = io.materialize(commit, tmps);
    const drift = diffTree(installed, skillDir);
    if (drift.length > 0) {
      throw conflict(
        `installed bytes do not match upstream ${commit.slice(0, 8)} (${drift.join(", ")}); re-run \`npx skills add ee-/handoff-go\` and prove again`,
      );
    }
    // VERSION lives outside the distributable skill tree, so read it from the
    // same immutable commit whose bytes the comparison just proved.
    const version = io.show(store, `${commit}:VERSION`);
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
      throw conflict(`upstream ${commit.slice(0, 8)} carries no valid VERSION: ${version || "(empty)"}`);
    }
    const skillPath = relative(repoDir, join(installed, "SKILL.md")).split(/[\\/]+/).join("/");
    if (!skillPath || skillPath.startsWith("../") || skillPath.startsWith("/")) {
      throw conflict(`the install path is outside the repository (${skillPath}); install project-locally with \`npx skills add ee-/handoff-go\``);
    }
    return { immutableRef: commit, skillPath, version };
  } finally {
    for (const dir of tmps) rmSync(dir, { recursive: true, force: true });
  }
}

// Compare realpath forms: on hosts whose temporary directory is a symlink
// (macOS `/var` -> `/private/var`), a plain `file://` match never succeeds and
// the CLI would load and exit silently.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== "prove") {
    console.error("usage: node bootstrap.mjs prove [--repo-dir DIR] [--json]");
    process.exit(2);
  }
  const flagIndex = rest.indexOf("--repo-dir");
  const repoDir = resolve(flagIndex === -1 ? process.cwd() : rest[flagIndex + 1]);
  try {
    const ev = prove({ repoDir });
    if (rest.includes("--json")) {
      console.log(JSON.stringify(ev, null, 2));
    } else {
      console.log(
        `GO_BOOTSTRAP_PROVEN\nImmutable ref: \`${ev.immutableRef}\`\nSkill: \`${ev.skillPath}\`\nVersion: ${ev.version}`,
      );
    }
  } catch (e) {
    const code = e.code || "GO_BOOTSTRAP_ERROR";
    console.error(`${code}\n${String(e.message).replace(`${code}: `, "")}`);
    process.exit(e.code ? 1 : 2);
  }
}
