import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailLogin, EMAIL_PATTERN } from '../../src/gd/magic.js';

/** A stand-in for magic-sdk: the pieces this game uses, behaving as the SDK documents them. */
function fakeSdk({ loggedIn = false, code = '123456' } = {}) {
  const log = { loads: 0, constructed: [], logins: [], emitted: [], logouts: 0, state: { loggedIn } };
  class Magic {
    constructor(key, options) {
      log.constructed.push({ key, options });
      this.rpcProvider = { request: async () => null, on() {} };
      this.user = { isLoggedIn: async () => log.state.loggedIn, logout: async () => { log.logouts += 1; log.state.loggedIn = false; } };
      this.auth = {
        loginWithEmailOTP: (args) => {
          log.logins.push(args);
          const listeners = {};
          let resolve; let reject;
          const settled = new Promise((res, rej) => { resolve = res; reject = rej; });
          const fire = (event) => (listeners[event] || []).forEach((fn) => fn());
          const handle = {
            on: (event, fn) => { (listeners[event] ||= []).push(fn); return handle; },
            emit: (event, payload) => {
              log.emitted.push([event, payload]);
              if (event === 'verify-email-otp') {
                if (payload === code) { log.state.loggedIn = true; resolve('did-token'); } else fire('invalid-email-otp');
              }
              if (event === 'cancel') reject(new Error('Login was cancelled'));
            },
            then: settled.then.bind(settled),
            catch: settled.catch.bind(settled),
            fire,
          };
          log.lastHandle = handle;
          queueMicrotask(() => fire('email-otp-sent'));
          return handle;
        },
      };
    }
  }
  return { log, load: async () => { log.loads += 1; return { Magic }; } };
}

const opts = (sdk, key = 'pk_live_TEST') => ({ key, chainId: 42220, rpcUrl: 'https://forno.celo.org', load: sdk.load });
const tick = () => new Promise((r) => setImmediate(r));

test('without a key it is not offered and never loads the SDK', async () => {
  const sdk = fakeSdk();
  const login = createEmailLogin(opts(sdk, ''));
  assert.equal(login.available, false);
  assert.equal(await login.provider(), null);
  await login.logout();
  assert.equal(sdk.log.loads, 0);
});

test('the SDK is loaded once, for Celo, with the game\'s key', async () => {
  const sdk = fakeSdk({ loggedIn: true });
  const login = createEmailLogin(opts(sdk));
  await login.provider();
  await login.provider();
  assert.equal(sdk.log.loads, 1);
  assert.equal(sdk.log.constructed.length, 1);
  assert.deepEqual(sdk.log.constructed[0], { key: 'pk_live_TEST', options: { network: { rpcUrl: 'https://forno.celo.org', chainId: 42220 } } });
});

test('a signed-in player has a provider, anyone else does not', async () => {
  assert.ok(await createEmailLogin(opts(fakeSdk({ loggedIn: true }))).provider());
  assert.equal(await createEmailLogin(opts(fakeSdk({ loggedIn: false }))).provider(), null);
});

test('signing in: the code is asked for, a wrong one is refused, the right one signs in', async () => {
  const sdk = fakeSdk();
  const events = [];
  const flow = await createEmailLogin(opts(sdk)).begin('a@b.co', {
    onCodeSent: () => events.push('sent'), onWrongCode: () => events.push('wrong'), onExpired: () => events.push('expired'),
  });
  assert.deepEqual(sdk.log.logins, [{ email: 'a@b.co', showUI: false }]); // our own screens, not Magic's
  await tick();
  assert.deepEqual(events, ['sent']);
  flow.submit('000000');
  await tick();
  assert.deepEqual(events, ['sent', 'wrong']);
  flow.submit(' 123456 '); // a pasted code with spaces
  await flow.done;
  assert.deepEqual(sdk.log.emitted.at(-1), ['verify-email-otp', '123456']);
  assert.equal(sdk.log.state.loggedIn, true);
});

test('a code that ran out is reported', async () => {
  const sdk = fakeSdk();
  const events = [];
  await createEmailLogin(opts(sdk)).begin('a@b.co', { onExpired: () => events.push('expired') });
  sdk.log.lastHandle.fire('expired-email-otp');
  assert.deepEqual(events, ['expired']);
});

test('cancelling ends the attempt as "cancelled"', async () => {
  const sdk = fakeSdk();
  const flow = await createEmailLogin(opts(sdk)).begin('a@b.co');
  flow.cancel();
  await assert.rejects(flow.done, /cancelled/);
  assert.ok(sdk.log.emitted.some(([e]) => e === 'cancel'));
  flow.cancel(); // twice is harmless
});

test('too many tries and too many wrong codes end the attempt with a code, not a crash', async () => {
  for (const [event, code] of [['login-throttled', 'throttled'], ['max-attempts-reached', 'too_many_attempts']]) {
    const sdk = fakeSdk();
    const flow = await createEmailLogin(opts(sdk)).begin('a@b.co');
    sdk.log.lastHandle.fire(event);
    await assert.rejects(flow.done, new RegExp(code));
  }
});

test('an account that asks for a second step is turned away, and the attempt is cancelled', async () => {
  const sdk = fakeSdk();
  const flow = await createEmailLogin(opts(sdk)).begin('a@b.co');
  sdk.log.lastHandle.fire('mfa-sent-handle');
  await assert.rejects(flow.done, /mfa_unsupported/);
  assert.ok(sdk.log.emitted.some(([e]) => e === 'cancel'));
});

test('signing out goes to Magic', async () => {
  const sdk = fakeSdk({ loggedIn: true });
  const login = createEmailLogin(opts(sdk));
  await login.logout();
  assert.equal(sdk.log.logouts, 1);
  assert.equal(await login.provider(), null);
});

test('the SDK failing to load is an error the caller can catch', async () => {
  const login = createEmailLogin({ key: 'pk', load: async () => { throw new Error('chunk failed'); } });
  await assert.rejects(login.begin('a@b.co'), /chunk failed/);
  await assert.rejects(login.provider(), /chunk failed/);
});

test('what counts as an email address', () => {
  for (const ok of ['a@b.co', 'first.last+tag@example.com', 'x@sub.domain.org']) assert.ok(EMAIL_PATTERN.test(ok), ok);
  for (const bad of ['', 'a', 'a@b', 'a@b.', '@b.co', 'a b@c.co', 'a@b .co']) assert.ok(!EMAIL_PATTERN.test(bad), bad);
});
