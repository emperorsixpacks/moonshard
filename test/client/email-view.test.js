import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_LENGTH, codeProblem, emailProblem, emailSheetHtml, emailTitle, errorText } from '../../src/ui/emailView.js';

/* Signing in with an email, as pure functions of the step: what the player sees and what is wrong when something is. */

test('the first step asks for the email and says plainly where it goes', () => {
  const h = emailSheetHtml({ step: 'email' });
  assert.match(h, /<input name="email" type="email"/);
  assert.match(h, /autocomplete="email"/);
  assert.match(h, />Send me a code</);
  assert.match(h, /nothing to install/);
  assert.match(h, /Moonshard never sees it/);
  assert.match(h, /data-act="back"/);
  assert.doesNotMatch(h, /gd-warn/, 'no error before there is one');
});

test('while the code is on its way the form waits', () => {
  const h = emailSheetHtml({ step: 'sending', email: 'a@b.co' });
  assert.match(h, /Sending…/);
  assert.match(h, /<input[^>]*disabled/);
  assert.match(h, /value="a@b\.co"/, 'what they typed is kept');
});

test('the code step names the address and asks for a one-time code the phone can fill in', () => {
  const h = emailSheetHtml({ step: 'code', email: 'a@b.co' });
  assert.match(h, new RegExp(`We sent a ${CODE_LENGTH}-digit code to <b class="who">a@b\\.co</b>`));
  assert.match(h, /autocomplete="one-time-code"/);
  assert.match(h, /inputmode="numeric"/);
  assert.match(h, new RegExp(`maxlength="${CODE_LENGTH}"`));
  assert.match(h, />Sign in</);
  assert.match(h, /Use a different email/);
});

test('while the code is being checked the form waits', () => {
  const h = emailSheetHtml({ step: 'checking', email: 'a@b.co' });
  assert.match(h, /Checking…/);
  assert.match(h, /<input[^>]*disabled/);
});

test('once signed in it says it is connecting', () => {
  assert.match(emailSheetHtml({ step: 'connecting' }), /Connecting your wallet/);
  assert.equal(emailTitle('connecting'), 'Signing you in');
  assert.equal(emailTitle('email'), 'Sign in with email');
});

test('an email address is text, never markup', () => {
  const evil = '"><img src=x onerror=alert(1)>@b.co';
  for (const step of ['email', 'sending', 'code', 'checking']) {
    const h = emailSheetHtml({ step, email: evil });
    assert.doesNotMatch(h, /<img/, `${step}: no tag made from the address`);
    assert.doesNotMatch(h, /value=""[^>]*>[^<]*<img/, `${step}: the quote does not close the attribute`);
    assert.match(h, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;@b\.co/, `${step}: it is shown as escaped text`);
  }
});

test('every problem has words a player can act on, and an unknown one never shows its code', () => {
  for (const code of ['invalid_email', 'invalid_code', 'wrong_code', 'expired', 'throttled', 'too_many_attempts', 'mfa_unsupported', 'failed']) {
    const text = errorText(code);
    assert.ok(text.length > 10 && !text.includes('_'), `${code}: ${text}`);
    assert.match(emailSheetHtml({ step: 'email', error: code }), /role="alert"/);
  }
  assert.equal(errorText('something_odd'), errorText('failed'));
  assert.equal(errorText(undefined), errorText('failed'));
});

test('an email and a code are checked before anything is sent', () => {
  assert.equal(emailProblem('a@b.co'), null);
  assert.equal(emailProblem('  a@b.co  '), null);
  assert.equal(emailProblem('nope'), 'invalid_email');
  assert.equal(emailProblem(''), 'invalid_email');
  assert.equal(codeProblem('123456'), null);
  assert.equal(codeProblem(' 123456 '), null);
  for (const bad of ['12345', '1234567', 'abcdef', '12 456', '']) assert.equal(codeProblem(bad), 'invalid_code', bad);
});
