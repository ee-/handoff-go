// Handoff Go Coder watch — OMP / Oh My Pi adapter (reference implementation).
//
// OMP loads this as a project-local extension from `.omp/extensions/`. Uses the
// managed ExtensionAPI timers and follow-up delivery. Ordinary-text `go watch`
// is recognised on the `input` event; extension-injected WATCH_TICK_PROMPT wakes
// are never re-interpreted as activation commands.
import { parseInterval, WATCH_DEFAULT_SECONDS, WATCH_TICK_PROMPT } from "../watch.mjs";

const GO_WATCH_STOP = /^go\s+watch\s+stop$/i;
const GO_WATCH_START = /^go\s+watch(?:\s+(\S+))?$/i;

export default function handoffGoWatch(pi) {
  let active = false;
  let intervalSeconds = WATCH_DEFAULT_SECONDS;
  let timerId = null;
  let pending = false;

  function ensureTimer(ctx) {
    if (!active || timerId != null) return;
    timerId = ctx.setInterval(onTick, intervalSeconds * 1000);
  }

  function clearTimer() {
    if (timerId != null) {
      pi.clearTimer(timerId);
      timerId = null;
    }
  }

  function onTick(ctx) {
    if (!active) return;
    // Coalesce: if the agent is busy (or a wake is already pending), do not
    // enqueue another wake. Do not queue one wake per missed interval.
    if (ctx.isIdle && !ctx.isIdle()) { return; }
    if (pending) return;
    pending = true;
    pi.sendMessage(
      { content: WATCH_TICK_PROMPT, display: true, attribution: "user" },
      { triggerTurn: true, deliverAs: "followUp" }
    ).finally(() => { pending = false; });
  }

  pi.on("input", async (_event, ctx) => {
    // Only raw interactive/rpc input is a command; extension-injected wake
    // messages are not.
    if (ctx.source === "extension") return;

    const text = String(ctx.text || "").trim();

    if (GO_WATCH_STOP.test(text)) {
      active = false;
      clearTimer();
      ctx.ui?.notify?.("Handoff Go watch stopped", "info");
      return;
    }

    const m = GO_WATCH_START.exec(text);
    if (m) {
      const seconds = parseInterval(m[1]);
      if (seconds === null) {
        ctx.ui?.notify?.("Handoff Go watch: interval must be >= 60s (e.g. 60s, 1m, 5m, 1h)", "warn");
        return;
      }
      active = true;
      intervalSeconds = seconds;
      clearTimer();
      ensureTimer(ctx);
      ctx.ui?.notify?.(`Handoff Go watch: ${seconds / 60}m`, "info");
      // Immediate first discovery before the first wait (no waiting one minute).
      pi.sendMessage(
        { content: WATCH_TICK_PROMPT, display: true, attribution: "user" },
        { triggerTurn: true, deliverAs: "followUp" }
      );
    }
  });

  pi.on("session_shutdown", () => { clearTimer(); active = false; });
}
