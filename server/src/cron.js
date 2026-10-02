import { settleDue } from "./spoils.js";
import { runJanitor, JANITOR_INTERVAL_MS } from "./janitor.js";
import { checkVaultCaps } from "./boot.js";

/**
 * Starts the server's background work and returns one function that stops it:
 *  - settles closed days every `intervalMs`;
 *  - sweeps old run data (see janitor.js) once now and then every `janitorIntervalMs`;
 *  - once, at start-up, compares the vault's on-chain caps with the prizes this server signs and warns if a voucher
 *    could never be redeemed (see checkVaultCaps). That check is not awaited and cannot fail the start.
 *
 * Named for its first job: index.js calls only this, so the other two ride along with it.
 */
export function startSettlementCron(
  ctx,
  intervalMs = 60_000,
  { janitorIntervalMs = JANITOR_INTERVAL_MS, checkCaps = checkVaultCaps, log = console } = {},
) {
  const settle = () => settleDue(ctx).catch((err) => log.error("[moonshard] settlement failed", err));
  const sweep = () => runJanitor(ctx).catch((err) => log.error("[moonshard] janitor failed", err));

  settle();
  const settleTimer = setInterval(settle, intervalMs);
  settleTimer.unref();

  sweep();
  const sweepTimer = setInterval(sweep, janitorIntervalMs);
  sweepTimer.unref();

  try {
    Promise.resolve(checkCaps({ config: ctx.config, log })).catch((err) => log.error("[moonshard] vault caps check failed", err));
  } catch (err) {
    log.error("[moonshard] vault caps check failed", err);
  }

  return () => {
    clearInterval(settleTimer);
    clearInterval(sweepTimer);
  };
}
