import { apiFetch } from './api.js';
import { saveSession } from './session.js';

/** Must stay byte-identical to `loginMessage` in server/src/auth.js. */
export const loginMessage = (nonce, issuedAt) => `Moonshard login\nNonce: ${nonce}\nIssued: ${issuedAt}`;

export async function signIn({ wallet, host, api = apiFetch }) {
  const { nonce, issuedAt } = await api('/auth/nonce');
  const message = loginMessage(nonce, issuedAt);
  const signature = await wallet.signMessage(message);
  const res = await api('/auth/verify', {
    method: 'POST',
    body: { address: wallet.getState().address, message, signature, host },
  });
  saveSession({ token: res.token, address: res.address, host });
  return res;
}
