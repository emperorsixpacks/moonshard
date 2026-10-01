import { apiFetch } from "./api.js";
import { getToken, getAddress } from "./session.js";
import { signWireMessage } from "./auth.js";
import { getDeviceId, todaySeedString } from "./leaderboard.js";

/** Fetch reward eligibility and current daily crystal status for connected wallet */
export async function fetchRewardsStatus() {
  const token = getToken();
  if (!token) return null;
  try {
    const deviceId = await getDeviceId();
    const path = deviceId
      ? `/api/rewards/status?deviceId=${encodeURIComponent(deviceId)}`
      : "/api/rewards/status";
    return await apiFetch(path, { token });
  } catch (e) {
    console.warn("[rewards] failed to fetch status", e?.message);
    return null;
  }
}

/** Claim the one-time 10 NIM First Story Boss bounty */
export async function claimFirstStoryBossReward({ chapterId, bossName, durationMs, kills }) {
  const addr = getAddress();
  const token = getToken();
  if (!addr || !token) {
    const err = new Error("not_connected");
    err.status = 401;
    throw err;
  }
  const ch = Number(chapterId) || 1;
  const boss = String(bossName || "Gorgok");
  const message = `Moonshard Boss Proof: Chapter ${ch} | Boss: ${boss} | Player: ${addr}`;
  const { signerPublicKey, signature } = await signWireMessage(message);
  const deviceId = await getDeviceId();

  return apiFetch("/api/rewards/claim-boss", {
    method: "POST",
    token,
    body: JSON.stringify({
      message,
      signerPublicKey,
      signature,
      chapterId: ch,
      bossName: boss,
      durationMs: Math.round(durationMs || 0),
      kills: Math.round(kills || 0),
      deviceId,
    }),
  });
}

/** Bank collected crystals from a run, crediting 0.001 NIM each up to 0.1 NIM/day */
export async function bankCrystalHarvest({ crystalsCollected, durationMs, kills }) {
  const addr = getAddress();
  const token = getToken();
  if (!addr || !token) {
    return { ok: false, reason: "not_connected" };
  }
  const count = Math.max(0, Math.floor(Number(crystalsCollected) || 0));
  if (count <= 0) {
    return { ok: true, creditedNim: 0, creditedCrystals: 0 };
  }
  const dateSeed = todaySeedString();
  const message = `Moonshard Crystal Proof: ${count} | Date: ${dateSeed} | Player: ${addr}`;
  const { signerPublicKey, signature } = await signWireMessage(message);
  const deviceId = await getDeviceId();

  return apiFetch("/api/rewards/bank-crystals", {
    method: "POST",
    token,
    body: JSON.stringify({
      message,
      signerPublicKey,
      signature,
      dateSeed,
      crystalsCollected: count,
      durationMs: Math.round(durationMs || 0),
      kills: Math.round(kills || 0),
      deviceId,
    }),
  });
}
