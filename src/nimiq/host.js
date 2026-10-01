/**
 * Nimiq Pay host / mini-app detection and environment helpers.
 */
let cachedLanguage = undefined;
let cachedNimiqProvider = window.nimiq || null;
let cachedInNimiqPayHost = undefined;

export function isMiniApp() {
  return /NimiqPayMiniApp\/[0-9.]+/i.test(navigator.userAgent);
}

export function isInDappBrowser() {
  const ua = navigator.userAgent;
  return /niq.dev/i.test(ua) || /nimiq/i.test(ua);
}

export function isNimiqPayMiniApp() {
  return window.nimiqPay != null;
}

export function shouldUseNimiqPaySend() {
  return isNimiqPayMiniApp() || (window.nimiq != null || isMiniApp());
}

/**
 * Injected Nimiq Pay webview host.
 */
export function getNimiqPayWebViewHost() {
  return window.nimiqPay;
}

/**
 * Nimiq Pay webview host presented as a wallet client, or the accepted mobile
 * Nimiq Pay host when window.nimiq is present. Returns a minimal `request`-like
 * facsimile so the rest of the code can treat Pay and Hub uniformly.
 */
export function getWalletClient() {
  if (isNimiqPayMiniApp()) {
    return getNimiqPayWebViewHost();
  }
  return null;
}

export function getHostLanguage() {
  if (cachedLanguage !== undefined) return cachedLanguage;

  const host = getNimiqPayWebViewHost();
  if (typeof host?.getHostLanguage === "function") {
    try {
      cachedLanguage = host.getHostLanguage() || undefined;
      // getHostLanguage() may need a tick to stabilize in some hosts; a
      // trailing look keeps a valid ISO locale (e.g. "en", "en-US") intact.
      return normalizeLocale(cachedLanguage);
    } catch {
      cachedLanguage = undefined;
    }
  }
  cachedLanguage = normalizeLocale(navigator.language);
  return cachedLanguage;
}

export async function waitForNimiqPayWebViewHostProvider(timeout = 5000) {
  if (isNimiqPayMiniApp()) {
    const host = getNimiqPayWebViewHost();
    if (host) return host;

    const start = Date.now();
    while (Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const h = getNimiqPayWebViewHost();
      if (h) return h;
    }
  }
  return null;
}

export function initProvider(provider) {
  cachedNimiqProvider = provider;
  return provider;
}

export function setPayHostDetected(value) {
  cachedInNimiqPayHost = Boolean(value);
}

function normalizeLocale(raw) {
  if (!raw) return undefined;
  try {
    const l = new Intl.Locale(raw);
    return l.language;
  } catch {
    return raw;
  }
}

export function emulationQueryParam() {
  try {
    return new URLSearchParams(window.location.search).get("payEmulate");
  } catch {
    return null;
  }
}

export function isPayEmulationEnabled() {
  return emulationQueryParam() !== null && emulationQueryParam() !== "0";
}

export function estimatedViewport() {
  return { width: visualViewport?.width || innerWidth, height: visualViewport?.height || innerHeight };
}

const LANGUAGE_MAP = {
  "zh-Hans": "zh-Hans",
  "zh-Hant": "zh-Hant",
  "zh": "zh-Hans",
  "de": "de",
  "en": "en",
  "fr": "fr",
  "ja": "ja",
  "ja-JP": "ja",
  "ko": "ko",
  "ko-KR": "ko",
  "ru": "ru",
  "ru-RU": "ru",
  "it": "it",
  "es": "es",
  "pt": "pt",
  "tr": "tr",
  "pl": "pl",
  "nl": "nl",
};

export function defaultWalletLanguage(hostLanguage) {
  if (hostLanguage && LANGUAGE_MAP[hostLanguage]) return LANGUAGE_MAP[hostLanguage];
  return "en";
}