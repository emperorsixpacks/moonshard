import { settleDue } from "./spoils.js";

/** Settles closed days every `intervalMs`. Returns a stop function. */
export function startSettlementCron(ctx, intervalMs = 60_000) {
  const run = () => settleDue(ctx).catch((err) => console.error("[moonshard] settlement failed", err));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
