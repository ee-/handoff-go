// Handoff Go Coder watch conformance test (mock harness, no LLM).
// Run: node tests/watch.test.mjs
import assert from "node:assert/strict";
import { parseInterval, parseWatchCommand, WATCH_DEFAULT_SECONDS, WATCH_TICK_PROMPT } from "../skills/handoff-go/watch.mjs";
import ompAdapter from "../skills/handoff-go/adapters/omp.mjs";
import piAdapter from "../skills/handoff-go/adapters/pi.mjs";

function makePi() {
  const handlers = {};
  const sent = [];
  const cleared = [];
  let now = 0;
  const api = {
    on(event, h) { (handlers[event] ??= []).push(h); },
    sendMessage(msg, opts) { sent.push({ msg, opts }); return Promise.resolve(); },
    clearTimer(id) { cleared.push(id); },
    _handlers: handlers,
    _sent: sent,
    _cleared: cleared,
    _emit(event, ctx) { for (const h of handlers[event] ?? []) { const r = h({}, ctx); if (r && r.then) return r; } },
  };
  const ctx = {
    source: "interactive",
    text: "",
    isIdle: () => true,
    setInterval: (fn, ms) => { api._intervalMs = ms; api._intervalFn = fn; return 7; },
    clearTimer: (id) => cleared.push(id),
    ui: { notify: () => {} },
  };
  return { api, ctx };
}

function run(adapter, input, ctxAdjust) {
  const { api, ctx } = makePi();
  if (ctxAdjust) ctxAdjust(ctx);
  adapter(api);
  // emit session_start, then the input, then session_shutdown
  api._emit("session_start", ctx);
  ctx.text = input;
  api._emit("input", ctx);
  api._emit("session_shutdown", ctx);
  return { api, ctx };
}

// --- shared core ---
assert.equal(parseInterval(""), WATCH_DEFAULT_SECONDS, "default 60");
assert.equal(parseInterval("60s"), 60);
assert.equal(parseInterval("1m"), 60);
assert.equal(parseInterval("5m"), 300);
assert.equal(parseInterval("1h"), 3600);
assert.equal(parseInterval("30s"), null, "below 60 rejected");
assert.equal(parseInterval("59"), null, "below 60 rejected");
assert.equal(parseInterval("nonsense"), null, "invalid");
assert.deepEqual(parseWatchCommand("go watch"), { kind: "start", intervalSeconds: 60 }, "start default");
assert.equal(parseWatchCommand("go watch 30s").invalid, true, "invalid interval");
assert.deepEqual(parseWatchCommand("go watch stop"), { kind: "stop" });
assert.equal(parseWatchCommand("go build").kind, "none");

for (const adapter of [ompAdapter, piAdapter]) {
  // go watch activates and injects an immediate tick (first go before first wait)
  let r = run(adapter, "go watch");
  assert.ok(r.api._sent.length >= 1, `${adapter.name}: immediate first go`);
  assert.ok(r.api._sent[0].msg.content.includes(WATCH_TICK_PROMPT.slice(0, 30)), "tick prompt injected");
  assert.equal(r.api._intervalMs, 60000, `${adapter.name}: default interval 60s`);

  // custom interval
  r = run(adapter, "go watch 5m");
  assert.equal(r.api._intervalMs, 300000, `${adapter.name}: 5m interval`);

  // below-60s does not activate
  r = run(adapter, "go watch 30s");
  assert.equal(r.api._intervalMs, undefined, `${adapter.name}: <60s not activated`);

  // injected extension wake (source==="extension") is NOT re-activated as a command
  r = run(adapter, "go watch", (c) => { c.source = "extension"; });
  assert.equal(r.api._sent.length, 0, `${adapter.name}: no recursion from injected tick`);

  // busy agent does not overlap
  r = run(adapter, "go watch");
  const before = r.api._sent.length;
  r.ctx.isIdle = () => false; // busy
  r.api._intervalFn(r.ctx);   // tick while busy
  assert.equal(r.api._sent.length, before, `${adapter.name}: busy tick does not overlap`);

  // stop clears timer (activate then stop in the same instance)
  const s = makePi();
  adapter(s.api);
  s.api._emit("session_start", s.ctx);
  s.ctx.text = "go watch";
  s.api._emit("input", s.ctx);
  const clearedBefore = s.api._cleared.length;
  s.ctx.text = "go watch stop";
  s.api._emit("input", s.ctx);
  assert.ok(s.api._cleared.length > clearedBefore, `${adapter.name}: stop clears timer`);
  // stop also clears via session_shutdown
  const t = makePi();
  adapter(t.api);
  t.api._emit("session_start", t.ctx);
  t.ctx.text = "go watch";
  t.api._emit("input", t.ctx);
  const cb2 = t.api._cleared.length;
  t.api._emit("session_shutdown", t.ctx);
  assert.ok(t.api._cleared.length > cb2, `${adapter.name}: session_shutdown clears timer`);
}

console.log("watch conformance: PASS");
