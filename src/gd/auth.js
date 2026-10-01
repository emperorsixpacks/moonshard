import { apiFetch } from './api.js';
import { canSignMessages } from './host.js';
import { saveSession } from './session.js';

/** Must stay byte-identical to `loginMessage` in server/src/auth.js. */
export const loginMessage = (nonce, issuedAt) => `Moonshard login\nNonce: ${nonce}\nIssued: ${issuedAt}`;

/**
 * MiniPay cannot sign, so it gets a signing-free session: the server trusts the injected address for gameplay and
 * reads, and refuses anything that needs proof of the key (the Engagement bounty needs an EIP-712 signature).
 * Money is never at risk: every payout is bound to the on-chain address, not to the session.
 */
async function signInUnsigned({ wallet, host, api }) {
  const res = await api('/auth/unsigned', { method: 'POST', body: { address: wallet.getState().address, host } });
  saveSession({ token: res.token, address: res.address, host, unsigned: true });
  return res;
}

export async function signIn({ wallet, host, api = apiFetch }) {
  if (!canSignMessages(host)) return signInUnsigned({ wallet, host, api });
  const { nonce, issuedAt } = await api('/auth/nonce');
  const message = loginMessage(nonce, issuedAt);
  const signature = await wallet.signMessage(message);
  const res = await api('/auth/verify', {
    method: 'POST',
    body: { address: wallet.getState().address, message, signature, host },
  });
  saveSession({ token: res.token, address: res.address, host, unsigned: false });
  return res;
}
