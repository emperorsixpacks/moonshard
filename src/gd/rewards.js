import { apiFetch } from './api.js';
import { getToken } from './session.js';

/** HUD status for the connected player: pending shard G$, daily cap, first-boss bounty state, blessing. */
export async function fetchRewardsStatus() {
  const token = getToken();
  if (!token) return null;
  try {
    return await apiFetch('/rewards/status', { token });
  } catch (err) {
    console.warn('[rewards] status failed', err?.message);
    return null;
  }
}
