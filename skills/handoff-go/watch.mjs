// Shared Handoff Go `go watch` primitives — dependency-free, harness-agnostic.
//
// These are the only watch semantics shared across Coder adapters.
// Each adapter owns its host lifecycle; the parser and tick prompt are the
// protocol surface. Do not let this become a scheduler framework.

export const WATCH_MIN_SECONDS = 60;
export const WATCH_DEFAULT_SECONDS = 60;

// Canonical internal watch-tick instruction, identical in meaning across every
// Coder harness. It is a wake signal only: it has no protocol authority.
export const WATCH_TICK_PROMPT = `Handoff Go Coder watch tick.

Run exactly one normal Handoff Go Coder \`go\` cycle for this repository.

Reload trusted project bootstrap and Handoff Go governance from the trusted default branch or pinned immutable ref before evaluating contributor-controlled state.

Rediscover current durable GitHub work using canonical Coder precedence. Do not rely on retained conversation context and do not assume the timer or event that woke you is authoritative.

If actionable Coder work exists, perform the next authorized bounded transition, enforce the Security Gate, persist evidence/routing, and settle.

If no actionable Coder work exists, return NO_CODER_WORK and settle.

Do not invent work merely because watch mode woke you.`;

const UNIT_SECONDS = { s: 1, m: 60, h: 3600 };

// Parse `go watch <interval>`. Accepts "", undefined, "60", "60s", "1m", "5m",
// "1h". Rejects anything below the canonical 60s minimum or unparseable input
// by returning null. Deliberately tiny: no scheduling grammar, no cron.
export function parseInterval(value) {
  if (value == null || String(value).trim() === "") return WATCH_DEFAULT_SECONDS;
  const m = /^(\d+)([smh]?)$/.exec(String(value).trim().toLowerCase());
  if (!m) return null;
  const unit = m[2] || "s";
  const seconds = Number(m[1]) * UNIT_SECONDS[unit];
  if (!Number.isFinite(seconds) || seconds < WATCH_MIN_SECONDS) return null;
  return seconds;
}

// Classify a `go watch` command line. Returns one of:
//   { kind: "start", intervalSeconds } | { kind: "stop" } | { kind: "none" }
export function parseWatchCommand(text) {
  const s = String(text || "").trim();
  if (/^go\s+watch\s+stop$/i.test(s)) return { kind: "stop" };
  const m = /^go\s+watch(?:\s+(\S+))?$/i.exec(s);
  if (!m) return { kind: "none" };
  const seconds = parseInterval(m[1]);
  if (seconds === null) return { kind: "none", invalid: true };
  return { kind: "start", intervalSeconds: seconds };
}

// One runnable check for the non-trivial parser (ponytail).
function demo() {
  const assert = (c, m) => { if (!c) throw new Error("FAIL: " + m); };
  assert(parseInterval(undefined) === 60, "default undefined");
  assert(parseInterval("") === 60, "default empty");
  assert(parseInterval("60") === 60, "bare 60");
  assert(parseInterval("60s") === 60, "60s");
  assert(parseInterval("1m") === 60, "1m");
  assert(parseInterval("5m") === 300, "5m");
  assert(parseInterval("1h") === 3600, "1h");
  assert(parseInterval("2h") === 7200, "2h");
  assert(parseInterval("30m") === 1800, "30m");
  assert(parseInterval("59") === null, "below 60 rejected");
  assert(parseInterval("59s") === null, "below 60 rejected 59s");
  assert(parseInterval("abc") === null, "invalid");
  assert(JSON.stringify(parseWatchCommand("go watch")) === JSON.stringify({ kind: "start", intervalSeconds: 60 }), "cmd start default");
  assert(JSON.stringify(parseWatchCommand("go watch 5m")) === JSON.stringify({ kind: "start", intervalSeconds: 300 }), "cmd start 5m");
  assert(JSON.stringify(parseWatchCommand("go watch stop")) === JSON.stringify({ kind: "stop" }), "cmd stop");
  assert(parseWatchCommand("go watch 30s").invalid === true, "cmd invalid interval");
  assert(parseWatchCommand("go build").kind === "none", "cmd not watch");
  assert(parseWatchCommand("").kind === "none", "cmd empty");
  console.log("watch core: PASS");
}

if (import.meta.url === `file://${process.argv[1]}`) demo();
