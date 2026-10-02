/**
 * The two pages the local launcher serves (see launch.mjs): the face-scan stand-in, and the control page that shows the test
 * player's G$ and carries the few buttons a person needs to see every part of the G$ flow without waiting a day.
 */

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Safe inside an inline <script>: JSON with the characters that could end the script or the string escaped. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const js = (value) => JSON.stringify(value)
  .split('<').join('\\u003c')
  .split(LINE_SEPARATOR).join('\\u2028')
  .split(PARAGRAPH_SEPARATOR).join('\\u2029');

const STYLE = `
  :root { --bg:#0b130b; --panel:#111e11; --line:#2e4e2e; --ink:#cfe8cf; --muted:#8cb38c; --gold:#ffd166; --lime:#98ff20; --cyan:#38e1ff; --bad:#ff7b7b; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  main { max-width: 920px; margin: 0 auto; padding: 22px 16px 56px; }
  h1 { font-size: 20px; color: var(--gold); margin: 0 0 4px; }
  h2 { font-size: 13px; letter-spacing: .08em; color: var(--gold); margin: 0 0 10px; text-transform: uppercase; }
  .sub { color: var(--muted); margin: 0 0 18px; }
  .banner { background:#2a2208; border:1px solid #6b5514; color:var(--gold); padding:8px 12px; border-radius:6px; margin: 0 0 18px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px 16px; margin: 0 0 14px; }
  a { color: var(--cyan); }
  code { color: var(--lime); word-break: break-all; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:10px; }
  .tile { border:1px solid var(--line); border-radius:6px; padding:8px 10px; background:#0d170d; }
  .tile span { display:block; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  .tile b { display:block; font-size:19px; color:var(--lime); margin-top:2px; }
  .yes { color: var(--lime); } .no { color: var(--bad); }
  button { font:inherit; cursor:pointer; color:#0b130b; background:var(--lime); border:0; border-radius:6px; padding:9px 14px; margin: 0 8px 8px 0; }
  button.ghost { background:transparent; color:var(--ink); border:1px solid var(--line); }
  button:disabled { opacity:.5; cursor:wait; }
  #msg { min-height: 1.5em; color: var(--gold); margin: 4px 0 0; }
  table { width:100%; border-collapse: collapse; }
  td, th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:normal; font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  td.num { text-align:right; white-space:nowrap; }
  .in { color: var(--lime); } .out { color: var(--gold); }
  ol { margin: 0; padding-left: 20px; } li { margin: 0 0 8px; }
  .muted { color: var(--muted); }
`;

export function facePage({ address, callback, error }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Face scan (local stand-in)</title><style>${STYLE} main { max-width: 560px; margin-top: 8vh; } button { font-size: 16px; padding: 12px 18px; }</style></head>
<body><main>
  <div class="banner">LOCAL TEST. This is not GoodDollar's face scan.</div>
  <h1>Face scan (stand-in)</h1>
  ${error
    ? `<p class="no">${esc(error)}</p>`
    : `<p>In the real game this step opens GoodDollar's hosted face verification, and Moonshard never sees your face. Here, one click marks
  <code>${esc(address)}</code> as a verified human on your <b>local fork</b> of Celo, in the real Identity contract, and sends you back to the game.</p>
  <button id="pass">Pass the face scan</button>
  <a class="muted" href="${esc(callback)}">Cancel and go back</a>
  <p id="msg"></p>`}
</main>
${error ? '' : `<script>
  var callback = ${js(callback)};
  document.getElementById('pass').addEventListener('click', async function (event) {
    var button = event.currentTarget;
    button.disabled = true;
    document.getElementById('msg').textContent = 'Marking you as verified on the local fork...';
    try {
      var res = await fetch('/face-scan/pass', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || 'failed');
      location.href = callback;
    } catch (err) {
      button.disabled = false;
      document.getElementById('msg').textContent = 'Did not work: ' + err.message;
    }
  });
</script>`}
</body></html>`;
}

export function controlPage({ gameUrl, statsUrl }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Moonshard local test</title><style>${STYLE}</style></head>
<body><main>
  <h1>Moonshard local test session</h1>
  <p class="sub">A local copy of the Celo mainnet contracts. Nothing here touches the real chain or spends real G$. Stop the launcher (Ctrl-C) and everything resets.</p>
  <div class="banner">The face scan is a stand-in that passes on a click, and the wallet is a throwaway test key. Neither exists in a normal run or in production.</div>

  <p><a href="${esc(gameUrl)}" target="_blank">Open the game</a> &nbsp;·&nbsp; <a href="${esc(statsUrl)}" target="_blank">Public stats page</a></p>

  <div class="card"><h2>Your test player</h2>
    <div class="grid">
      <div class="tile"><span>Address</span><b id="addr" style="font-size:12px;word-break:break-all"></b></div>
      <div class="tile"><span>Verified human</span><b id="verified">...</b></div>
      <div class="tile"><span>G$ in your wallet</span><b id="g">...</b></div>
      <div class="tile"><span>CELO for gas</span><b id="celo">...</b></div>
      <div class="tile"><span>G$ left in the vault</span><b id="vault">...</b></div>
      <div class="tile"><span>Days skipped</span><b id="skipped">0</b></div>
    </div>
  </div>

  <div class="card"><h2>Shortcuts</h2>
    <button id="next-day">Skip to the next day and settle Spoils</button>
    <button id="boss">Record a chapter-1 boss clear</button>
    <button id="revoke" class="ghost">Remove my verification (see the gate again)</button>
    <p id="msg"></p>
    <p class="muted">The first two save waiting: a day boundary pays the daily prizes and Shard Harvest as Spoils, and the boss clear is what beating chapter 1's boss records. Use them between runs, then reload the game and open the G$ wallet.</p>
  </div>

  <div class="card"><h2>G$ in and out of your wallet</h2>
    <table><thead><tr><th>What</th><th class="num">G$</th><th>Block</th></tr></thead><tbody id="ledger"></tbody></table>
    <p id="empty" class="muted">Nothing yet. Claim your daily G$ in the game's wallet panel and it shows up here, and so does every G$ you pay into the prize vault: your blade, forge fees and Moon Shop looks.</p>
  </div>

  <div class="card"><h2>Where G$ appears in the game</h2>
    <ol>
      <li><b>The gate.</b> Tap Endless, Story or Tutorial. Connect (the test wallet signs in), then "Verify (face scan)" goes to the stand-in page; one click and you are back as a verified human with a PLAY button. Only verified humans play, and every reward is keyed to one human.</li>
      <li><b>Daily claim.</b> The G$ button (top right) &rarr; CLAIM DAILY G$. The real GoodDollar claim contract pays your daily UBI to your wallet; the server confirms the transaction and grants today's Citizen's Blessing (+25% Forge materials).</li>
      <li><b>Shard Harvest.</b> In Endless mode, pick up the &#128142; Shards for at least 30 seconds of play: each is worth 2 G$ (50 a day, 100 G$). The game-over screen says "pending"; it is paid as a Spoil after the day settles.</li>
      <li><b>Daily prizes.</b> The top 3 verified runs of the day win 1,000 / 600 / 300 G$, also paid as Spoils. See the Leaderboard.</li>
      <li><b>First-boss bounty.</b> Beat chapter 1's boss, then CLAIM in the wallet panel. The Engagement Rewards pool pays 5,000 G$ per claim and your share is 2,400, read from the contract.</li>
      <li><b>Redeeming Spoils.</b> After a day settles, the wallet panel lists your Spoils with REDEEM. The server signs a voucher and the MoonshardVault contract pays you on-chain, within its per-voucher and per-day caps.</li>
      <li><b>Spending.</b> None yet: the game only earns.</li>
    </ol>
  </div>
</main>
<script>
  var $ = function (id) { return document.getElementById(id); };
  var busy = false;
  async function refresh() {
    try {
      var res = await fetch('/dev/state');
      if (!res.ok) return;
      var s = await res.json();
      var known = function (value) { return value === null || value === undefined ? '...' : String(value); };
      $('addr').textContent = s.player;
      $('verified').textContent = s.verified === null ? '...' : s.verified ? 'yes' : 'no';
      $('verified').className = s.verified === null ? '' : s.verified ? 'yes' : 'no';
      $('g').textContent = known(s.g);
      $('celo').textContent = known(s.celo);
      $('vault').textContent = known(s.vault.g);
      $('skipped').textContent = String(Math.round(s.advancedHours / 24 * 10) / 10);
      var body = $('ledger');
      body.textContent = '';
      s.ledger.forEach(function (row) {
        var tr = document.createElement('tr');
        var what = document.createElement('td'); what.textContent = row.label;
        var amount = document.createElement('td'); amount.className = 'num ' + row.direction; amount.textContent = (row.direction === 'in' ? '+' : '-') + row.amountG;
        var block = document.createElement('td'); block.className = 'muted'; block.textContent = String(row.block);
        tr.appendChild(what); tr.appendChild(amount); tr.appendChild(block);
        body.appendChild(tr);
      });
      $('empty').style.display = s.ledger.length ? 'none' : '';
    } catch (err) { /* the launcher is restarting or stopped */ }
  }
  async function act(button, path, working) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    $('msg').textContent = working;
    try {
      var res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      var body = await res.json();
      $('msg').textContent = res.ok ? body.message : 'Did not work: ' + (body.error || res.status);
    } catch (err) {
      $('msg').textContent = 'Did not work: ' + err.message;
    }
    document.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
    busy = false;
    refresh();
  }
  $('next-day').addEventListener('click', function (e) { act(e.currentTarget, '/dev/next-day', 'Moving the clock and settling the day...'); });
  $('boss').addEventListener('click', function (e) { act(e.currentTarget, '/dev/boss-clear', 'Recording a boss clear...'); });
  $('revoke').addEventListener('click', function (e) { act(e.currentTarget, '/dev/revoke', 'Removing the verification...'); });
  refresh();
  setInterval(refresh, 2000);
</script>
</body></html>`;
}
