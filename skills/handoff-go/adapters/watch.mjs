// Handoff Go Coder watch — Universal extension adapter for OMP and Pi.
//
// Auto-detects managed vs raw timer environments:
//   - Managed host (OMP): uses `ctx.setInterval` and `ctx.clearTimer`.
//   - Fallback host (Pi): uses raw `setInterval` and `clearInterval`.
//
// Recognizes `go watch` commands using the shared `parseWatchCommand` parser.
// Injected wakes (`source === "extension"`) are bypassed to prevent recursion.
// Recognized commands return `{ handled: true, action: "handled" }` so OMP
// inspects `handled` and Pi inspects `action`.
import { parseWatchCommand, WATCH_DEFAULT_SECONDS, WATCH_TICK_PROMPT } from "../watch.mjs";

export default function handoffGoWatch(pi) {
  let active = false;
  let intervalSeconds = WATCH_DEFAULT_SECONDS;
  let timerId = null;
  let pending = false;
  let sessionCtx = null;

  function clearTimer() {
    if (timerId != null) {
      if (sessionCtx?.clearTimer) sessionCtx.clearTimer(timerId);
      else clearInterval(timerId);
      timerId = null;
    }
  }

  function sendTick() {
    if (pending) return;
    pending = true;
    Promise.resolve(
      pi.sendMessage(
        { content: WATCH_TICK_PROMPT, display: true, attribution: "user" },
        { triggerTurn: true, deliverAs: "followUp" }
      )
    ).finally(() => { pending = false; });
  }

  function onTick() {
    if (!active) return;
    if (sessionCtx?.isIdle && !sessionCtx.isIdle()) return; // busy: coalesce, no overlap
    if (pending) return;                                   // at most one pending wake
    sendTick();
  }

  function start(seconds, ctx) {
    active = true;
    intervalSeconds = seconds;
    sessionCtx = ctx;
    clearTimer();
    if (ctx?.setInterval) {
      timerId = ctx.setInterval(onTick, intervalSeconds * 1000);
    } else {
      timerId = setInterval(() => {
        try { onTick(); } catch (e) { console.error("go watch tick failed", e); }
      }, intervalSeconds * 1000);
    }
    ctx.ui?.notify?.(`Handoff Go watch: ${intervalSeconds / 60}m`, "info");
    sendTick(); // immediate first discovery before the first wait
    return { handled: true, action: "handled" };
  }

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return; // injected wake: continue normally

    const cmd = parseWatchCommand(event.text);
    if (cmd.kind === "stop") {
      active = false;
      clearTimer();
      ctx.ui?.notify?.("Handoff Go watch stopped", "info");
      return { handled: true, action: "handled" };
    }
    if (cmd.invalid) {
      ctx.ui?.notify?.("Handoff Go watch: interval must be >= 60s (e.g. 60s, 1m, 5m, 1h)", "warn");
      return { handled: true, action: "handled" };
    }
    if (cmd.kind === "start") {
      return start(cmd.intervalSeconds, ctx);
    }
  });

  pi.on("session_shutdown", () => { clearTimer(); active = false; });
}
