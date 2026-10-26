import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteHtml, inviteTitle, joinedAgo } from '../../src/ui/referralView.js';

/*
 * The invite sheet as a pure function of what the server said about the player's link: every state it can be in, and
 * nothing from the server reaching the page unescaped.
 */

const NOW = Date.parse('2026-10-10T12:00:00Z');
const LINK = 'https://playmoonshard.xyz/?ref=K7M2QX9A';
const ready = (over = {}) => ({
  phase: 'ready', link: LINK, joined: 3, verified: 2, playing: 1, copied: false,
  friends: [
    { who: '0x1234…abcd', status: 'playing', joinedAt: '2026-10-10T08:00:00Z' },
    { who: '0x5678…ef01', status: 'verified', joinedAt: '2026-10-09T08:00:00Z' },
    { who: '0x9abc…2345', status: 'joined', joinedAt: '2026-10-01T08:00:00Z' },
  ],
  ...over,
});

test('the sheet has a title', () => {
  assert.equal(inviteTitle, 'Invite friends');
});

test('while the link loads, it says so and offers nothing', () => {
  const html = inviteHtml({ phase: 'loading' });
  assert.match(html, /Getting your link/);
  assert.doesNotMatch(html, /data-act/);
});

test('a failure says why and offers another try', () => {
  const html = inviteHtml({ phase: 'error', error: "Can't reach the server. Check your connection and try again." });
  assert.match(html, /Can&#39;t reach the server/, 'the words are escaped like everything else');
  assert.match(html, /data-act="retry"/);
  assert.doesNotMatch(html, /invite-link/);
});

test('the link is shown in full, with the counts and each friend', () => {
  const html = inviteHtml(ready(), { now: NOW });
  assert.ok(html.includes('>https://playmoonshard.xyz/<span class="q">?ref=K7M2QX9A</span><'), 'the whole link is on the page, and the code never breaks across lines');
  assert.equal(html.replace(/<[^>]+>/g, '').includes(LINK), true, 'and reads as the link');
  assert.match(html, /<b>3<\/b><small>Joined<\/small>/);
  assert.match(html, /<b>2<\/b><small>Verified<\/small>/);
  assert.match(html, /<b>1<\/b><small>Playing<\/small>/);
  assert.match(html, /0x1234…abcd/);
  assert.match(html, /Joined today/);
  assert.match(html, /Joined yesterday/);
  assert.match(html, /Joined 9 days ago/);
});

test('each friend\'s step is marked: joined, verified (the tick), playing (the blade)', () => {
  const html = inviteHtml(ready(), { now: NOW });
  assert.match(html, /fr-st playing[^>]*>.*?Playing/);
  assert.match(html, /fr-st verified[^>]*>.*?Verified/);
  assert.match(html, /fr-st joined[^>]*>Joined/);
  assert.match(html, /#62D6A4/, 'the verified tick is the interface\'s one green');
});

test('a phone that can share gets Share first and Copy second; one that cannot gets Copy as the main button', () => {
  const withShare = inviteHtml(ready(), { canShare: true });
  assert.ok(withShare.indexOf('data-act="share"') < withShare.indexOf('data-act="copy"'));
  assert.match(withShare, /class="gold btn gd-wallet" data-act="share"/);
  assert.match(withShare, /class="btn-2 gd-wallet" data-act="copy"/);

  const without = inviteHtml(ready(), { canShare: false });
  assert.doesNotMatch(without, /data-act="share"/);
  assert.match(without, /class="gold btn gd-wallet" data-act="copy"/);
});

test('once copied, the button says so', () => {
  assert.match(inviteHtml(ready({ copied: true })), /<span>Copied<\/span>/);
  assert.match(inviteHtml(ready({ copied: false })), /<span>Copy link<\/span>/);
});

test('with no friends yet the list says to send the link, and the counts are zero', () => {
  const html = inviteHtml(ready({ joined: 0, verified: 0, playing: 0, friends: [] }));
  assert.match(html, /No friends yet/);
  assert.match(html, /<b>0<\/b><small>Joined<\/small>/);
});

test('nothing from the server reaches the page as markup', () => {
  const html = inviteHtml(ready({
    link: 'https://x.test/?ref="><img src=x onerror=alert(1)>',
    friends: [{ who: '<img src=x onerror=alert(1)>', status: '"><script>', joinedAt: 'nope' }],
    joined: '<b>9</b>', verified: -4, playing: 2.9,
  }));
  assert.doesNotMatch(html, /<img|<script/i);
  assert.match(html, /<b>0<\/b><small>Joined<\/small>/, 'a count that is not a number is zero');
  assert.match(html, /<b>0<\/b><small>Verified<\/small>/, 'and never negative');
  assert.match(html, /<b>2<\/b><small>Playing<\/small>/, 'and a whole number');
  assert.match(html, /fr-st joined/, 'a step the sheet does not know is shown as joined, and never put in a class as it came');
  const err = inviteHtml({ phase: 'error', error: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(err, /<img/i);
});

test('when a friend joined, in words', () => {
  assert.equal(joinedAgo('2026-10-10T00:00:00Z', NOW), 'today');
  assert.equal(joinedAgo('2026-10-09T11:00:00Z', NOW), 'yesterday');
  assert.equal(joinedAgo('2026-10-05T12:00:00Z', NOW), '5 days ago');
  assert.equal(joinedAgo('2026-08-01T12:00:00Z', NOW), 'over a month ago');
  assert.equal(joinedAgo('2026-10-11T12:00:00Z', NOW), 'today', 'a clock a little ahead is still today');
  assert.equal(joinedAgo('garbage', NOW), '');
});
