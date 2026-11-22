const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { rmSync } = require('node:fs');
// End-to-end test of the website + app + API together, as landlords and the support team use it.
// It starts the real server (npm run build first) with a fresh embedded database, drives Chromium at
// desktop and phone sizes, and stops the server at the end.
// Run: npm run build && node scripts/e2e-server.cjs        (ONLY=E2,E5 runs just those checks)

const PORT = Number(process.env.E2E_PORT || 8095);
const BASE = `http://localhost:${PORT}/`;
const DATA = `./.data/e2e-${Date.now()}`;
const ADMIN = { email: 'admin@keyholder.local', password: 'admin-password-123' };
const ONLY = (process.env.ONLY || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const results = [];
const ok = (tag, name, pass, note = '') => { results.push({ tag, name, pass, note }); console.log(`· ${pass ? '✓' : '✗'} ${tag} ${name}${pass ? '' : ' — ' + note}`); };
const step = async (tag, name, fn) => {
  if (ONLY.length && !ONLY.includes(name.split(' ')[0].toUpperCase())) return;
  try { const note = await fn(); ok(tag, name, true, note || ''); } catch (e) {
    const lines = String(e.message).split('\n'); const waiting = lines.find((l) => /waiting for/.test(l));
    ok(tag, name, false, (lines[0] + (waiting ? ` (${waiting.replace(/\x1b\[[0-9;]*m/g, '').trim()})` : '')).slice(0, 300));
    // SHOTS=dir: a picture of the landlord's page when a check fails.
    if (process.env.SHOTS && global.__pg) await global.__pg.screenshot({ path: `${process.env.SHOTS}/${tag}-${name.split(' ')[0]}.png` }).catch(() => {});
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Stand-ins for Plaid and the Bank of Canada (the real ones are not reached from tests) ----------------
const http = require('node:http');
const crypto = require('node:crypto');
const MOCK_PORT = PORT + 1;
const MOCK = `http://localhost:${MOCK_PORT}`;
const plaidKey = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const plaidJwk = plaidKey.publicKey.export({ format: 'jwk' });
const mock = { calls: [], items: new Map(), next: new Map(), n: 0 };
const isoToday = () => new Date().toISOString().slice(0, 10);
const mockServer = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const b = raw ? JSON.parse(raw) : {}; const path = req.url; mock.calls.push({ path, body: b }); let out;
    if (path === '/link/token/create') out = { link_token: `link-sandbox-${++mock.n}` };
    else if (path === '/item/public_token/exchange') { const k = ++mock.n; out = { access_token: `access-sandbox-${k}`, item_id: `item-${k}` }; mock.items.set(out.access_token, out.item_id); }
    else if (path === '/accounts/get') out = { accounts: [{ account_id: 'a1', name: 'Chequing', mask: '4321', subtype: 'checking', type: 'depository' }], item: {} };
    else if (path === '/transactions/sync') {
      const item = mock.items.get(b.access_token);
      const added = !b.cursor ? [
        { transaction_id: `${item}-t1`, account_id: 'a1', amount: -2000, date: isoToday(), name: 'E-TRANSFER RITA GOMEZ', merchant_name: null, pending: false },
        { transaction_id: `${item}-t2`, account_id: 'a1', amount: 120.45, date: isoToday(), name: 'TORONTO HYDRO', merchant_name: 'Toronto Hydro', pending: false },
      ] : (mock.next.get(item) ?? []);
      mock.next.delete(item);
      out = { added, modified: [], removed: [], next_cursor: `${item}-c${mock.calls.length}`, has_more: false };
    } else if (path === '/item/remove') out = { request_id: 'r' };
    else if (path === '/webhook_verification_key/get') out = { key: { ...plaidJwk, alg: 'ES256', kid: b.key_id, use: 'sig' } };
    else if (path === '/institutions/get') out = { institutions: [] };
    // The Bank of Canada's weekly 5-year GIC rate (Valet API).
    else if (path === '/valet/observations/V80691341/json?recent=1') out = { seriesDetail: {}, observations: [{ d: '2026-11-11', V80691341: { v: '2.85' } }] };
    else { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
  });
});
/** A webhook body signed the way Plaid signs it (ES256 JWT over the body's SHA-256). */
function plaidSign(body) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: 'kid-1', typ: 'JWT' });
  const claims = b64({ iat: Math.floor(Date.now() / 1000), request_body_sha256: crypto.createHash('sha256').update(body).digest('hex') });
  return `${head}.${claims}.${crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key: plaidKey.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
/** In the browser: Plaid's bank window, as if the landlord signed in at RBC. */
const stubPlaidLink = () => { window.Plaid = { create: (o) => ({ open: () => setTimeout(() => o.onSuccess('public-sandbox-xyz', { institution: { name: 'RBC Royal Bank', institution_id: 'ins_1' } }), 50), destroy: () => {} }) }; };
const go = async (pg, r) => { await pg.goto(BASE + '#/' + r); await pg.waitForTimeout(300); };
const approve = async (pg) => { await pg.locator('.slide-confirm .knob').focus(); await pg.keyboard.press('Enter'); await pg.waitForTimeout(350); };
const api = async (pg, path) => pg.evaluate(async (p) => { const r = await fetch(p, { credentials: 'same-origin' }); return { status: r.status, body: await r.json().catch(() => null) }; }, path);
const outbox = async (to) => (await (await fetch(`${BASE}api/dev/outbox?to=${encodeURIComponent(to)}`)).json());
async function until(fn, ms = 6000, what = 'condition') { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch { /* retry */ } await wait(200); } throw new Error(`timed out waiting for ${what}`); }

// The 6 signup questions, from question 1 to the plan page.
async function answerQuestions(pg) {
  await pg.waitForSelector('h1:has-text("Where is your rental property?")');
  await pg.click('text=Ontario'); await pg.click('.q-foot >> text=Next');
  await pg.click('text=2 to 5 rental units'); await pg.click('.q-foot >> text=Next');
  await pg.click('text=Interac e-Transfer'); await pg.click('.q-foot >> text=Next');
  await pg.click('text=Knowing who has paid'); await pg.click('.q-foot >> text=Next');
  await pg.click("text=I don't know what costs I can claim"); await pg.click('.q-foot >> text=Next');
  await pg.click('text=Getting paid on time'); await pg.click('.q-foot >> text=See my plan');
  await pg.waitForSelector('text=Go to dashboard');
}
let receiptPath = null;
async function receiptImage(browser) {
  if (receiptPath) return receiptPath;
  const d = new Date(); d.setDate(d.getDate() - 2);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ctx = await browser.newContext({ viewport: { width: 420, height: 760 }, deviceScaleFactor: 2 }); const r = await ctx.newPage();
  const sp = (n) => '&nbsp;'.repeat(n);
  await r.setContent(`<body style="margin:0;background:#e9e4da;display:grid;place-items:center;height:100vh"><div style="background:#fff;width:300px;padding:24px 20px;font:15px/1.5 'Courier New',monospace;color:#111;transform:rotate(-1.5deg)">
    <div style="text-align:center;font-weight:bold;font-size:20px">THE HOME DEPOT</div><div style="text-align:center">#7011 HAMILTON ON</div><br><div>${day} 14:32</div><br>
    <div>PAINT 1GAL${sp(8)}54.99</div><div>ROLLER KIT${sp(8)}21.51</div><br><div>SUBTOTAL${sp(10)}76.50</div><div>HST 13%${sp(11)}9.95</div><div style="font-weight:bold">TOTAL${sp(13)}86.45</div><div>VISA${sp(14)}86.45</div></div></body>`);
  receiptPath = require('node:path').join(require('node:os').tmpdir(), `kh-receipt-${Date.now()}.jpg`);
  await r.screenshot({ path: receiptPath, type: 'jpeg', quality: 85 }); await ctx.close();
  return receiptPath;
}
async function signIn(pg, email, password) {
  await go(pg, 'signin'); await pg.fill('#login-user', email); await pg.waitForTimeout(150);
  if (await pg.locator('#login-use-password').count()) await pg.click('#login-use-password'); // Face ID offered first on this device
  await pg.fill('#login-pass', password); await pg.click('.acct-login >> text=Sign in');
}
// ---- Two-step sign-in: an authenticator app (RFC 6238) for the test, per person ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const fromB32 = (s) => { let bits = 0, v = 0; const out = []; for (const ch of s.replace(/[^A-Z2-7]/gi, '').toUpperCase()) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totpAt = (secret, step) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = require('node:crypto').createHmac('sha1', fromB32(secret)).update(m).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };
const stepNow = () => Math.floor(Date.now() / 30000);
const apps = new Map(); // person → { secret, last, backup }
const personKey = (u) => (u.toLowerCase() === 'admin' ? ADMIN.email : u).toLowerCase();
/** The next code the app shows (never one already used; waits for the next 30 s step when needed). */
async function nextCode(key) {
  const a = apps.get(key); let s = Math.max(stepNow(), a.last + 1);
  while (s > stepNow() + 1) await new Promise((r) => setTimeout(r, 1000));
  a.last = s; return totpAt(a.secret, s);
}
/** Finishes a set-up on screen (QR step): reads the key, types the code, keeps the backup codes. */
async function finishSetUp(pg, key) {
  // The first screen offers fingerprint or face, or the app: the test uses the app.
  await pg.waitForSelector('#ts-way-app, #ts-start'); if (await pg.locator('#ts-way-app').count()) await pg.click('#ts-way-app');
  await pg.click('#ts-start'); await pg.waitForSelector('#ts-secret');
  const secret = (await pg.locator('#ts-secret').textContent()).replace(/\s/g, '');
  apps.set(key, { secret, last: stepNow() - 2, backup: [] });
  await pg.fill('#ts-setup-code', await nextCode(key)); await pg.click('#ts-confirm');
  await pg.waitForSelector('#ts-backup li');
  apps.get(key).backup = (await pg.locator('#ts-backup code').allTextContents());
  await pg.click('#ts-done');
}
/** The second step leaves "Remember this device" unticked: the tests sign in fresh each time. */
async function notNow() {}
/** The Keyholder team signs in: password, then two-step (set up the first time, as the dashboard asks). */
async function teamSignIn(pg, user, password) {
  await signIn(pg, user, password);
  const key = personKey(user);
  await pg.waitForSelector('.sp-page, #ts-code, #ts-start, #ts-way-app', { timeout: 15000 });
  if (await pg.locator('#ts-start, #ts-way-app').count()) { await finishSetUp(pg, key); }
  else if (await pg.locator('#ts-code').count()) { await pg.fill('#ts-code', await nextCode(key)); await pg.click('.two-step-form >> text=Continue'); await notNow(pg); }
  await pg.waitForSelector('.sp-page', { timeout: 15000 });
}
function watch(pg, errors, label) {
  pg.on('pageerror', (e) => errors.push(`${label} ${e.message}`));
  pg.on('console', (m) => { if (m.type() === 'error' && !/fonts|401|403|409|400|Failed to load resource/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
}

(async () => {
  rmSync(DATA, { recursive: true, force: true });
  await new Promise((r) => mockServer.listen(MOCK_PORT, r));
  const server = spawn(process.execPath, ['server-dist/index.mjs'], {
    env: { ...process.env, PORT: String(PORT), PGLITE_DIR: DATA, LOG_LEVEL: 'warn', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, KEYS_SECRET: 'e2e-keys-secret-0123456789abcdef', PLAID_BASE_URL: MOCK, BOC_BASE_URL: MOCK, DEV_TOOLS: 'on', NODE_ENV: 'development', APP_URL: `http://localhost:${PORT}` },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let b;
  try {
    await until(async () => (await fetch(`${BASE}api/health`)).ok, 20000, 'the server to start');
    b = await chromium.launch();
    for (const [vp, tag] of [[{ width: 1280, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
      const errors = [];
      const email = `alex.${tag}@landlord-e2e.ca`;
      let password = 'maple-street-48';
      const ctxA = await b.newContext({ viewport: vp, acceptDownloads: true });
      const pg = await ctxA.newPage(); watch(pg, errors, 'A');
      global.__pg = pg;

      await step(tag, 'E1 The website runs with the server (accounts on the server); it reports which build it serves, for "Keyholder was updated"', async () => {
        await pg.goto(BASE); await pg.waitForSelector('.lp-hero-h');
        const s = await api(pg, '/api/session'); if (!s.body?.config) throw new Error('no session config');
        if (!/^[0-9a-f]{12}$/.test(s.body.config.build || '')) throw new Error('no build fingerprint: ' + s.body.config.build);
        return `version ${s.body.config.version} · build ${s.body.config.build}`;
      });
      await step(tag, 'E2 Signup: the account first (first and last name, email, password), then 6 questions, the plan and Go to dashboard; the 5-step tour starts', async () => {
        await go(pg, 'start'); await pg.waitForSelector('h1:has-text("Create your free account")');
        if (await pg.locator('text=Open the link (preview)').count()) throw new Error('still the simulated link');
        await pg.fill('#ob-first', 'Alex'); await pg.fill('#ob-last', 'Morgan'); await pg.fill('#ob-email', email); await pg.fill('#ob-pass', 'short');
        if (await pg.locator('.acct-signup button.btn.primary').isEnabled()) throw new Error('weak password accepted');
        await pg.fill('#ob-pass', password); await pg.click('text=Create my account');
        await pg.waitForSelector('text=Nice to meet you, Alex! Question 1 of 6');
        await answerQuestions(pg);
        if (await pg.locator('.acct-google, #ob-email').count()) throw new Error('Google or email boxes on the plan page');
        const banksOn = (await (await fetch(`${BASE}api/session`)).json()).config.banks;
        if (!banksOn && await pg.locator('.plan-six >> text=/in your bank/').count()) throw new Error('the plan promises bank checks while banks are off');
        if (tag === 'desktop') { const extra = await pg.evaluate(() => document.documentElement.scrollHeight - window.innerHeight); if (extra > 1) throw new Error(`plan page scrolls ${extra}px`); }
        await pg.click('text=Go to dashboard');
        await pg.waitForSelector('text=Start here');
        await pg.waitForSelector('.tour-card >> text=Step 1 of 5'); await pg.locator('.tour-card >> text=Skip tour').click();
        const welcome = await until(async () => (await outbox(email)).find((m) => m.kind === 'welcome'), 4000, 'welcome email');
        return welcome.subject;
      });
      await step(tag, 'E3 The new account is saved on the server', async () => {
        const st = await until(async () => { const r = await api(pg, '/api/state'); return r.body?.revision >= 1 && r.body; }, 6000, 'first save');
        if (st.data.profile.name !== 'Alex Morgan') throw new Error('name on server: ' + st.data.profile.name); return `revision ${st.revision}`;
      });
      await step(tag, 'E4 Add a property, a unit and a tenant: all saved to the account', async () => {
        await go(pg, 'today'); await pg.locator('.start-steps a.btn:has-text("Add property")').click(); await pg.waitForSelector('h1:has-text("Rentals")');
        await pg.locator('text=Add your first property').click();
        await pg.fill('#pp-nick', 'Oak house'); await pg.fill('#pp-addr', '9 Oak St'); await pg.locator('.drawer-foot >> text=Save property').click(); await pg.waitForSelector('text=Oak house');
        await pg.locator('.prop-strip').first().click(); await pg.waitForTimeout(250);
        await pg.locator('text=Add a unit').first().click(); await pg.fill('#uf-l', 'Main'); await pg.fill('#uf-r', '2000'); await pg.locator('.drawer-foot >> text=Save unit').click(); await pg.waitForSelector('.unit-row:has-text("Main")');
        await pg.locator('text=Add tenant').first().click();
        await pg.fill('#tf-n0', 'Rita Gomez'); await pg.fill('#tf-e0', `rita.${tag}@tenant-e2e.ca`);
        const first = await pg.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; });
        await pg.fill('#tf-s', first); await pg.fill('#tf-r', '2000');
        await pg.click('#tf-save'); await pg.waitForSelector('.unit-row:has-text("Rita Gomez")');
        const st = await until(async () => { const r = (await api(pg, '/api/state')).body; return r?.data?.tenants?.some((t) => t.names[0] === 'Rita Gomez') && r; }, 6000, 'tenant saved');
        return `${st.data.properties.length} property, ${st.data.tenants.length} tenant · revision ${st.revision}`;
      });
      await step(tag, 'E4b Expenses → photo of a receipt is read on the device (server security rules allow it) and saved to the account', async () => {
        const img = await receiptImage(b);
        await go(pg, 'expenses'); await pg.locator('.page-head >> text=Add an expense').click();
        await pg.locator('#ex-photo').setInputFiles(img);
        await pg.waitForSelector('.read-note', { timeout: 90000 });
        if ((await pg.inputValue('#ex-amt')) !== '86.45' || (await pg.inputValue('#ex-vendor')) !== 'Home Depot') throw new Error(`read: ${await pg.inputValue('#ex-amt')} ${await pg.inputValue('#ex-vendor')}`);
        await pg.locator('.drawer-foot >> text=Save').click();
        await until(async () => (await api(pg, '/api/state')).body?.data?.expenses?.some((e) => e.vendor === 'Home Depot' && e.amount === 8645 && e.receiptImage), 6000, 'expense saved with its photo');
      });
      await step(tag, 'E5 Mark rent paid and send the receipt: the tenant gets it by email', async () => {
        const st = (await api(pg, '/api/state')).body.data;
        const row = () => pg.locator('.rent-row', { hasText: 'Rita' });
        await go(pg, 'today'); await row().locator('text=Prepare lease').click(); await pg.waitForTimeout(200); await approve(pg);
        await row().locator('.row-act button.btn', { hasText: /^Inspection$/ }).click(); await pg.waitForTimeout(200); await approve(pg);
        await go(pg, 'rent/tenant/' + st.tenants[0].id); await pg.click('.page-head >> text=Confirm rent'); await pg.locator('.drawer-foot >> text=Mark paid').click(); await pg.waitForTimeout(300);
        await go(pg, 'today'); await pg.locator('.rent-row', { hasText: 'Rita' }).locator('text=Send receipt').click();
        const mail = await until(async () => (await outbox(`rita.${tag}@tenant-e2e.ca`)).find((m) => m.kind === 'receipt'), 8000, 'receipt email');
        if (!/Amount: \$2,000\.00/.test(mail.text_body)) throw new Error('receipt text: ' + mail.text_body.slice(0, 120));
        return mail.subject;
      });
      await step(tag, 'E5b No pretend bank on the live site: one left from before is removed with its made-up deposit and the rent it marked paid (noted in the history); Settings says Coming soon', async () => {
        const cur = (await api(pg, '/api/state')).body; const d = cur.data; const lease = d.leases[0];
        d.banks = [{ id: 'bank-x', bank: 'RBC Royal Bank', accountMask: '•••• 1234', status: 'connected', lastSync: new Date().toISOString() }];
        d.payments.push({ id: 'pay-fake', leaseId: lease.id, date: '2026-11-02', amount: 99900, method: 'etransfer', period: '2026-11', source: 'bank', createdAt: new Date().toISOString() });
        d.txns.push({ id: 'txn-fake', source: 'bank', date: '2026-11-02', amount: 99900, payer: 'Made Up', memo: '', status: 'matched', bankId: 'bank-x', paymentId: 'pay-fake' });
        const put = await pg.evaluate(async (body) => (await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Keyholder': '1' }, body: JSON.stringify(body) })).status, { baseRevision: cur.revision, data: d });
        if (put !== 200) throw new Error('save ' + put);
        await pg.reload(); await pg.waitForSelector('.rent-row');
        const after = await until(async () => { const x = (await api(pg, '/api/state')).body.data; return !x.banks.length && !x.txns.some((t) => t.source === 'bank') && !x.payments.some((p) => p.id === 'pay-fake') && x; }, 8000, 'clean-up saved');
        const log = JSON.stringify(after.audit); if (!/Practice bank connection removed/.test(log) || !/Rent un-marked/.test(log)) throw new Error('not in the history');
        // Banks off: "Coming soon". Once Plaid is on (the phone run comes after E27), the real connection is offered instead.
        const banksOn = (await (await fetch(`${BASE}api/session`)).json()).config.banks;
        await go(pg, 'settings#rent-tracking');
        if (!banksOn) {
          await pg.waitForSelector('#rent-tracking >> text=Coming soon');
          if (!(await pg.locator('#rt-bank').isDisabled())) throw new Error('the bank choice can still be clicked');
        } else await pg.waitForSelector('#rt-bank:not([disabled])');
      });
      await step(tag, 'E6 Settings shows the account and that it is saved', async () => {
        await go(pg, 'settings'); await pg.waitForSelector(`text=${email}`); await pg.waitForSelector('.save-status');
        return (await pg.locator('.save-status').textContent()).trim();
      });
      const top = tag === 'phone' ? '.mobile-top' : '.top-tools.desk';
      await step(tag, 'E6b Top right: the Settings icon opens Settings', async () => {
        await go(pg, 'today'); await pg.locator(`${top} [aria-label="Settings"]`).click(); await pg.waitForSelector('h1:has-text("Your Keyholder")');
      });
      await step(tag, 'E7 Settings → Sign out (small icon at the top right): back to the website, and the data leaves this browser', async () => {
        await go(pg, 'today'); if (await pg.locator(`${top} [aria-label="Sign out"]`).count()) throw new Error('Sign out icon on Home');
        await go(pg, 'settings'); await pg.locator(`${top} .signout-icon`).click(); await pg.waitForSelector('.lp-hero-h');
        const local = await until(async () => { const s = await pg.evaluate(() => JSON.parse(localStorage.getItem('keyholder:v1'))); return s && s.properties.length === 0 && s; }, 5000, 'local data cleared');
        if ((await api(pg, '/api/session')).body.user) throw new Error('still signed in on the server');
        return `local properties: ${local.properties.length}`;
      });
      const ctxB = await b.newContext({ viewport: vp, acceptDownloads: true });
      const pgB = await ctxB.newPage(); watch(pgB, errors, 'B');
      await step(tag, 'E8 Wrong password is refused with a clear message', async () => {
        await signIn(pgB, email, 'not-my-password'); await pgB.waitForSelector('.acct-error'); return (await pgB.locator('.acct-error').textContent()).trim();
      });
      await step(tag, 'E9 Sign in on another device: the same properties, tenants and receipts are there', async () => {
        await signIn(pgB, email, password); await pgB.waitForSelector('.rent-row:has-text("Rita")');
        await go(pgB, 'rentals'); await pgB.waitForSelector('text=Oak house');
      });
      await step(tag, 'E9b Back from Google (fresh page load): a landlord lands on their own Home with their data', async () => {
        // The server's Google callback sets the session cookie, then the browser opens #/auth/google as a new page.
        const ctx = await b.newContext({ viewport: vp });
        const r = await ctx.request.post(`${BASE}api/auth/login`, { headers: { 'X-Keyholder': '1' }, data: { email, password } });
        if (r.status() !== 200) throw new Error('login ' + r.status());
        const p = await ctx.newPage(); watch(p, errors, 'google-return');
        await p.goto(BASE + '#/auth/google?intent=signin');
        await p.waitForSelector('.rent-row:has-text("Rita"), h1:has-text("Something went wrong")', { timeout: 15000 });
        if (await p.locator('text=Something went wrong').count()) throw new Error('error page: ' + (await p.locator('.acct-card').textContent()));
        await ctx.close();
      });
      await step(tag, 'E9c Back from Google at the start of signup (fresh page load): the questions open; Go to dashboard saves the plan to the new account', async () => {
        const ctx = await b.newContext({ viewport: vp });
        const newEmail = `gina.${tag}@landlord-e2e.ca`;
        const r = await ctx.request.post(`${BASE}api/auth/signup`, { headers: { 'X-Keyholder': '1' }, data: { name: 'Gina Lopez', email: newEmail, password: 'gina-the-landlord-1' } });
        if (r.status() !== 201) throw new Error('signup ' + r.status());
        const p = await ctx.newPage(); watch(p, errors, 'google-signup');
        await p.goto(BASE + '#/auth/google?intent=signup');
        await p.waitForSelector('.q-question, h1:has-text("Something went wrong")', { timeout: 15000 });
        if (await p.locator('text=Something went wrong').count()) throw new Error('error page: ' + (await p.locator('.acct-card').textContent()));
        await p.waitForSelector('text=Nice to meet you, Gina!');
        await answerQuestions(p); await p.click('text=Go to dashboard'); await p.waitForSelector(':is(h1, h2):has-text("Start here")');
        await until(async () => { const x = (await api(p, '/api/state')).body?.data?.profile; return x?.name === 'Gina Lopez' && x.onboarded && x.province === 'ON'; }, 6000, 'plan saved');
        await ctx.close();
      });
      await step(tag, 'E9d Signed up but stopped halfway: signing in opens the questions (also from Home)', async () => {
        const ctx = await b.newContext({ viewport: vp });
        const r = await ctx.request.post(`${BASE}api/auth/signup`, { headers: { 'X-Keyholder': '1' }, data: { name: 'Hugo Lam', email: `hugo.${tag}@landlord-e2e.ca`, password: 'hugo-the-landlord-1' } });
        if (r.status() !== 201) throw new Error('signup ' + r.status());
        const p = await ctx.newPage(); watch(p, errors, 'halfway');
        await p.request.post(`${BASE}api/auth/logout`, { headers: { 'X-Keyholder': '1' } });
        await signIn(p, `hugo.${tag}@landlord-e2e.ca`, 'hugo-the-landlord-1');
        await p.waitForSelector('h1:has-text("Where is your rental property?")');
        await go(p, 'today'); await p.waitForSelector('h1:has-text("Where is your rental property?")');
        await ctx.close();
      });
      await step(tag, 'E10 A change on one device shows on the other', async () => {
        await signIn(pg, email, password); await pg.waitForSelector('.rent-row:has-text("Rita")');
        await go(pgB, 'settings'); const box = pgB.locator('#profile-form label.check input'); const want = !(await box.isChecked());
        await box.setChecked(want); await pgB.click('#st-save');
        await until(async () => (await api(pgB, '/api/state')).body.data.profile.emailUpdates === want, 6000, 'saved on B');
        await pg.evaluate(() => window.dispatchEvent(new Event('focus')));
        await until(async () => (await pg.evaluate(() => JSON.parse(localStorage.getItem('keyholder:v1')))).profile.emailUpdates === want, 8000, 'device A updated');
      });
      await step(tag, 'E10b Signed out on the server mid-use: the change is kept and saved after signing in again', async () => {
        await go(pg, 'settings');
        await pg.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Keyholder': '1' } }));
        const box = pg.locator('#profile-form label.check input'); const want = !(await box.isChecked()); global.__e10b = want;
        await box.setChecked(want); await pg.click('#st-save');
        await pg.waitForSelector('text=You were signed out', { timeout: 8000 });
        await signIn(pg, email, password); await pg.waitForSelector('.rent-row:has-text("Rita")');
        await until(async () => (await api(pg, '/api/state')).body?.data?.profile?.emailUpdates === global.__e10b, 8000, 'change saved after signing in');
      });
      await step(tag, 'E11 Help (side menu; phones: More) → Write to us opens its own popup and reaches the support inbox', async () => {
        if (tag === 'phone') { await go(pg, 'more'); await pg.locator('.more-list .help-btn').click(); } else { await go(pg, 'today'); await pg.locator('.rail-foot .help-btn').click(); }
        await pg.locator('.acct-modal button:has-text("Write to us")').click(); await pg.waitForSelector('#contact-title');
        if (await pg.locator('#help-title').count()) throw new Error('Help is still open behind it');
        await pg.fill('#ct-subject', `Question from ${tag}`); await pg.fill('#ct-message', 'How do I add a second property?');
        await pg.locator('.contact-form >> text=Send').click(); await pg.waitForSelector('text=A person on our team will reply');
        await pg.locator('.contact-card >> text=Done').click(); if (await pg.locator('.acct-modal').count()) throw new Error('popup still open');
        await until(async () => (await outbox(email)).find((m) => m.kind === 'ticket-ack'), 4000, 'acknowledgement email');
      });
      await step(tag, 'E12 Forgot password: the email link sets a new password and signs in', async () => {
        await go(pgB, 'settings'); await pgB.locator('.signout-icon:visible').click();
        await pgB.waitForSelector('.lp-hero-h');
        await go(pgB, 'signin'); await pgB.locator('text=Forgot your password?').click(); await pgB.fill('#forgot-email', email); await pgB.click('text=Send the link');
        await pgB.waitForSelector('text=Check your email');
        const mail = await until(async () => (await outbox(email)).find((m) => m.kind === 'reset'), 4000, 'reset email');
        const link = mail.text_body.match(/https?:\/\/\S+/)[0];
        await pgB.goto(link); await pgB.fill('#new-pass', 'brand-new-password-1'); await pgB.click('text=Save and sign in');
        await pgB.waitForSelector('.rent-row:has-text("Rita")');
        password = 'brand-new-password-1';
      });
      await step(tag, 'E13 Download my data', async () => {
        await go(pgB, 'settings/data');
        const [dl] = await Promise.all([pgB.waitForEvent('download'), pgB.locator('text=Download my data').click()]);
        return dl.suggestedFilename();
      });
      await step(tag, 'E14 No demo on the live site: test / test is refused', async () => {
        const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage(); watch(p, errors, 'demo');
        await signIn(p, 'test', 'test'); await p.waitForSelector('.acct-error');
        if (await p.locator('.rent-row, .sample-banner').count()) throw new Error('the demo opened');
        const s = await api(p, '/api/session'); if (s.body.user) throw new Error('demo created a session'); await ctx.close();
      });
      const ctxC = await b.newContext({ viewport: vp }); const ad = await ctxC.newPage(); watch(ad, errors, 'admin');
      await step(tag, 'E15 A real admin signs in to the live support dashboard, and only sees that', async () => {
        await teamSignIn(ad, ADMIN.email, ADMIN.password);
        if (tag === 'desktop') await ad.waitForSelector('.sp-sample.live');
        await go(ad, 'support/customers'); await ad.waitForSelector(`text=${email}`);
        for (const r of ['today', 'rentals', 'settings']) {
          await go(ad, r); await ad.waitForSelector('.sp-page');
          const h = await ad.evaluate(() => location.hash); if (!h.startsWith('#/support')) throw new Error(`${r} opened ${h}`);
          if (await ad.locator('.sample-banner, .rent-row').count()) throw new Error('a landlord dashboard showed for the team');
        }
      });
      await step(tag, 'E15c Team & settings → Your password: change it, sign in with the new one, change it back', async () => {
        const change = async (from, to) => {
          await go(ad, 'support/team'); await ad.fill('#my-pw-cur', from); await ad.fill('#my-pw-new', to);
          await ad.locator('#my-password >> text=Change password').click(); await ad.waitForSelector('#my-password >> text=Password changed');
        };
        await change(ADMIN.password, 'new-team-password-9');
        const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
        await teamSignIn(p, 'admin', 'new-team-password-9'); await ctx.close();
        await change('new-team-password-9', ADMIN.password);
      });
      await step(tag, 'E16 The team replies to the request: the landlord gets the reply by email', async () => {
        await go(ad, 'support/inbox'); await ad.locator('.sp-tickets a', { hasText: `Question from ${tag}` }).click(); await ad.waitForSelector('.sp-thread');
        await ad.locator('.sp-reply textarea').fill('Open Rentals and tap Add property.'); await ad.locator('.sp-reply-foot .btn.primary').click();
        await ad.waitForSelector('.sp-head >> text=Waiting on them');
        await until(async () => (await outbox(email)).find((m) => m.kind === 'ticket-reply'), 5000, 'reply email');
        await go(ad, 'support/privacy'); await ad.waitForSelector('.ledger >> text=Reply sent');
      });
      await step(tag, 'E17 An announcement from the team shows on everyone\'s website', async () => {
        await go(ad, 'support/announcements'); await ad.fill('.sp-card textarea', `Welcome to the live Keyholder (${tag})`);
        await ad.locator('.seg[aria-label="Show on"] >> text=Both').click(); await ad.locator('.sp-card .btn.primary', { hasText: 'Post' }).click();
        await until(async () => (await (await fetch(`${BASE}api/announcements`)).json()).some((a) => a.text.includes(tag)), 5000, 'announcement saved');
        const ctx = await b.newContext({ viewport: vp }); const v = await ctx.newPage();
        await v.goto(BASE + '#/welcome'); await v.waitForSelector(`.announce.website >> text=Welcome to the live Keyholder (${tag})`); await ctx.close();
        await go(ad, 'support/announcements'); await ad.locator('.sp-rows li', { hasText: `(${tag})` }).locator('text=Hide').click();
        await until(async () => !(await (await fetch(`${BASE}api/announcements`)).json()).some((a) => a.text.includes(tag)), 5000, 'announcement hidden');
      });
      await step(tag, 'E17b The username "admin" with the team password opens the live dashboard', async () => {
        const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage(); watch(p, errors, 'admin-username');
        await teamSignIn(p, 'admin', ADMIN.password);
        await go(p, 'support/customers'); await p.waitForSelector(`text=${email}`); await ctx.close();
      });
      // ---------------- The super user (ADMIN_EMAIL): price, promotions, banks, API keys, the team ----------------
      await step(tag, 'E21 Super user → Price & promotions: a new price shows on the website; a promo code is added and paused', async () => {
        const groups = await ad.locator('.sp-nav-group > p').allTextContents();
        if (!groups.includes('Super user')) throw new Error('no Super user group: ' + groups.join(', '));
        await go(ad, 'support/pricing'); await ad.fill('#sp-price', '9.50'); await ad.locator('#price >> text=Save price').click();
        await until(async () => (await (await fetch(`${BASE}api/pricing`)).json()).unitCents === 950, 5000, 'price saved');
        const ctx = await b.newContext({ viewport: vp }); const v = await ctx.newPage();
        await v.goto(BASE + '#/welcome/pricing'); await v.waitForSelector('.lp-price.best >> text=$9.50'); await ctx.close();
        const code = `E2E${tag.toUpperCase()}`;
        await ad.fill('#promo-code', code); await ad.fill('#promo-value', '20'); await ad.fill('#promo-months', '2'); await ad.locator('#promotions >> text=Add code').click();
        await ad.waitForSelector(`#promotions li:has-text("${code}") >> text=Active`);
        await ad.locator(`#promotions li:has-text("${code}") >> text=Pause`).click(); await ad.waitForSelector(`#promotions li:has-text("${code}") >> text=Paused`);
        await ad.fill('#sp-price', '8'); await ad.locator('#price >> text=Save price').click();
        await until(async () => (await (await fetch(`${BASE}api/pricing`)).json()).unitCents === 800, 5000, 'price back');
      });
      await step(tag, 'E21b Comparison rates: the 5-year GIC comes from the Bank of Canada by itself; the super user sets savings and the stock index fund; the app gets them', async () => {
        const rates = async () => (await (await fetch(`${BASE}api/session`)).json()).config.benchmarks;
        await until(async () => (await rates()).gic.pct === 2.85, 15000, 'the Bank of Canada rate read by the server');
        await go(ad, 'support/pricing'); await ad.waitForSelector('#benchmarks >> text=5-year GIC: 2.85%');
        await ad.waitForSelector('#benchmarks >> text=/Bank of Canada.*week of Nov 11, 2026/');
        const savings = tag === 'phone' ? '3.4' : '3.2';
        await ad.fill('#bm-savings', savings); await ad.fill('#bm-index', '7'); await ad.locator('#benchmarks >> text=Save rates').click();
        await until(async () => { const r = await rates(); return r.savings.pct === Number(savings) && r.index.pct === 7 && r.gic.pct === 2.85; }, 5000, 'rates saved');
        await ad.waitForSelector(`#benchmarks >> text=High-interest savings: ${savings}%`);
      });
      await step(tag, 'E23 Super user → Connections: a key is saved with the password, shown only as its last 4, and email is tested', async () => {
        await go(ad, 'support/connections'); await ad.waitForSelector('#conn-stripe');
        if (await ad.locator('#keys-secret').count()) throw new Error('asks for KEYS_SECRET although it is set');
        const last4 = tag === 'phone' ? '5432' : '9876';
        await ad.fill('#key-stripe-secretKey', `sk_test_e2e_${tag}_${last4}`); await ad.fill('#conn-password', 'not-my-password');
        await ad.locator('.sp-conn-save >> text=Save 1 change').click(); await ad.waitForSelector('.sp-conn-save .acct-error');
        await ad.fill('#conn-password', ADMIN.password); await ad.locator('.sp-conn-save >> text=Save 1 change').click();
        await ad.waitForSelector(`#conn-stripe >> text=•••• ${last4}`); await ad.waitForSelector('#conn-password:disabled'); await ad.waitForSelector('#conn-stripe >> text=Saved here');
        if ((await ad.content()).includes(`sk_test_e2e_${tag}_${last4}`)) throw new Error('the full key is on the page');
        await ad.locator('#conn-email >> text=Test').click(); await ad.waitForSelector('#conn-email >> text=Sending is off');
      });
      await step(tag, 'E24 The super user invites an Admin: the Admin has no Super user pages and cannot change the team', async () => {
        const mail = `ava.${tag}@keyholder-e2e.ca`;
        await go(ad, 'support/team');
        const form = ad.locator('.sp-addform');
        await form.locator('input').nth(0).fill('Ava Admin'); await form.locator('input').nth(1).fill(mail); await form.locator('select').selectOption('Admin');
        await form.locator('text=Invite').click();
        const invite = await until(async () => (await outbox(mail)).find((m) => m.kind === 'invite'), 5000, 'invite email');
        const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage(); watch(p, errors, 'admin-invite');
        await p.goto(invite.text_body.match(/https?:\/\/\S+/)[0]); await p.fill('#new-pass', 'ava-the-admin-2026'); await p.click('text=Save and sign in');
        // A new team member sets up two-step sign-in before the dashboard opens.
        await p.waitForSelector('#ts-start, #ts-way-app'); await finishSetUp(p, mail.toLowerCase());
        await p.waitForSelector('.sp-page');
        if ((await p.locator('.sp-nav-group > p').allTextContents()).includes('Super user')) throw new Error('an Admin sees the Super user pages');
        await go(p, 'support/team'); await p.waitForSelector('text=Only the super user adds, changes or removes team members');
        await go(p, 'support/pricing'); await p.waitForSelector('#price >> text=Only the super user can change this');
        const r = await p.evaluate(async () => (await fetch('/api/admin/connections')).status); if (r !== 403) throw new Error('connections ' + r);
        await ctx.close();
      });
      await step(tag, 'E25 Overview map: real landlords by city (never street addresses); Sign out from the dashboard works on this screen', async () => {
        await go(ad, 'support'); await ad.waitForSelector('.sp-lmap svg');
        if ((await ad.locator('.sp-lmap-dot').count()) < 1) throw new Error('no dots');
        await ad.waitForSelector('.sp-lmap-top >> text=Toronto, ON');
        if ((await ad.locator('.sp-lmap').textContent()).includes('Oak St')) throw new Error('a street address is shown');
        const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
        await teamSignIn(p, 'admin', ADMIN.password);
        await p.locator('.sp-rail-foot >> text=Sign out').click(); await p.waitForSelector('.lp-hero-h'); await ctx.close();
      });
      await step(tag, 'E26 Without the Google Places key the address box stays a plain box (no suggestions, nothing sent anywhere)', async () => {
        if ((await api(pg, '/api/session')).body.config.addressLookup) throw new Error('address lookup on without a key');
        await go(pg, 'rentals'); await pg.locator('button:has-text("Add property"), a:has-text("Add property")').first().click(); await pg.waitForSelector('#pp-addr');
        await pg.locator('#pp-addr').pressSequentially('100 Queen St', { delay: 20 }); await pg.waitForTimeout(800);
        if (await pg.locator('.addr-list').count()) throw new Error('suggestions shown');
        await pg.locator('.drawer >> text=Cancel').click();
      });
      await step(tag, 'E27 Super user saves the Plaid keys on Connections (Test works): bank connections turn on; there is no property values slot', async () => {
        const on = async () => { const c = (await (await fetch(`${BASE}api/session`)).json()).config; return c.banks; };
        if (!(await on())) {
          await go(ad, 'support/connections'); await ad.waitForSelector('#conn-plaid');
          await ad.fill('#key-plaid-clientId', 'e2e-plaid-client'); await ad.fill('#key-plaid-secret', 'e2e-plaid-secret-123'); await ad.selectOption('#key-plaid-env', 'sandbox');
          await ad.fill('#conn-password', ADMIN.password); await ad.locator('.sp-conn-save .btn.primary').click();
          await ad.waitForSelector('#conn-plaid >> text=Keys saved');
        } else { await go(ad, 'support/connections'); await ad.waitForSelector('#conn-plaid >> text=Keys saved'); }
        await ad.locator('#conn-plaid button', { hasText: /^Test$/ }).click(); await ad.waitForSelector('#conn-plaid >> text=Plaid accepts these keys');
        if (await ad.locator('#conn-avm').count()) throw new Error('a property values slot is still listed');
        await until(on, 5000, 'banks on');
      });
      await step(tag, 'E28 The landlord connects a bank in Plaid\'s window: the bank shows, its deposit and bill arrive and are looked at', async () => {
        // E12's password reset signed this browser out (a reset ends every other sign-in): sign in again.
        await pg.addInitScript(stubPlaidLink); await pg.reload();
        if (!(await api(pg, '/api/session')).body.user) await signIn(pg, email, password);
        await go(pg, 'today'); await pg.waitForSelector('.rent-row');
        await go(pg, 'settings#rent-tracking'); await pg.click('#rt-bank');
        await pg.waitForSelector('#plaid-go'); await pg.click('#plaid-go');
        await pg.waitForSelector('#rent-tracking >> text=RBC Royal Bank');
        await until(async () => { const d = (await api(pg, '/api/state')).body.data; const mine = d.txns.filter((t) => t.id.startsWith('pl-')); return mine.length >= 2 && mine.every((t) => t.checked || t.status !== 'new'); }, 10000, 'bank transactions saved and looked at');
      });
      await step(tag, 'E29 Plaid\'s webhook brings a new transaction right away (signed); a forged one is refused; Keyholder never asks the bank to refresh', async () => {
        const item = [...mock.items.values()].pop();
        mock.next.set(item, [{ transaction_id: `${item}-t9`, account_id: 'a1', amount: -75, date: isoToday(), name: 'E-TRANSFER PARKING', merchant_name: null, pending: false }]);
        const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: item });
        const forged = await fetch(`${BASE}api/plaid/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'plaid-verification': plaidSign(body + ' ') }, body });
        if (forged.status !== 401) throw new Error('forged webhook ' + forged.status);
        const r = await fetch(`${BASE}api/plaid/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'plaid-verification': plaidSign(body) }, body });
        if (r.status !== 200) throw new Error('webhook ' + r.status);
        await until(async () => (await api(pg, '/api/state')).body.data.txns.some((t) => t.id === `pl-${item}-t9`), 6000, 'the new transaction');
        if (mock.calls.some((c) => c.path.includes('refresh'))) throw new Error('asked the bank to refresh');
      });
      await step(tag, 'E30 Worth is what you paid, less what is owed; your own estimate replaces what you paid; Keyholder estimates nothing', async () => {
        const prop = (await api(pg, '/api/state')).body.data.properties.find((x) => x.nickname === 'Oak house');
        await pg.reload(); if (!(await api(pg, '/api/session')).body.user) await signIn(pg, email, password);
        await go(pg, `rent/property/${prop.id}/value`);
        if (!prop.purchasePrice) {
          // One path: step 1 is the only button; step 2 waits, greyed.
          await pg.waitForSelector('#level-steps .ls-step.now >> text=Add what you paid'); await pg.waitForSelector('#level-steps .ls-step.later >> text=Do step 1 first');
          if ((await pg.locator('text=Add what you paid').count()) > 3) throw new Error('asked more than once');
          await pg.click('#add-paid');
          await pg.fill('#sv-price', '500000'); await pg.fill('#sv-date', '2020-05-01'); await pg.fill('#sv-owed', '300000');
          await pg.locator('.drawer-foot .btn.primary').click();
        }
        await pg.waitForSelector('#worth >> text=$500,000'); await pg.waitForSelector('#worth >> text=What you paid in 2020');
        await pg.waitForSelector('#worth .figure.in >> text=$200,000');
        if (await pg.locator('text=/Repliers|Sample AVM|price trend|Nearby sales|Worth about/').count()) throw new Error('an estimate is still shown');
        // Your own estimate (an appraisal) is used instead.
        await pg.click('#add-own'); await pg.fill('#oe-l', '560000'); await pg.click('#oe-save');
        await pg.waitForSelector('#worth >> text=$560,000'); await pg.waitForSelector('#worth .figure.in >> text=$260,000');
        await pg.waitForSelector('#worth >> text=/up \\$60,000/');
        await until(async () => (await api(pg, '/api/state')).body.data.valuations.some((v) => v.source === 'owner' && v.likely === 56000000), 6000, 'the estimate saved');
      });
      await step(tag, 'E30b An estimate saved by an earlier version is removed when the account opens; a new deploy shows "Keyholder was updated" with Reload', async () => {
        const cur = (await api(pg, '/api/state')).body; const d = cur.data;
        const prop = d.properties.find((x) => x.nickname === 'Oak house');
        d.valuations.push({ id: 'v-old-avm', propertyId: prop.id, date: isoToday(), source: 'avm', low: 70000000, likely: 75000000, high: 80000000, confidence: 'medium', note: 'Repliers Estimates' });
        const put = await pg.evaluate(async (body) => (await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Keyholder': '1' }, body: JSON.stringify(body) })).status, { baseRevision: cur.revision, data: d });
        if (put !== 200) throw new Error('save ' + put);
        await pg.reload(); await go(pg, 'today');
        await until(async () => !(await api(pg, '/api/state')).body.data.valuations.some((v) => v.source === 'avm'), 8000, 'the old estimate removed');
        // The server now serves a new build: the open tab offers to reload.
        await pg.route('**/api/session', async (route) => { const r = await route.fetch(); const b = await r.json(); b.config.build = 'ffffffffffff'; await route.fulfill({ response: r, json: b }); });
        await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await pg.waitForSelector('.update-bar >> text=Keyholder was updated', { timeout: 6000 });
        await pg.unroute('**/api/session');
        await pg.locator('.update-bar button', { hasText: 'Reload' }).click(); await pg.waitForLoadState('load'); await pg.waitForSelector('.rent-card, .rent-list, .start-steps');
        if (await pg.locator('.update-bar').count()) throw new Error('the bar is still shown after reloading');
      });
      await step(tag, 'E31 Disconnect removes the bank at Plaid (no more billing) and from Settings', async () => {
        const removes = mock.calls.filter((c) => c.path === '/item/remove').length;
        await go(pg, 'settings#rent-tracking'); await pg.locator('#rent-tracking .bank-chip:has-text("RBC Royal Bank") .chip-x').click();
        await until(async () => !(await api(pg, '/api/state')).body.data.banks.some((b) => b.bank === 'RBC Royal Bank'), 6000, 'bank removed');
        if (mock.calls.filter((c) => c.path === '/item/remove').length !== removes + 1) throw new Error('not removed at Plaid');
      });
      await step(tag, 'E32 Late rent: the N4 is the Landlord and Tenant Board\'s own form, filled in; approved by email, it goes to the tenant attached', async () => {
        // The landlord's phone, the rental's postal code, rent owing and the tenant's consent to notices by email.
        const cur = (await api(pg, '/api/state')).body; const d = cur.data;
        const lease = d.leases.find((l) => d.tenants.find((t) => t.id === l.tenantId)?.names[0] === 'Rita Gomez');
        const t = d.tenants.find((x) => x.id === lease.tenantId); t.emailConsent = true; t.emailConsentDate = isoToday();
        const unit = d.units.find((u) => u.id === lease.unitId); d.properties.find((p) => p.id === unit.propertyId).postalCode = 'M5V 1A1';
        d.profile.phone = '416-555-0199';
        const start = new Date(); start.setMonth(start.getMonth() - 3); lease.start = start.toISOString().slice(0, 8) + '01'; delete lease.paidThrough; lease.standingChecked = true;
        d.payments = d.payments.filter((p) => p.leaseId !== lease.id);
        const put = await pg.evaluate(async (body) => (await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Keyholder': '1' }, body: JSON.stringify(body) })).status, { baseRevision: cur.revision, data: d });
        if (put !== 200) throw new Error('save ' + put);
        await pg.reload(); await go(pg, 'rentals'); await pg.locator('.unit-row:has-text("Rita") >> text=Late rent options').click();
        await pg.locator('.late-steps li:has-text("N4") >> text=Prepare').click();
        await pg.waitForSelector('.letter >> text=Official form'); await pg.waitForSelector('.official-note >> text=N4 (2026/09)');
        // The filled form opens (a PDF made by the server from the official file).
        const [tab, res] = await Promise.all([pg.waitForEvent('popup'), pg.waitForResponse((r) => r.url().endsWith('/api/forms/on-n4/pdf')), pg.click('#fw-open-form')]);
        if (res.status() !== 200 || res.headers()['content-type'] !== 'application/pdf') throw new Error('the filled form ' + res.status());
        await tab.close().catch(() => {});
        const pdf = await pg.evaluate(async () => { const r = await fetch('/api/forms/on-n4/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Keyholder': '1' }, body: JSON.stringify({ values: { 'form1[0].sfrmForm[0].PartyAddressInfo[0].txtLandlord[0]': 'Test' } }) }); const b = await r.arrayBuffer(); return { type: r.headers.get('content-type'), head: new TextDecoder().decode(b.slice(0, 5)), size: b.byteLength }; });
        if (pdf.type !== 'application/pdf' || pdf.head !== '%PDF-' || pdf.size < 100000) throw new Error('not a PDF: ' + JSON.stringify(pdf));
        const bad = await pg.evaluate(async () => (await fetch('/api/forms/on-n4/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Keyholder': '1' }, body: JSON.stringify({ values: { 'not.a.field': 'x' } }) })).status);
        if (bad !== 422) throw new Error('a made-up field was accepted: ' + bad);
        await pg.waitForTimeout(200); if (!(await pg.locator('.slide-confirm').count())) throw new Error('checks failed: ' + (await pg.locator('.checks li.bad').allTextContents()).join(' | '));
        await approve(pg);
        const n = await until(async () => (await api(pg, '/api/state')).body.data.notices.find((x) => x.kind === 'N4' && x.official && x.emailedAt), 15000, 'the notice saved with its official form and emailed');
        if (n.official.version !== 'N4 (2026/09)' || !n.official.values['form1[0].sfrmForm[0].PartyAddressInfo[0].txtPostalCode[0]']) throw new Error('form values ' + JSON.stringify(n.official).slice(0, 200));
        const mails = await outbox(`rita.${tag}@tenant-e2e.ca`);
        const m = mails.find((x) => x.kind === 'notice');
        if (!m || m.attached_form !== 'on-n4' || !/^N4 - Rita Gomez - .*\.pdf$/.test(m.attached_file)) throw new Error('email ' + JSON.stringify(m));
        // The served form can be opened again from the notice list.
        await go(pg, 'paperwork/notices'); await pg.waitForSelector('.row:has-text("N4") .official-pdf');
      });
      await step(tag, 'E33 Two-step sign-in (optional for landlords): Home suggests it; Settings turns it on with a QR code and backup codes; the next sign-in asks for the code; a wrong code is refused', async () => {
        await go(pg, 'today'); await pg.waitForSelector('#two-step-nudge >> text=Turn on two-step sign-in');
        await pg.locator('#two-step-nudge a.btn').click(); await pg.waitForSelector('#two-step #ts-turn-on');
        await pg.click('#ts-turn-on'); await finishSetUp(pg, email.toLowerCase());
        await pg.waitForSelector('#ts-chip-codes >> text=Backup · 10');
        if (await pg.locator('#two-step-nudge').count()) throw new Error('nudge still shown');
        await go(pg, 'today'); if (await pg.locator('#two-step-nudge').count()) throw new Error('Home still suggests it');
        const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage(); watch(p, errors, 'two-step');
        await signIn(p, email, password); await p.waitForSelector('#ts-code');
        await p.fill('#ts-code', '000000'); await p.click('.two-step-form >> text=Continue'); await p.waitForSelector('.two-step-form .acct-error >> text=not right');
        await p.fill('#ts-code', await nextCode(email.toLowerCase())); await p.click('.two-step-form >> text=Continue'); await notNow(p);
        await p.waitForSelector('.rent-row, .rent-card, .start-steps');
        // A backup code works as well (once), and "Remember this device" skips the second step next time.
        const q = await (await b.newContext({ viewport: vp })).newPage(); watch(q, errors, 'two-step-backup');
        await signIn(q, email, password); await q.waitForSelector('#ts-code');
        await q.fill('#ts-code', apps.get(email.toLowerCase()).backup[0]); await q.check('#ts-remember'); await q.click('.two-step-form >> text=Continue');
        await q.waitForSelector('.rent-row, .rent-card, .start-steps');
        const me = (await api(q, '/api/session')).body.user; if (!me.twoStep || me.backupCodesLeft !== 9) throw new Error('session: ' + JSON.stringify(me));
        const devs = (await api(q, '/api/auth/devices')).body; if (!Array.isArray(devs) || devs.length !== 1 || !devs[0].thisDevice) throw new Error('remembered: ' + JSON.stringify(devs));
        // Signed out and in again on that browser: no second step.
        await q.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Keyholder': '1' } }));
        await q.evaluate(() => localStorage.clear()); await q.goto(BASE + '#/welcome'); await q.reload(); await q.waitForSelector('.lp-hero-h');
        await signIn(q, email, password); await q.waitForSelector('.rent-row, .rent-card, .start-steps', { timeout: 15000 });
        if (await q.locator('#ts-code').count()) throw new Error('asked for the code on a remembered device');
        // Forget it in Settings: the next sign-in asks again.
        await go(q, 'settings#two-step'); await q.click('#ts-chip-remembered'); await q.locator('#ts-remembered li >> text=Forget').click(); await q.waitForSelector('#ts-remembered >> text=None.');
        await q.context().close(); await ctx.close();
      });
      await step(tag, 'E34 Fingerprint or face: added in Settings, then used at sign-in instead of a code', async () => {
        const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage(); watch(p, errors, 'passkey');
        // A built-in fingerprint reader that always says yes (Chromium's virtual authenticator).
        const cdp = await ctx.newCDPSession(p); await cdp.send('WebAuthn.enable');
        await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
        await signIn(p, email, password); await p.waitForSelector('#ts-code');
        if (await p.locator('#ts-biometric').count()) throw new Error('fingerprint offered before any device was added');
        await p.fill('#ts-code', await nextCode(email.toLowerCase())); await p.click('.two-step-form >> text=Continue'); await notNow(p);
        await p.waitForSelector('.rent-row, .rent-card, .start-steps');
        // Signed in with a code on a device that can use fingerprint or face: it is offered once.
        await p.waitForSelector('#bio-offer >> text=next time?'); await p.click('#bio-offer-no');
        // An hour later, adding it asks to confirm it is you (password here) before the fingerprint prompt.
        await p.evaluate(() => fetch('/api/dev/age-session', { method: 'POST', headers: { 'X-Keyholder': '1' } }));
        await go(p, 'settings#two-step'); await p.click('#ts-chip-bio'); await p.waitForSelector('#ts-devices >> text=No device yet');
        await p.click('#ts-add-device'); await p.waitForSelector('#confirm-it');
        await p.fill('#ci-pass', 'not-my-password'); await p.click('#ci-go'); await p.waitForSelector('#confirm-it .acct-error >> text=not right');
        await p.fill('#ci-pass', password); await p.click('#ci-go');
        // Safari opens Face ID only straight after a tap: the button now says to tap once more.
        await p.waitForSelector('#ts-add-device >> text=Now tap to scan'); await p.click('#ts-add-device');
        await p.waitForSelector('#ts-devices .two-step-devices li'); await p.keyboard.press('Escape');
        await p.waitForSelector('#ts-chip-bio >> text=Face/finger · 1');
        await p.click('#ts-chip-app'); await p.waitForSelector('#ts-app >> text=Set up.'); await p.keyboard.press('Escape');
        // Another device (no fingerprint or face added there): the code leads, with a note; nothing is offered first.
        const other = await (await b.newContext({ viewport: vp })).newPage(); watch(other, errors, 'other-device');
        const ocdp = await other.context().newCDPSession(other); await ocdp.send('WebAuthn.enable');
        await ocdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
        await signIn(other, email, password); await other.waitForSelector('#ts-elsewhere >> text=One code here');
        if (await other.locator('button.btn#ts-biometric').count()) throw new Error('Face ID offered first on a device without it');
        // No app at hand: a code by email signs in; then one tap adds Face ID on this device.
        await other.click('#ts-email'); await other.waitForSelector('#ts-mailed');
        const mail = (await outbox(email)).find((m) => m.kind === 'two-step-code'); if (!mail) throw new Error('no code email');
        await other.fill('#ts-code', mail.subject.slice(0, 6)); await other.click('.two-step-form >> text=Continue'); await notNow(other);
        await other.waitForSelector('#bio-offer'); await other.click('#bio-offer-yes'); await other.waitForSelector('#bio-offer', { state: 'detached' });
        const meO = (await api(other, '/api/session')).body.user; if (meO.passkeys !== 2) throw new Error('devices: ' + meO.passkeys);
        await other.context().close();
        // Signed out, then back in on this device: fingerprint or face leads (the account data leaves the browser, which device it is stays).
        await p.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Keyholder': '1' } }));
        await p.evaluate(() => { const keep = ['kh_passkeys_here', 'kh_passkey_emails'].map((k) => [k, localStorage.getItem(k)]); localStorage.clear(); for (const [k, v] of keep) if (v) localStorage.setItem(k, v); }); await p.goto(BASE + '#/welcome'); await p.reload(); await p.waitForSelector('.lp-hero-h');
        await signIn(p, email, password);
        await p.waitForSelector('button.btn.primary#ts-biometric'); if (await p.locator('#ts-code').count()) throw new Error('code box shown next to Face ID'); await p.waitForSelector('#ts-use-code');
        await p.click('#ts-biometric'); await notNow(p);
        await p.waitForSelector('.rent-row, .rent-card, .start-steps', { timeout: 15000 });
        // Both are set up: the app's code works too, whichever is at hand.
        await p.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Keyholder': '1' } }));
        await p.evaluate(() => { const keep = ['kh_passkeys_here', 'kh_passkey_emails'].map((k) => [k, localStorage.getItem(k)]); localStorage.clear(); for (const [k, v] of keep) if (v) localStorage.setItem(k, v); }); await p.goto(BASE + '#/welcome'); await p.reload(); await p.waitForSelector('.lp-hero-h');
        await signIn(p, email, password); await p.waitForSelector('#ts-biometric'); await p.click('#ts-use-code');
        await p.fill('#ts-code', await nextCode(email.toLowerCase())); await p.click('.two-step-form >> text=Continue'); await notNow(p);
        await p.waitForSelector('.rent-row, .rent-card, .start-steps', { timeout: 15000 });
        // Face ID alone: on this device the sign-in page has the email filled in and "Sign in with Face ID"; no password, no code.
        await p.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Keyholder': '1' } }));
        await p.evaluate(() => { const keep = ['kh_passkeys_here', 'kh_passkey_emails'].map((k) => [k, localStorage.getItem(k)]); localStorage.clear(); for (const [k, v] of keep) if (v) localStorage.setItem(k, v); }); await p.goto(BASE + '#/welcome'); await p.reload(); await p.waitForSelector('.lp-hero-h');
        await go(p, 'signin'); await p.waitForSelector('#login-bio:not([disabled])');
        if ((await p.inputValue('#login-user')).toLowerCase() !== email.toLowerCase()) throw new Error('email not filled in');
        if (await p.locator('#login-pass').count()) throw new Error('password asked before Face ID');
        await p.click('#login-bio'); await notNow(p); await p.waitForSelector('.rent-row, .rent-card, .start-steps', { timeout: 15000 });
        // Removing it leaves the app; two-step stays on.
        await go(p, 'settings#two-step'); await p.click('#ts-chip-bio'); await p.locator('#ts-devices li >> text=Remove').first().click(); await until(async () => (await p.locator('#ts-devices .two-step-devices li').count()) === 1, 8000, 'one device left');
        const me = (await api(p, '/api/session')).body.user; if (!me.twoStep || me.passkeys !== 1) throw new Error('session: ' + JSON.stringify(me));
        await ctx.close();
      });
      await step(tag, 'E34b Authenticator app set up on a phone: no QR code to scan with the same phone; an Open in app link and the key to copy', async () => {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await ctx.newPage(); watch(p, errors, 'phone-app');
        const em = `pat.${tag}@landlord-e2e.ca`;
        const r = await ctx.request.post(`${BASE}api/auth/signup`, { headers: { 'X-Keyholder': '1' }, data: { name: 'Pat Lee', email: em, password: 'birch-road-2026' } });
        if (r.status() !== 201) throw new Error('signup ' + r.status());
        await p.request.post(`${BASE}api/auth/logout`, { headers: { 'X-Keyholder': '1' } });
        await signIn(p, em, 'birch-road-2026'); await p.waitForSelector('h1:has-text("Where is your rental property?")');
        await answerQuestions(p); await p.click('text=Go to dashboard'); await p.waitForSelector(':is(h1, h2):has-text("Start here")');
        await notNow(p).catch(() => {}); if (await p.locator('.tour-card >> text=Skip tour').count()) await p.locator('.tour-card >> text=Skip tour').click();
        await go(p, 'settings#two-step'); await p.waitForSelector('#two-step #ts-turn-on'); await p.click('#ts-turn-on');
        await p.waitForSelector('#ts-way-app, #ts-start'); if (await p.locator('#ts-way-app').count()) await p.click('#ts-way-app');
        await p.click('#ts-start'); await p.waitForSelector('#ts-mobile');
        if (await p.locator('.two-step-qr').count()) throw new Error('QR code shown on a phone');
        const href = await p.locator('#ts-open-app').getAttribute('href'); if (!/^otpauth:\/\/totp\//.test(href)) throw new Error('link ' + href);
        await p.waitForSelector('#ts-copy >> text=Copy key'); await p.waitForSelector('#ts-secret');
        // Clear all data asks to confirm it is you once the sign-in is old, then clears it on the server.
        await p.keyboard.press('Escape'); await p.evaluate(() => fetch('/api/dev/age-session', { method: 'POST', headers: { 'X-Keyholder': '1' } }));
        await go(p, 'settings/data'); await p.click('#st-clear'); await p.locator('.clear-box .knob').focus(); await p.keyboard.press('Enter');
        await p.waitForSelector('#confirm-it'); await p.fill('#ci-pass', 'birch-road-2026'); await p.click('#ci-go');
        await p.waitForSelector('text=All data cleared');
        await ctx.close();
      });
      await step(tag, 'E35 The application link works: anyone opens it on a phone (no account), applies, and the landlord gets it under that unit', async () => {
        const cur = (await api(pg, '/api/state')).body; const d = cur.data;
        const slug = `e2e-${tag}-${Date.now().toString(36)}`;
        d.units.push({ id: `u-ap-${tag}`, propertyId: d.properties[0].id, label: 'Z', rent: 180000, bedrooms: 2, utilitiesIncluded: [], status: 'vacant' });
        d.listings.push({ unitId: `u-ap-${tag}`, askingRent: 180000, available: '2026-12-15', notes: 'Bright 2-bedroom', vacantSince: '2026-11-01', slug });
        const put = await pg.evaluate(async (body) => (await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Keyholder': '1' }, body: JSON.stringify(body) })).status, { baseRevision: cur.revision, data: d });
        if (put !== 200) throw new Error('save ' + put);
        // The link on Find a tenant is this site's own address.
        await pg.reload(); await go(pg, `rent/property/${d.properties[0].id}/find`); await pg.waitForSelector(`text=${BASE}apply/${slug}`);
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); watch(p, errors, 'apply');
        await p.goto(`${BASE}apply/${slug}`); await p.waitForSelector('text=Apply for Unit Z');
        await p.fill('#ap-n0', 'Sam Applicant'); await p.fill('#ap-e0', `sam.${tag}@tenant-e2e.ca`); await p.fill('#ap-p0', '416-555-0101');
        await p.fill('#ap-w0', 'City Hospital'); await p.fill('#ap-i0', '5200'); await p.fill('#ap-addr', '10 King St W, Toronto');
        if (!(await p.locator('#ap-send').isDisabled())) throw new Error('sent without consent');
        await p.check('#ap-consent'); await p.click('#ap-send'); await p.waitForSelector('#apply-sent');
        const got = await until(async () => (await api(pg, '/api/state')).body.data.applicants.find((a) => a.unitId === `u-ap-${tag}`), 8000, 'the application reached the landlord');
        if (got.names[0] !== 'Sam Applicant' || got.monthlyIncome !== 520000 || got.status !== 'new') throw new Error(JSON.stringify(got).slice(0, 200));
        // A wrong link says so.
        await p.goto(`${BASE}apply/not-a-listing`); await p.waitForSelector('text=This listing is closed');
        await ctx.close();
      });
      await step(tag, 'E18 No preview on the live site: admin / admin is refused', async () => {
        const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
        await signIn(p, 'admin', 'admin'); await p.waitForSelector('.acct-error');
        if (await p.locator('.sp-page').count()) throw new Error('the preview opened'); await ctx.close();
      });
      await step(tag, 'E19 Delete my account: password needed, then everything is gone', async () => {
        await go(pgB, 'settings/data'); await pgB.locator('text=Delete my account').first().click();
        await pgB.fill('#del-confirm', password); await pgB.locator('form.callout >> button.btn.danger').click();
        await pgB.waitForSelector('.lp-hero-h');
        const r = await fetch(`${BASE}api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Keyholder': '1' }, body: JSON.stringify({ email, password }) });
        if (r.status !== 401) throw new Error('can still sign in: ' + r.status);
      });
      await step(tag, 'E20 The other device notices it is signed out', async () => {
        await pg.reload(); await pg.waitForSelector('.lp-hero-h'); return 'back to the website';
      });
      ok(tag, 'E errors', errors.length === 0, errors.slice(0, 3).join(' | '));
      await ctxA.close(); await ctxB.close(); await ctxC.close();
    }
  } catch (e) {
    ok('setup', 'E0 could not run', false, e.message);
  } finally {
    mockServer.close();
    if (b) await b.close();
    server.kill('SIGTERM');
    await wait(500);
    rmSync(DATA, { recursive: true, force: true });
  }
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.tag.padEnd(7)} ${r.name}${r.note ? ' — ' + r.note : ''}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
