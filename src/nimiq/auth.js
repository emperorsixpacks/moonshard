import HubApi from "@nimiq/hub-api";
import { apiFetch } from "./api.js";

const HUB_URL = import.meta.env.VITE_HUB_URL || "https://hub.nimiq.com";
export const APP_NAME = "Moonshard";

export function isNimiqPayMiniApp() {
  return window.nimiqPay != null;
}

function toB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

/** Decode hex or standard base64 payload from the Nimiq Pay `sign` RPC. */
function decodeBinaryString(s) {
  const t = String(s).trim();
  if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0) {
    const out = new Uint8Array(t.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  try {
    const binary = atob(t);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    throw new Error("invalid_wallet_encoding");
  }
}

/** Nimiq Pay may return `string`, `Uint8Array`, or JSON numeric byte arrays from the native bridge. */
function coerceSignBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return new Uint8Array(v);
  if (typeof v === "string") return decodeBinaryString(v);
  throw new Error("invalid_wallet_encoding");
}

function isProviderErrorResponse(x) {
  if (typeof x !== "object" || x === null || !("error" in x)) return false;
  const err = x.error;
  return typeof err === "object" && err !== null;
}

async function signLoginChallengeMiniApp(nonce) {
  const { init } = await import("@nimiq/mini-app-sdk");
  const nimiq = await init();
  const message = `Login:v1:${nonce}`;
  const raw = await nimiq.sign(message);
  if (isProviderErrorResponse(raw)) {
    throw new Error(String(raw.error?.message || "nimiq_pay_sign_failed"));
  }
  const { publicKey, signature } = raw;
  const pubBytes = coerceSignBytes(publicKey);
  const sigBytes = coerceSignBytes(signature);
  return {
    nonce,
    message,
    signer: "",
    signerPublicKey: toB64(pubBytes),
    signature: toB64(sigBytes),
    nimiqPayClient: true,
  };
}

function nonEmptyHubSigner(signed) {
  const raw = signed?.signer;
  if (raw == null) return undefined;
  const s = typeof raw === "string" ? raw.trim() : String(raw).trim();
  return s.length > 0 ? s : undefined;
}

async function signLoginChallengeHub(nonce) {
  const hubApi = new HubApi(HUB_URL);
  const message = `Login:v1:${nonce}`;
  const signed = await hubApi.signMessage({ appName: APP_NAME, message });
  const signer = nonEmptyHubSigner(signed);
  const base = {
    nonce,
    message,
    signerPublicKey: toB64(signed.signerPublicKey),
    signature: toB64(signed.signature),
  };
  if (signer !== undefined) base.signer = signer;
  return base;
}

export async function signLoginChallenge(nonce) {
  if (isNimiqPayMiniApp()) return signLoginChallengeMiniApp(nonce);
  return signLoginChallengeHub(nonce);
}

export async function fetchNonce() {
  return apiFetch("/api/auth/nonce");
}

export async function verifyWithServer(body) {
  return apiFetch("/api/auth/verify", { method: "POST", body: JSON.stringify(body) });
}

export async function signInWithWallet() {
  const { nonce } = await fetchNonce();
  const payload = await signLoginChallenge(nonce);
  return verifyWithServer(payload);
}

/**
 * Sign an arbitrary UTF-8 message via Nimiq Pay (`nimiq.sign`) or Hub
 * `signMessage`. Returns base64 `{ signerPublicKey, signature }` suitable for
 * server verification (server re-applies the Nimiq signed-message prefix).
 */
export async function signWireMessage(message) {
  const msg = String(message ?? "");
  if (!msg) throw new Error("empty_message");
  if (isNimiqPayMiniApp()) {
    const { init } = await import("@nimiq/mini-app-sdk");
    const nimiq = await init();
    const raw = await nimiq.sign(msg);
    if (isProviderErrorResponse(raw)) {
      throw new Error(String(raw.error?.message || "nimiq_pay_sign_failed"));
    }
    const { publicKey, signature } = raw;
    return {
      signerPublicKey: toB64(coerceSignBytes(publicKey)),
      signature: toB64(coerceSignBytes(signature)),
    };
  }
  const hubApi = new HubApi(HUB_URL);
  const signed = await hubApi.signMessage({ appName: APP_NAME, message: msg });
  return {
    signerPublicKey: toB64(signed.signerPublicKey),
    signature: toB64(signed.signature),
  };
}

const USER_ABORT_KEYWORDS = ["cancel", "abort", "denied", "reject", "dismiss", "closed"];
export function isUserAbortError(e) {
  const msg = String(e?.message || "").toLowerCase();
  return USER_ABORT_KEYWORDS.some((kw) => msg.includes(kw));
}