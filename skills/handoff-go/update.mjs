// Deterministic Handoff Go managed-bootstrap helpers — dependency-free.
//
// The single mechanical part of `go update` that is uniquely defined and
// error-prone by hand: locating the one managed AGENTS.md block and rewriting
// ONLY its pin fields while preserving every other byte (including everything
// outside the block). Role, routing, authority, drift judgment, and the update
// procedure itself live in adoption.md — never here.

const START = "<!-- handoff-go:start -->";
const END = "<!-- handoff-go:end -->";

function conflicts(detail) {
  const err = new Error(`GO_UPDATE_CONFLICT: ${detail}`);
  err.code = "GO_UPDATE_CONFLICT";
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

  return { skillPath, immutableRef, version: versions[0] || null };
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

// One runnable check for the non-trivial block rewrite (ponytail).
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

  console.log("update core: PASS");
}

if (import.meta.url === `file://${process.argv[1]}`) demo();
