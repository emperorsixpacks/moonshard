import { apiFetch } from './api.js';
import { saveSession } from './session.js';

/** Must stay byte-identical to `loginMessage` in server/src/auth.js. */
export const loginMessage = (nonce, issuedAt) => `Moonshard login\nNonce: ${nonce}\nIssued: ${issuedAt}`;

export async function signIn({ wallet, host, api = apiFetch }) {
  // The account we ask to sign: capture it now, the wallet's active account can change while the prompt is open.
  const address = wallet.getState().address;
  const { nonce, issuedAt } = await api('/auth/nonce');
  const message = loginMessage(nonce, issuedAt);
  const signature = await wallet.signMessage(message);
  const res = await api('/auth/verify', { method: 'POST', body: { address, message, signature, host } });
  if (!res?.token || !res?.address) throw Object.assign(new Error('bad_response'), { status: 200 });
  saveSession({ token: res.token, address: res.address, host });
  return res;
}
