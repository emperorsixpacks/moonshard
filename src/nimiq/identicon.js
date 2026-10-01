import Identicons from "@nimiq/identicons";

let assetsPathInited = false;

function ensureAssetsPath() {
  if (assetsPathInited) return;
  if (!self.NIMIQ_IDENTICONS_SVG_PATH) self.NIMIQ_IDENTICONS_SVG_PATH = "/identicons.svg";
  assetsPathInited = true;
}

/** SVG data URL for a Nimiq address, falling back to a placeholder glyph. */
export async function identiconDataUrl(address) {
  ensureAssetsPath();
  try {
    return await Identicons.toDataUrl(String(address ?? ""));
  } catch {
    return Identicons.placeholderToDataUrl("#888", 2);
  }
}

/** Render an identicon into an element (`el` is cleared and filled with an <img>). */
export async function renderIdenticon(el, address) {
  ensureAssetsPath();
  try {
    await Identicons.render(el, String(address ?? ""));
  } catch {
    el.innerHTML = Identicons.placeholder("#888", 2);
  }
}