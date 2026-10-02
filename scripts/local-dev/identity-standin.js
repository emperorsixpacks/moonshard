/**
 * LOCAL TESTING ONLY. `npm run dev:local` serves this in place of src/gd/identity.js (see plugin.mjs). The game still
 * asks for the face-verification link the same way and navigates to it; the link just leads to a page on the local
 * launcher where one click marks the test player as a verified human on the local fork, then returns to the game as
 * GoodDollar's hosted page would. Nothing in src/ imports this file, and a normal dev server or build never sees it.
 */
export async function faceVerificationLink() {
  const dev = window.__MS_LOCAL_DEV;
  const callback = `${window.location.origin}${window.location.pathname}?gdfv=1`;
  return `${dev.helper}/face-scan?${new URLSearchParams({ address: dev.address, callback })}`;
}
