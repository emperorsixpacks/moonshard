import { apiFetch } from "./api.js";
import { getToken, getAddress } from "./session.js";
import { signWireMessage } from "./auth.js";

export function todaySeedString() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

let cachedDeviceId = null;
export async function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;

  // 1. If running inside Nimiq Pay, request official device identifier from host
  if (typeof window !== "undefined" && window.nimiqPay != null) {
    try {
      const { requestDeviceIdentifier } = await import("@nimiq/mini-app-sdk");
      const id = await requestDeviceIdentifier({ reason: "Leaderboard anti-cheat verification" });
      if (id && typeof id === "string") {
        cachedDeviceId = id;
        return cachedDeviceId;
      }
    } catch (e) {
      console.warn("Nimiq Pay requestDeviceIdentifier failed or denied:", e);
    }
  }

  // 2. Fallback to localStorage UUID for web/desktop browsers
  const KEY = "moonshard.device-id.v1";
  let id = null;
  try {
    id = localStorage.getItem(KEY);
    if (!id) {
      id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "anon-" + Date.now();
      localStorage.setItem(KEY, id);
    }
  } catch {
    id = id || "anon";
  }
  cachedDeviceId = id;
  return cachedDeviceId;
}

export async function submitVerifiedScore({ score, mode, durationMs, kills }) {
  const addr = getAddress();
  if (!addr) {
    const err = new Error("not_connected");
    err.status = 401;
    throw err;
  }
  const dateSeed = todaySeedString();
  const message =
    `Moonshard Score Proof: ${score} | Mode: ${mode || "SURVIVAL"} | ` +
    `Player: ${addr} | Date: ${dateSeed}`;
  const { signerPublicKey, signature } = await signWireMessage(message);
  return apiFetch("/api/scores/submit", {
    method: "POST",
    token: getToken(),
    body: JSON.stringify({
      message,
      signerPublicKey,
      signature,
      score,
      dateSeed,
      mode,
      durationMs,
      kills,
      deviceId: await getDeviceId(),
    }),
  });
}

export async function fetchDailyBoard() {
  return apiFetch("/api/leaderboard/daily");
}

export async function fetchAllTimeBoard() {
  return apiFetch("/api/leaderboard/alltime");
}

export async function fetchPayoutStatus() {
  return apiFetch("/api/payouts/status");
}

export async function fetchConfig() {
  return apiFetch("/api/config");
}