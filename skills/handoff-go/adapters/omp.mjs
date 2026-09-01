// Handoff Go Coder watch — OMP / Oh My Pi adapter (reference implementation).
//
// OMP loads this as a project-local extension from `.omp/extensions/`. The
// `input` event carries `text`/`source` on the event (not the ctx). Recognized
// `go watch` commands return `{ handled: true }` so the original text is
// consumed; extension-injected WATCH_TICK_PROMPT wakes return nothing and
// continue normally. Uses the managed ctx timer (context-local) and follow-up
// delivery; no `session_stop` loop.
import { parseInterval, WATCH_DEFAULT_SECONDS, WATCH_TICK_PROMPT } from "../watch.mjs";

const GO_WATCH_STOP = /^go\s+watch\s+stop$/i;
const GO_WATCH_START = /^go\s+watch(?:\s+(\S+))?$/i;

export default function handoffGoWatch(pi) {
  let active = false;
  let intervalSeconds = WATCH_DEFAULT_SECONDS;
  let timerId = null;
  let pending = false;
  let sessionCtx = null;

  function clearTimer() {
    if (timerId != null) {
      sessionCtx?.clearTimer?.(timerId); // managed timers are context-local
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

  // The managed timer does not inject ctx; close over the session ctx.
  function onTick() {
    if (!active) return;
    if (sessionCtx?.isIdle && !sessionCtx.isIdle()) return; // busy: coalesce, no overlap
    if (pending) return;                                   // at most one pending wake
    sendTick();
  }

  function start(text, ctx) {
    const m = GO_WATCH_START.exec(text);
    const seconds = m ? parseInterval(m[1]) : null;
    if (m && seconds === null) {
      ctx.ui?.notify?.("Handoff Go watch: interval must be >= 60s (e.g. 60s, 1m, 5m, 1h)", "warn");
      return { handled: true };
    }
    active = true;
    intervalSeconds = seconds ?? WATCH_DEFAULT_SECONDS;
    sessionCtx = ctx;
    clearTimer();
    timerId = ctx.setInterval(onTick, intervalSeconds * 1000);
    ctx.ui?.notify?.(`Handoff Go watch: ${intervalSeconds / 60}m`, "info");
    sendTick(); // immediate first discovery before the first wait
    return { handled: true };
  }

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return; // injected wake: continue normally
    const text = String(event.text || "").trim();
    if (GO_WATCH_STOP.test(text)) {
      active = false;
      clearTimer();
      ctx.ui?.notify?.("Handoff Go watch stopped", "info");
      return { handled: true };
    }
    if (GO_WATCH_START.test(text)) return start(text, ctx);
  });

  pi.on("session_shutdown", () => { clearTimer(); active = false; });
}
