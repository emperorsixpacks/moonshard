import { settleDue } from "./spoils.js";
import { runJanitor, JANITOR_INTERVAL_MS } from "./janitor.js";

/**
 * Starts the server's background work and returns one function that stops it:
 *  - settles closed days every `intervalMs`;
 *  - sweeps old run data (see janitor.js) once now and then every `janitorIntervalMs`.
 *
 * Named for its first job: index.js calls only this, so the janitor rides along with it.
 */
export function startSettlementCron(ctx, intervalMs = 60_000, { janitorIntervalMs = JANITOR_INTERVAL_MS, log = console } = {}) {
  const settle = () => settleDue(ctx).catch((err) => log.error("[moonshard] settlement failed", err));
  const sweep = () => runJanitor(ctx).catch((err) => log.error("[moonshard] janitor failed", err));

  settle();
  const settleTimer = setInterval(settle, intervalMs);
  settleTimer.unref();

  sweep();
  const sweepTimer = setInterval(sweep, janitorIntervalMs);
  sweepTimer.unref();

  return () => {
    clearInterval(settleTimer);
    clearInterval(sweepTimer);
  };
}
