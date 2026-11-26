const { chromium } = require('playwright');
// End-to-end UX flow test: a new user from an empty start, the sample user through each tenant's journey,
// and every internal link on every page, at desktop and phone sizes.
// Run: npm run build && npx vite preview --port 4173 & node scripts/ux-flow-test.cjs
const out = process.argv[2] || '.';
const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const results = [];
// ONLY=D,E runs just those sections (letters at the start of each check's name). Progress prints as it goes.
const ONLY = (process.env.ONLY || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const want = (section) => !ONLY.length || ONLY.includes(section);
const ok = (tag, name, pass, note = '') => { results.push({ tag, name, pass, note }); console.log(`· ${pass ? '✓' : '✗'} ${tag} ${name}`); };

// A new account: the account first (email link), then the 6 questions, then Go to dashboard.
async function onboard(pg, skipTour = true) {
  await createAccount(pg);
  await answerQuestions(pg);
  await pg.click('text=Go to dashboard');
  await pg.waitForTimeout(300);
  if (skipTour) { await pg.locator('.tour-card >> text=Skip tour').click(); await pg.waitForTimeout(200); }
}
// One sign-in form: test / test opens the demo (sample properties), admin / admin the support dashboard.
async function login(pg, user, pass) {
  await pg.goto(BASE + '#/signin'); await pg.fill('#login-user', user); await pg.fill('#login-pass', pass); await pg.click('.acct-login >> text=Sign in');
}
async function adminIn(pg, skipTour = true) {
  await login(pg, 'test', 'test');
  await pg.waitForSelector('.rent-row');
  if (skipTour) { await pg.locator('.tour-card >> text=Skip tour').click(); await pg.waitForTimeout(200); }
}
// Signup, step 1: the account with the (simulated) email link. Lands on question 1.
async function createAccount(pg) {
  await pg.goto(BASE + '#/start'); await pg.waitForSelector('h1:has-text("Create your free account")');
  await pg.fill('#ob-first', 'Alex'); await pg.fill('#ob-last', 'Morgan'); await pg.fill('#ob-email', 'alex.morgan@example.com');
  await pg.click('text=Continue with email'); await pg.click('text=Open the link (preview)');
  await pg.waitForSelector('h1:has-text("Where is your rental property?")');
}
// The 6 questions, from question 1 to the plan page.
async function answerQuestions(pg) {
  await pg.click('text=Ontario'); await pg.click('.q-foot >> text=Next');
  await pg.click('text=2 to 5 rental units'); await pg.click('.q-foot >> text=Next');
  await pg.click('text=Interac e-Transfer'); await pg.click('.q-foot >> text=Next');
  await pg.click('text=Knowing who has paid'); await pg.click('.q-foot >> text=Next');
  await pg.click("text=I don't know what costs I can claim"); await pg.click('.q-foot >> text=Next');
  await pg.click('text=Getting paid on time'); await pg.click('.q-foot >> text=See my plan');
  await pg.waitForSelector('text=Go to dashboard');
}
const state = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('keyholder:v1')));
// Home folds rooms under their unit (closed at first): open them so each room's row can be checked.
const openRooms = async (pg) => { for (const t of await pg.locator('.rooms-toggle[aria-expanded="false"]').all()) await t.click().catch(() => {}); };
const go = async (pg, r) => { await pg.goto(BASE + '#/' + r); await pg.waitForTimeout(250); if (r === 'today') await openRooms(pg); };
const approve = async (pg) => { await pg.locator('.slide-confirm .knob').focus(); await pg.keyboard.press('Enter'); await pg.waitForTimeout(350); };
// A receipt photo for the reader test: a till slip on a counter, dated 2 days ago.
const RECEIPT_DATE = (() => { const d = new Date(); d.setDate(d.getDate() - 2); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
let receiptPath = null;
async function receiptImage(browser, dir) {
  if (receiptPath) return receiptPath;
  const ctx = await browser.newContext({ viewport: { width: 420, height: 760 }, deviceScaleFactor: 2 }); const r = await ctx.newPage();
  const sp = (n) => '&nbsp;'.repeat(n);
  await r.setContent(`<body style="margin:0;background:#e9e4da;display:grid;place-items:center;height:100vh"><div style="background:#fff;width:300px;padding:24px 20px;font:15px/1.5 'Courier New',monospace;color:#111;transform:rotate(-1.5deg)">
    <div style="text-align:center;font-weight:bold;font-size:20px">THE HOME DEPOT</div><div style="text-align:center">#7011 HAMILTON ON</div><br><div>${RECEIPT_DATE} 14:32</div><br>
    <div>PAINT 1GAL${sp(8)}54.99</div><div>ROLLER KIT${sp(8)}21.51</div><br><div>SUBTOTAL${sp(10)}76.50</div><div>HST 13%${sp(11)}9.95</div><div style="font-weight:bold">TOTAL${sp(13)}86.45</div><div>VISA${sp(14)}86.45</div><br><div style="text-align:center">THANK YOU</div></div></body>`);
  receiptPath = require('path').join(dir, 'receipt-test.jpg');
  await r.screenshot({ path: receiptPath, type: 'jpeg', quality: 85 }); await ctx.close();
  return receiptPath;
}
const step = async (tag, name, fn) => { if (!want(name[0])) return; try { const note = await fn(); ok(tag, name, true, note || ''); } catch (e) { ok(tag, name, false, process.env.DEBUG ? String(e.message).split('\n').slice(0, 14).join(' / ') : String(e.message).split('\n')[0].slice(0, 160)); } };

(async () => {
  const b = await chromium.launch();
  for (const [vp, tag] of [[{ width: 1280, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
    const errors = [];
    // ---------------- A. New user, starting empty ----------------
    let pg = await (await b.newContext({ viewport: vp })).newPage();
    pg.on('pageerror', (e) => errors.push(`A ${e.message}`));
    pg.on('console', (m) => { if (m.type() === 'error' && !/fonts/.test(m.text())) errors.push(`A console: ${m.text()}`); });
    await step(tag, 'A1 Signup → empty Home shows 3 setup steps', async () => { await onboard(pg); await pg.waitForSelector('text=Start here'); await pg.waitForSelector('text=Add your property'); });
    await step(tag, 'A1b The name typed at signup is used, and Portfolio opens with no properties yet', async () => {
      const st = await state(pg); if (st.profile.name !== 'Alex Morgan') throw new Error('name: ' + st.profile.name);
      await go(pg, 'portfolio'); await pg.waitForSelector('h1:has-text("Portfolio")'); await go(pg, 'today');
    });
    await step(tag, 'A2 Home "Add" → Rentals → add a property', async () => {
      await pg.locator('.start-steps a.btn:has-text("Add property")').click(); await pg.waitForSelector('h1:has-text("Rentals")');
      await pg.locator('text=Add your first property').click();
      await pg.fill('#pp-nick', 'Oak house'); await pg.fill('#pp-addr', '9 Oak St'); await pg.locator('.drawer-foot >> text=Save property').click(); await pg.waitForTimeout(250);
      await pg.waitForSelector('text=Oak house');
    });
    await step(tag, 'A3 Open property → add a unit', async () => {
      await pg.locator('.prop-strip').first().click(); await pg.waitForTimeout(250);
      await pg.locator('text=Add a unit').first().click(); await pg.fill('#uf-l', 'Main'); await pg.fill('#uf-r', '2000'); await pg.locator('.drawer-foot >> text=Save unit').click(); await pg.waitForTimeout(250);
      await pg.waitForSelector('.unit-row:has-text("Main")');
    });
    await step(tag, 'A4 Add a tenant: two people on one lease, each with an email (lease from today)', async () => {
      // The property's "Add tenant" tab: the form on the page, for its vacant unit.
      await pg.locator('.tabs a:has-text("Tenants")').first().click(); await pg.click('#tenants-add'); await pg.waitForSelector('#vacant-units');
      await pg.fill('#tf-n0', 'Rita'); await pg.fill('#tf-n0-last', 'Gomez'); await pg.fill('#tf-e0', 'rita@example.com');
      await pg.locator('.tenancy-inline >> text=Add another person').click(); await pg.fill('#tf-n1', 'Luis'); await pg.fill('#tf-n1-last', 'Gomez'); await pg.fill('#tf-e1', 'luis@example.com');
      const today = await pg.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; });
      await pg.fill('#tf-s', today); await pg.fill('#tf-r', '2000');
      await pg.click('#tf-save'); await pg.waitForTimeout(300);
      await pg.waitForSelector('.unit-row:has-text("Rita Gomez")');
      // Its only unit is rented now: the tab says a vacant unit is needed.
      await pg.locator('.tabs a:has-text("Tenants")').first().click();
      await pg.waitForSelector('#need-vacant >> text=You need a vacant unit to add a tenant.');
      if (!(await pg.locator('#tenants-add').isDisabled())) throw new Error('Add tenant is on with no vacant unit');
      await pg.locator('.tabs a:has-text("Units"), [role=tab]:has-text("Units")').first().click(); await pg.waitForSelector('.unit-row:has-text("Rita Gomez")');
    });
    let row = (who) => pg.locator('.rent-row', { hasText: who });
    await step(tag, 'A5 Home row for the new tenant says "Prepare lease"', async () => {
      await go(pg, 'today'); const t = await row('Rita').locator('.row-act .btn').first().textContent(); if (t !== 'Prepare lease') throw new Error('button: ' + t); return t;
    });
    await step(tag, 'A6 Prepare lease → the same row now says "Inspection"', async () => {
      await row('Rita').locator('text=Prepare lease').click(); await pg.waitForTimeout(200); await approve(pg);
      const t = await row('Rita').locator('.row-act .btn').first().textContent(); if (t !== 'Inspection') throw new Error('button: ' + t); return t;
    });
    await step(tag, 'A7 Inspection → row moves on to rent', async () => {
      await row('Rita').locator('.row-act button.btn', { hasText: /^Inspection$/ }).click(); await pg.waitForTimeout(200); await approve(pg);
      const t = await row('Rita').locator('.row-act').textContent(); if (/Inspection/.test(t)) throw new Error('still inspection'); return 'now: ' + t.replace('⋯', '').trim();
    });
    await step(tag, 'A8 Rent paid → row says "Send receipt" → send → caught up: green "Rent paid · date" (with its ? help), no button', async () => {
      await go(pg, 'rent/tenant/' + (await state(pg)).tenants[0].id); await pg.click('.page-head >> text=Confirm rent'); await pg.locator('.drawer-foot >> text=Mark paid').click(); await pg.waitForTimeout(250);
      await go(pg, 'today'); const t = await row('Rita').locator('.row-act .btn').first().textContent(); if (t !== 'Send receipt') throw new Error('button: ' + t);
      await row('Rita').locator('text=Send receipt').click(); await pg.waitForTimeout(250);
      const pill = (await row('Rita').locator('.status.paid').textContent()).trim();
      if (!/^Rent paid · [A-Z][a-z]{2} \d{1,2}$/.test(pill)) throw new Error('pill: ' + pill);
      if (await row('Rita').locator('.row-act .btn:not(.dots)').count()) throw new Error('still asks: ' + (await row('Rita').locator('.row-act').textContent()));
      await row('Rita').locator('.status.paid').click(); await pg.waitForSelector('.pill-tip.paid >> text=Nothing left to do');
      return pill;
    });
    await step(tag, 'A9 Income shows the payment and receipt', async () => { await go(pg, 'income'); await pg.waitForSelector('td:has-text("Rita Gomez")'); });
    await step(tag, 'A10 Expenses → Add an expense (typed, no photo)', async () => {
      await go(pg, 'expenses'); await pg.locator('.page-head >> text=Add an expense').click();
      await pg.waitForSelector('#ex-photo'); if (await pg.locator('.capture-frame').count()) throw new Error('opened the camera first'); await pg.fill('#ex-amt', '120'); await pg.fill('#ex-vendor', 'Home Depot');
      await pg.locator('.drawer-foot >> text=Save').click(); await pg.waitForTimeout(250);
      await go(pg, 'expenses'); await pg.waitForSelector('text=Home Depot');
    });
    await step(tag, 'A11 Score "Do it" opens the right form (what you paid → Silver)', async () => {
      await go(pg, 'today'); await pg.locator(tag === 'phone' ? '.mobile-top .setup-circle' : '.top-tools.desk .setup-circle').click(); await pg.waitForSelector('.setup-card #score');
      const next = await pg.locator('#score .row .title').first().textContent();
      // Stages come in order, so "what you paid" (Know your numbers) may be past the first three.
      // The list shows the current stage only; "what you paid" (stage 3) is then on the property's level steps.
      if (await pg.locator('#score .row', { hasText: 'what you paid' }).count()) await pg.locator('#score .row', { hasText: 'what you paid' }).locator('text=Do it').click();
      else { await pg.keyboard.press('Escape'); const id = (await state(pg)).properties[0].id; await go(pg, `rent/property/${id}/value`); await pg.click('#add-paid'); }
      await pg.waitForTimeout(250);
      if (await pg.locator('#sv-price').count()) { await pg.fill('#sv-price', '650000'); await pg.fill('#sv-date', '2020-05-01'); await pg.fill('#sv-owed', '400000'); await pg.locator('.drawer-foot >> text=Save').click(); await pg.waitForTimeout(300); await pg.keyboard.press('Escape'); return 'Silver form · ' + next.trim(); }
      return 'Opened: ' + (await pg.evaluate(() => location.hash)) + ' · ' + next.trim();
    });
    await step(tag, 'A12 Value tab: worth is what you paid (no estimates), less what is owed; Silver insights', async () => {
      const id = (await state(pg)).properties[0].id; await go(pg, `rent/property/${id}/value`);
      await pg.waitForSelector('#worth >> text=/What you paid in \\d{4}/'); await pg.waitForSelector('text=Room to borrow');
      if (await pg.locator('text=/Local price trend|Nearby sales|Worth about|monthly value check|Repliers/').count()) throw new Error('an estimate is still shown');
    });
    await step(tag, 'A13 Mortgage tab → add mortgage (Gold) with an extra payment', async () => {
      const id = (await state(pg)).properties[0].id; await go(pg, `rent/property/${id}/mortgage`);
      // One path: step 2 (the mortgage) is the button now that step 1 is done.
      if (!(await pg.locator('#level-steps .ls-step.done >> text=Add what you paid').count())) throw new Error('step 1 not shown as done');
      await pg.click('#add-mortgage'); await pg.waitForTimeout(200);
      await pg.fill('#gd-cc', '3000'); await pg.fill('#gd-ltt', '8000'); await pg.fill('#mf-l', 'TD'); await pg.fill('#mf-p', '390000');
      await pg.locator('text=Add an extra payment').click();
      await pg.locator('.drawer-foot >> text=Save').click(); await pg.waitForTimeout(400);
      await pg.waitForSelector('text=Still owed'); const st = await state(pg); return `stage: ${st.properties[0].closingCosts !== undefined && st.mortgages.length ? 'Gold' : 'not gold'}`;
    });
    await step(tag, 'A14 Portfolio shows net worth and the property card', async () => { await go(pg, 'portfolio'); await pg.waitForSelector('text=Your net worth in property'); await pg.waitForSelector('.pcard:has-text("Oak house")'); });
    await step(tag, 'A15 Paperwork → Taxes shows the property', async () => { await go(pg, 'paperwork/taxes'); await pg.waitForSelector('text=rental income · Oak house'); });
    await step(tag, 'A16 Settings → connect a bank → "Check now"', async () => {
      await go(pg, 'settings/preferences'); await pg.click('#rt-bank'); await pg.locator('.drawer .choice:has-text("TD")').click(); await pg.locator('text=Connect TD').click(); await pg.waitForTimeout(1400);
      await pg.click('#rt-check'); await pg.waitForTimeout(300);
    });
    ok(tag, 'A errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    // ---------------- B. Sample user: each tenant's journey ----------------
    const errsB = [];
    pg = await (await b.newContext({ viewport: vp })).newPage();
    pg.on('pageerror', (e) => errsB.push(`B ${e.message}`));
    pg.on('console', (m) => { if (m.type() === 'error' && !/fonts/.test(m.text())) errsB.push(`B console: ${m.text()}`); });
    await adminIn(pg);
    const btn = async (who) => ((await row(who).locator('.row-act .btn:not(.dots)').count()) ? (await row(who).locator('.row-act .btn:not(.dots)').first().textContent())?.trim() : '');
    await step(tag, 'B1 Each row shows status + one button (rooms folded under their unit at first)', async () => {
      if (!(await pg.locator('.rooms-toggle[aria-expanded="false"]').count()) || (await pg.locator('.rent-row.room-row').count())) throw new Error('rooms not folded at first');
      await openRooms(pg);
      const got = { Maya: await btn('Maya'), Jordan: await btn('Jordan'), 'Unit C': await btn('Unit C'), Sam: await btn('Sam'), 'rooms rented': await btn('Basement · 1 free') };
      const want = { Maya: 'Send receipt', Jordan: 'Send reminder', 'Unit C': 'Review', Sam: 'Confirm', 'rooms rented': 'Review' };
      for (const k in want) if (got[k] !== want[k]) throw new Error(JSON.stringify(got));
      if (!(await pg.locator('.prop-line:has-text("mortgage renews")').count())) throw new Error('no mortgage line');
      if (await pg.locator('.journey-track, .jcard').count()) throw new Error('journey stages still shown');
      return JSON.stringify(got);
    });
    await step(tag, 'B2 Sam (a room): Confirm → same row says "Send receipt" → send → "Rent paid · date"; the unit row counts him', async () => {
      await row('Sam').locator('.row-act >> text=Confirm').click(); await pg.waitForTimeout(250);
      if ((await btn('Sam')) !== 'Send receipt') throw new Error('button: ' + (await btn('Sam')));
      await row('Sam').locator('text=Send receipt').click(); await pg.waitForTimeout(250);
      if (!/^Rent paid · /.test((await row('Sam').locator('.status').textContent()).trim())) throw new Error('pill: ' + (await row('Sam').locator('.status').textContent()));
      if (!/2 of 2 paid/.test(await pg.locator('.rent-row.unit-head', { hasText: 'Basement' }).textContent())) throw new Error('unit row: ' + (await pg.locator('.rent-row.unit-head', { hasText: 'Basement' }).textContent()));
      return 'caught up · ' + ((await row('Sam').locator('.row-act').textContent()) || '').replace('⋯', '').trim();
    });
    await step(tag, 'B3 Maya: Send receipt → caught up: "Rent paid · date", no to-do (raise rent is not a to-do)', async () => {
      await row('Maya').locator('text=Send receipt').click(); await pg.waitForTimeout(250);
      if (await row('Maya').locator('.row-act .btn:not(.dots)').count()) throw new Error('button: ' + (await btn('Maya')));
      const pill = (await row('Maya').locator('.status').textContent()).trim();
      if (!/^Rent paid · /.test(pill)) throw new Error('pill: ' + pill);
      return pill;
    });
    await step(tag, 'B3b Rentals: no market-rent or rent-increase suggestions; Raise rent (⋯) → N1 prepared', async () => {
      await go(pg, 'rentals'); if ((await pg.locator('.suggest').count()) || (await pg.getByText('below market').count())) throw new Error('a rent suggestion is shown');
      await pg.locator('.unit-row', { hasText: 'Maya' }).locator('.dots').click(); await pg.locator('[role=menuitem]:has-text("Raise rent")').click(); await pg.waitForTimeout(200);
      if (!(await pg.locator('.drawer h2:has-text("N1")').count())) throw new Error('N1 did not open'); await approve(pg);
      await go(pg, 'rent/property/p-maple/value'); if (await pg.locator('text=Rent compared with the area').count()) throw new Error('market rent still on the property');
    });
    await step(tag, 'B3c Raise rent is always reachable: ⋯ on Rentals (its menu on top of the card) and the tenant page', async () => {
      await go(pg, 'rentals'); await pg.locator('.unit-row', { hasText: 'Jordan' }).locator('.dots').click();
      // The menu shows on top of the page, not cut off inside the card.
      const box = await pg.locator('[role=menu]').boundingBox();
      const top = await pg.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role=menu]'), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      if (!top) throw new Error('the menu is hidden under something else');
      await pg.locator('[role=menuitem]:has-text("Raise rent")').click(); await pg.waitForTimeout(200);
      if (!(await pg.locator('.drawer h2:has-text("N1")').count())) throw new Error('⋯ did not open N1'); await pg.keyboard.press('Escape');
      await go(pg, 'rent/tenant/t-sam'); await pg.locator('.page-head >> text=Raise rent').click(); await pg.waitForTimeout(200);
      if (!(await pg.locator('.drawer h2:has-text("N1")').count())) throw new Error('tenant page did not open N1'); await pg.keyboard.press('Escape');
      await go(pg, 'today');
    });
    await step(tag, 'B4 Jordan: Send reminder → row says "Prepare N4"', async () => {
      await row('Jordan').locator('text=Send reminder').click(); await pg.waitForTimeout(250); const t = await btn('Jordan'); if (t !== 'Prepare N4') throw new Error('button: ' + t); return t;
    });
    await step(tag, 'B5 Jordan: Prepare N4 → approve → recorded', async () => {
      await row('Jordan').locator('text=Prepare N4').click(); await pg.waitForTimeout(200); await approve(pg);
      const n = (await state(pg)).notices.find((x) => x.kind === 'N4'); if (!n) throw new Error('no N4'); return 'pay by ' + n.terminationDate + ' · row now: ' + (await btn('Jordan'));
    });
    await step(tag, 'B6 Unit C: Review → assess → accept', async () => {
      await row('Unit C').locator('button:has-text("Review")').click(); await pg.waitForSelector('text=3. Applications');
      await pg.locator('.unit-row >> text=Review').first().click(); await pg.locator('.assess-checks label').first().click();
      await pg.locator('.drawer-foot >> text=Accept').click(); await pg.locator('.drawer-foot >> text=Make them the tenant').click(); await pg.waitForTimeout(300);
    });
    await step(tag, 'B7 New tenant row on Home says "Prepare lease"', async () => {
      await go(pg, 'today'); const s2 = await state(pg); const l = s2.leases.find((x) => x.unitId === 'u-c'); const name = s2.tenants.find((t) => t.id === l.tenantId).names[0].split(' ')[0];
      const t = await btn(name); if (t !== 'Prepare lease') throw new Error(name + ': ' + t); return name + ': ' + t;
    });
    await step(tag, 'B8 Mortgage line → "See mortgage" opens the Mortgage tab', async () => {
      await pg.locator('.prop-line >> text=See mortgage').click(); await pg.waitForSelector('text=Still owed');
    });
    await step(tag, 'B9 ⋯ → Hide for a week, then bring it back', async () => {
      await go(pg, 'today'); const line = pg.locator('.prop-line:has-text("mortgage renews")');
      await line.locator('.dots').click(); await pg.locator('text=Hide for a week').click(); await pg.waitForTimeout(200);
      const hidden = !(await line.count()); await pg.locator('text=hidden or ignored').locator('button').click(); await pg.locator('text=Bring back').first().click(); await pg.waitForTimeout(200);
      const back = await pg.locator('.prop-line:has-text("mortgage renews")').count(); if (!hidden || !back) throw new Error(`hidden=${hidden} back=${back}`); return 'mortgage line hidden, then back';
    });
    const circle = () => pg.locator(tag === 'phone' ? '.mobile-top .setup-circle' : '.top-tools.desk .setup-circle');
    await step(tag, 'B10 Setup circle opens the setup list; ⋯ Ignore raises the score', async () => {
      await circle().click(); await pg.waitForSelector('.setup-card #score');
      const n = await pg.locator('#score .row').count(); if (await pg.locator('#score >> text=/^Show all/').count()) await pg.locator('#score >> text=/^Show all/').click(); const n2 = await pg.locator('#score .row').count();
      const before = Number((await pg.locator('#score .score-ring > span').textContent()).trim());
      await pg.locator('#score .row').first().locator('.dots').click(); await pg.locator('.row-menu-pop [role=menuitem]', { hasText: /^Ignore$/ }).click(); await pg.waitForTimeout(250);
      const after = Number((await pg.locator('#score .score-ring > span').textContent()).trim()); if (!(after > before)) throw new Error(before + ' → ' + after);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
      return n + ' shown, ' + n2 + ' after Show all · score ' + before + ' → ' + after;
    });
    await step(tag, 'B11 Setup % sits at the top right next to Settings, with a red dot while steps are left', async () => {
      const label = await circle().getAttribute('aria-label'); if (!/Setup \d+% done/.test(label)) throw new Error(label);
      if (!(await circle().locator('.setup-dot').count())) throw new Error('no red dot'); return label;
    });
    await step(tag, 'B12 Forms library: prepare N1 for Maya', async () => {
      await go(pg, 'paperwork/forms'); await pg.locator('.form-row', { has: pg.locator('.form-code', { hasText: /^N1$/ }) }).locator('button:has-text("Prepare")').click(); await pg.waitForTimeout(200);
      if (await pg.locator('.drawer .choice').count()) await pg.locator('.drawer .choice:has-text("Maya")').click();
      await pg.waitForTimeout(200); if (!(await pg.locator('.slide-confirm').count())) throw new Error('checks failed'); await approve(pg);
    });
    await step(tag, 'B13 Late rent options from Rentals (Sam paid; none for Jordan after N4)', async () => {
      await go(pg, 'rentals'); const n = await pg.locator('text=Late rent options').count(); return `${n} "Late rent options" buttons`;
    });

    await step(tag, 'B14 Bank review: Enbridge → Add expense (filed to a property)', async () => {
      await go(pg, 'expenses'); await pg.waitForSelector('#bank');
      const r0 = pg.locator('.bank-row:has-text("ENBRIDGE")'); await r0.locator('text=Add expense').click(); await pg.waitForTimeout(250);
      const st = await state(pg); if (!st.expenses.some((e) => Math.abs(e.amount) === 21240)) throw new Error('no expense created');
      if (!st.profile.vendorRules?.['ENBRIDGE GAS']) throw new Error('category not remembered for the vendor');
    });
    await step(tag, 'B14b Bank review: Home Depot → Personal (not a rental cost): gone, and remembered for that vendor', async () => {
      await pg.locator('.bank-row:has-text("HOME DEPOT") >> text=Personal').click(); await pg.waitForTimeout(250);
      const st = await state(pg); if (st.txns.find((t) => t.id === 'tx-hd').status !== 'ignored') throw new Error('not set aside');
      if (!st.profile.personalVendors?.includes('HOME DEPOT')) throw new Error('vendor not remembered: ' + st.profile.personalVendors);
      if (await pg.locator('.bank-row:has-text("HOME DEPOT")').count()) throw new Error('still listed');
    });
    await step(tag, 'B15 Bank review: RBC mortgage payment → Tick off', async () => {
      await pg.locator('.bank-row:has-text("RBC MORTGAGE") >> text=/Tick off/').click(); await pg.waitForTimeout(250);
      const st = await state(pg); if (st.txns.find((t) => t.id === 'tx-rbcm').status !== 'mortgage') throw new Error('not reconciled');
    });
    await step(tag, 'B16 Bank review: TD mortgage with no mortgage on file → Set up mortgage form', async () => {
      await pg.locator('.bank-row:has-text("TD MORTGAGE") >> text=Set up mortgage').click(); await pg.waitForSelector('.drawer'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      if (await pg.locator('.drawer').count()) await pg.locator('.drawer >> text=Cancel').first().click();
    });
    await step(tag, 'B17 Settings: two banks connected, "Add another bank" available', async () => {
      await go(pg, 'settings/preferences'); await pg.waitForSelector('#rt-add'); if ((await pg.locator('#rent-tracking .bank-chip').count()) !== 2) throw new Error('bank chips');
      const st = await state(pg); if (st.banks.length !== 2) throw new Error(`${st.banks.length} banks`);
      if (await pg.locator('text=Rent found in your banks').count()) throw new Error('rent found is still in Settings');
    });
    await step(tag, 'B18 Portfolio: "Your money compared" with GIC always shows', async () => {
      await go(pg, 'portfolio'); await pg.waitForSelector('text=Your money compared'); await pg.waitForSelector('.compare >> text=GIC');
    });

    // ---------------- C. Every link on every page ----------------
    const pages = ['today', 'rentals', 'rent/property/p-maple', 'rent/property/p-maple/find', 'rent/property/p-maple/notices', 'rent/property/p-maple/value', 'rent/property/p-maple/mortgage', 'rent/property/p-birch/value', 'rent/tenant/t-maya', 'portfolio', 'portfolio/cash-flow', 'income', 'expenses', 'paperwork/leases', 'paperwork/notices', 'paperwork/forms', 'paperwork/taxes', 'settings', 'more'];
    const bad = [];
    if (want('C')) for (const p of pages) {
      await go(pg, p);
      if (await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) bad.push(`${p}: sideways scroll`);
      const hrefs = await pg.$$eval('a[href^="#/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
      for (const h of hrefs) {
        await pg.goto(BASE + h); await pg.waitForTimeout(120);
        const landed = await pg.evaluate(() => location.hash);
        const hasH1 = await pg.locator('h1').count();
        const target = h.replace(/#.*$/, '') === '#/today';
        if (!hasH1 || (landed.startsWith('#/today') && !h.startsWith('#/today') && !h.startsWith('#/todo') && !h.startsWith('#/tray'))) bad.push(`${p} → ${h} landed on ${landed}${hasH1 ? '' : ' (no heading)'}`);
        void target;
      }
    }
    if (want('C')) ok(tag, 'C Every internal link lands on a real page', bad.length === 0, bad.slice(0, 6).join(' | ') || `${pages.length} pages swept`);
    // Navigation bars
    await step(tag, 'C2 Menu: Home, Portfolio, Rentals, Income, Expenses, Paperwork, Help at the bottom; Settings at the top right, a small Sign out icon there on Settings only; Settings in tabs (Profile first; Preferences: Appearance, Two-step sign-in, Rent tracking) (phones: Home, Income, Rentals raised in the middle, Expenses, More)', async () => {
      const labels = tag === 'phone' ? ['Home', 'Income', 'Rentals', 'Expenses', 'More'] : ['Home', 'Portfolio', 'Rentals', 'Income', 'Expenses', 'Paperwork'];
      const order = (await pg.locator(tag === 'phone' ? '.bottombar a' : '.rail .nav-link').allTextContents()).join(' ').replace(/\d+/g, '');
      if (!(tag === 'phone' ? /Home.*Income.*Rentals.*Expenses.*More/ : /Home.*Portfolio.*Rentals.*Income.*Expenses.*Paperwork/).test(order)) throw new Error('order: ' + order);
      if (tag !== 'phone' && /Settings/.test(order)) throw new Error('Settings still in the side menu');
      if (tag !== 'phone' && !(await pg.locator('.rail-foot .help-btn').count())) throw new Error('no Help at the bottom of the side menu');
      const top = tag === 'phone' ? '.mobile-top' : '.top-tools.desk';
      if (await pg.locator(`${top} [aria-label="Sign out"]`).count()) throw new Error('Sign out on a page other than Settings');
      await pg.locator(`${top} [aria-label="Settings"]`).click(); await pg.waitForSelector('h1:has-text("Your Keyholder")');
      if (!(await pg.locator(`${top} .signout-icon`).isVisible())) throw new Error('no small Sign out icon at the top right of Settings');
      if (await pg.locator('.page > .page-head >> text=Sign out').count()) throw new Error('a big Sign out button is still by the title');
      // Settings in tabs: Profile first (with two-step sign-in), then Preferences (Appearance, Rent tracking).
      const tabs = (await pg.locator('.settings-tabs .tab').allTextContents()).join(' | ');
      if (tabs !== 'Profile | Preferences | Billing') throw new Error('Settings tabs: ' + tabs);
      await pg.waitForSelector('#profile #profile-form');
      await pg.click('#st-tab-preferences'); await pg.waitForSelector('#preferences .pref-t'); const prefs = (await pg.locator('#preferences .pref-t').allTextContents()).join(' | ');
      if (prefs !== 'Appearance | Two-step sign-in | Rent tracking') throw new Error('Preferences: ' + prefs);
      if (tag === 'phone') { const hub = pg.locator('.bottombar a').nth(2); if (!(await hub.evaluate((a) => a.classList.contains('hub') && a.textContent.includes('Rentals')))) throw new Error('Rentals is not the raised middle button'); }
      if (await pg.locator('.bottombar .capture, .rail >> text=Add a receipt').count()) throw new Error('receipt still in the menu');
      for (const l of labels) { await pg.locator(tag === 'phone' ? `.bottombar >> text=${l}` : `.rail >> text=${l}`).first().click(); await pg.waitForSelector(`h1:has-text("${l === 'Home' ? 'Home' : l === 'Settings' ? 'Your Keyholder' : l}")`, { state: 'attached' }); }
      if (tag === 'phone') for (const l of ['Portfolio', 'Paperwork', 'Settings']) { await go(pg, 'more'); await pg.locator(`.more-item:has-text("${l}")`).click(); await pg.waitForSelector(`h1:has-text("${l === 'Settings' ? 'Your Keyholder' : l}")`); }
      for (const [from, to] of [['taxes', '#/paperwork/taxes'], ['paperwork/expenses', '#/expenses'], ['paperwork/income', '#/income']]) { await go(pg, from); const h = await pg.evaluate(() => location.hash); if (h !== to) throw new Error(`${from} → ${h}`); }
    });
    ok(tag, 'B/C errors', errsB.length === 0, errsB.slice(0, 3).join(' | '));

    // ---------------- D. Landing page, demo, tour and guide ----------------
    const errsD = [];
    pg = await (await b.newContext({ viewport: vp })).newPage();
    pg.on('pageerror', (e) => errsD.push(`D ${e.message}`));
    await step(tag, 'D1 First visit: Sign in + Sign up at the top right, Get started on the banner, no demo buttons, no "Open my dashboard"', async () => {
      await pg.goto(BASE); await pg.waitForSelector('.lp-hero-h'); await pg.waitForSelector('.lp-hero >> text=Get started');
      if (await pg.locator('.lp-hero >> text=/^(Sign in|Sign up|Start free)$/').count()) throw new Error('old buttons on the banner');
      if (tag === 'phone') { if (!(await pg.locator('.lp-signin-xs').isVisible())) throw new Error('no Sign in next to the menu'); }
      else for (const t of ['Sign in', 'Sign up']) if (!(await pg.locator(`.lp-nav-cta >> text=${t}`).isVisible())) throw new Error(`no ${t} at the top right`);
      for (const p of ['', 'features', 'about', 'pricing', 'contact']) {
        await pg.goto(BASE + '#/welcome/' + p); await pg.waitForTimeout(150);
        if (await pg.locator('text=/Try a demo|sample properties first/i').count()) throw new Error(`demo link on ${p || 'overview'}`);
        if (await pg.locator('text=Open my dashboard').count()) throw new Error(`"Open my dashboard" shown to a visitor on ${p || 'overview'}`);
      }
      await pg.goto(BASE);
      if (await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('sideways scroll');
    });
    await step(tag, 'D2 Hero: the headline (12 words or fewer) and the five jobs in one line, Get started + How it works, a slider of 3 app pictures (no house photo), and the five jobs opening the Features page', async () => {
      await pg.goto(BASE + '#/welcome'); await pg.waitForSelector('.lp-hero-h');
      const h = (await pg.locator('.lp-hero-h').textContent()).trim(); if (h.split(/\s+/).length > 12) throw new Error('headline too long: ' + h);
      const lede = (await pg.locator('.lp-hero-lede').textContent()).trim(); if (!/^Track every expense/.test(lede) || /toolkit|manual effort/i.test(lede)) throw new Error('subhead: ' + lede);
      await pg.waitForSelector('.lp-hero .lp-how-link'); if (await pg.locator('.lp-hero .lp-photo img').count()) throw new Error('house photo in the hero');
      if ((await pg.locator('#hero-slider .kh-slide').count()) !== 3) throw new Error('slides');
      await pg.locator('#hero-slider .kh-dots button').nth(1).click(); await pg.waitForSelector('#hero-slider .kh-dots button.on[aria-label="Rent and receipts"]');
      const jobs = (await pg.locator('.lp-hero .kh-job').allTextContents()).join(' | '); if (jobs !== 'Track expenses | Send receipts | Screen tenants | Write notices | File taxes') throw new Error('jobs: ' + jobs);
      await pg.locator('.lp-hero .kh-job', { hasText: 'File taxes' }).click(); await pg.waitForSelector('h1:has-text("Everything a landlord does")'); await pg.waitForSelector('.lp-tour-tab[aria-selected="true"] >> text=Tax summary');
      await pg.goto(BASE + '#/welcome');
    });
    // The phone menu must really fill the screen (it once collapsed to a 40px strip that a test could still click into).
    const menuOpen = async () => { await pg.locator('.lp-burger').click(); const box = await pg.locator('.lp-menu').boundingBox(); if (!box || box.height < vp.height * 0.6) throw new Error(`menu only ${box ? Math.round(box.height) : 0}px tall`); };
    const menuGo = async (label) => { if (tag === 'phone') { await menuOpen(); await pg.locator(`.lp-menu >> text=${label}`).click(); } else await pg.locator(`.lp-links >> text=${label}`).click(); await pg.waitForTimeout(250); };
    await step(tag, 'D3 Menu → About → tap BC → BC forms; questions on the same page', async () => { await menuGo('About'); await pg.waitForSelector('h1:has-text("Made for Canadian landlords")'); await pg.waitForSelector('#faq .lp-faq'); await pg.locator('.lp-tile:has-text("BC")').click(); await pg.waitForSelector('.lp-map-info >> text=British Columbia'); await pg.waitForSelector('.lp-map-info >> text=RTB'); });
    await step(tag, 'D4 Every menu page opens (Features and Contact are pages of their own), browser back works', async () => {
      for (const [l, h] of [['Pricing', 'Simple pricing'], ['About', 'Made for Canadian landlords'], ['Features', 'Everything a landlord does'], ['Contact', 'Talk to a person'], ['Overview', 'Manage your rental property']]) { await menuGo(l); await pg.waitForSelector(`h1:has-text("${h}")`); }
      await menuGo('Contact'); await pg.waitForSelector('#site-contact #site-contact-email'); await pg.waitForSelector('#site-contact-message');
      await menuGo('Overview'); if (await pg.locator('#explore, #tour').count()) throw new Error('features still on the Overview');
      await menuGo('Pricing'); await pg.waitForSelector('h1:has-text("Simple pricing")');
      await pg.goBack(); await pg.waitForSelector('h1:has-text("Manage your rental property")');
      await menuGo('Overview');
      if (await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('sideways scroll');
    });
    await step(tag, 'D5 "Get started" → the first signup question', async () => { await pg.locator('.lp-hero >> text=Get started').click(); await pg.waitForSelector('.q-question'); });
    await step(tag, 'D6 test / test → sample Home, demo banner and tour (6 steps)', async () => {
      await adminIn(pg, false); await pg.waitForSelector('.sample-banner >> text=Demo:'); await pg.waitForSelector('.tour-card >> text=Step 1 of 6');
      for (let i = 2; i <= 6; i++) { await pg.locator('.tour-card button.primary').click(); await pg.waitForSelector(`.tour-card >> text=Step ${i} of 6`); }
      await pg.locator('.tour-card >> text=Got it').click(); await pg.waitForTimeout(200); if (await pg.locator('.tour').count()) throw new Error('tour still open');
    });
    await step(tag, 'D7 Tap a status pill → plain explanation', async () => { await pg.locator('.rent-row .pill-btn').first().click(); await pg.waitForSelector('.pill-tip'); });
    await step(tag, 'D8 Every main page has a one-line subtitle', async () => {
      for (const p of ['portfolio', 'rentals', 'income', 'expenses', 'paperwork', 'paperwork/taxes', 'settings']) { await go(pg, p); if (!(await pg.locator('.page-sub').count())) throw new Error(p); }
    });
    await step(tag, 'D9 Settings → "What is Keyholder?" → landing → back to dashboard', async () => {
      await go(pg, 'settings/data'); await pg.locator('text=What is Keyholder?').click(); await pg.waitForSelector('.lp-hero-h');
      if (tag === 'phone') await pg.locator('.lp-burger').click();
      await pg.locator(tag === 'phone' ? '.lp-menu >> text=Open my dashboard' : '.lp-nav-cta >> text=Open my dashboard').click(); await pg.waitForSelector('.rent-row');
    });
    await step(tag, 'D10 Settings → "Show the tour again" replays it', async () => { await go(pg, 'settings/data'); await pg.locator('text=Show the tour again').click(); await pg.waitForSelector('.tour-card'); await pg.locator('.tour-card >> text=Skip tour').click(); });
    await step(tag, 'D11 Admin banner → Sign out → website, and the sample is gone', async () => {
      await pg.locator('.sample-banner >> text=Sign out').click(); await pg.waitForSelector('.lp-hero-h');
      const st = await state(pg); if (st.profile.account || st.profile.onboarded) throw new Error('still signed in');
      await go(pg, 'today'); await pg.waitForSelector('.lp-hero-h'); // the dashboard is closed again
    });
    await step(tag, 'D12 Signup: Back on the first screen returns to the website', async () => { await pg.goto(BASE + '#/start'); await pg.waitForSelector('.q-question'); await pg.locator('.q-foot >> text=Back to website').click(); await pg.waitForSelector('.lp-hero-h, .lp-h1'); });
    await step(tag, 'D13 Signup: Exit on any question signs out and returns to the website; signing in again opens the questions', async () => {
      await createAccount(pg); await pg.click('text=Ontario'); await pg.click('.q-foot >> text=Next'); await pg.locator('.q-exit').click(); await pg.waitForSelector('.lp-hero-h, .lp-h1');
      if ((await state(pg)).profile.account?.signedIn) throw new Error('still signed in');
      await login(pg, 'alex.morgan@example.com', 'x'); await pg.waitForSelector('h1:has-text("Where is your rental property?")');
      await pg.locator('.q-exit').click(); await pg.waitForSelector('.lp-hero-h, .lp-h1');
    });
    await step(tag, 'D14 Signup: browser back goes to the previous question', async () => {
      await createAccount(pg); await pg.click('text=Ontario'); await pg.click('.q-foot >> text=Next'); await pg.waitForSelector('h1:has-text("What are you renting out?")');
      await pg.goBack(); await pg.waitForSelector('h1:has-text("Where is your rental property?")');
      await pg.locator('.q-exit').click(); await pg.waitForSelector('.lp-hero-h, .lp-h1');
    });
    await step(tag, 'D15 Detail pages and More pages have a Back link', async () => {
      await adminIn(pg);
      await go(pg, 'rent/tenant/t-maya'); await pg.locator('.crumb:has-text("Back to")').click(); await pg.waitForSelector('h1, .pcard');
      if (tag === 'phone') for (const p of ['portfolio', 'paperwork', 'settings']) { await go(pg, p); await pg.locator('.crumb:has-text("Back to More")').click(); await pg.waitForSelector('h1:has-text("More")'); }
    });
    await step(tag, 'D16 Help (bottom of the side menu; phones: More → Help) is a page: answers and a contact form', async () => {
      if (tag === 'phone') { await go(pg, 'more'); await pg.locator('.more-list .help-btn').click(); } else await pg.locator('.rail-foot .help-btn').click();
      await pg.waitForSelector('#help-title'); await pg.waitForSelector('#help-contact');
      await pg.locator('.help-list summary').first().click();
    });
    await step(tag, 'D17 Home is lean: no "Since your last visit", Coming up, Milestones or rent chips', async () => {
      await go(pg, 'today'); await pg.waitForSelector('.rent-card');
      for (const sel of ['.since', '.timeline', '.badges', '.rent-chips', '#score']) if (await pg.locator(sel).count()) throw new Error(`${sel} still on Home`);
    });
    ok(tag, 'D errors', errsD.length === 0, errsD.slice(0, 3).join(' | '));

    // ---------------- E. Accounts: Google signup, sign out, sign in ----------------
    const errsE = [];
    pg = await (await b.newContext({ viewport: vp })).newPage();
    pg.on('pageerror', (e) => errsE.push(`E ${e.message}`));
    await step(tag, 'E1 Signup starts with the account (first and last name both needed), then greets you: "Nice to meet you, Alex! Question 1 of 6"', async () => {
      await pg.goto(BASE + '#/start'); await pg.waitForSelector('h1:has-text("Create your free account")');
      if (await pg.locator('.q-question:has-text("What\'s your name?")').count()) throw new Error('old name question');
      await pg.fill('#ob-first', 'Alex'); await pg.fill('#ob-email', 'alex.morgan@example.com');
      if (!(await pg.locator('.acct-signup button.btn.primary').isDisabled())) throw new Error('works without a last name');
      await pg.fill('#ob-last', 'Morgan'); await pg.click('text=Continue with email'); await pg.click('text=Open the link (preview)');
      await pg.waitForSelector('text=Nice to meet you, Alex! Question 1 of 6'); await pg.waitForSelector('.q-aside');
      if (await pg.locator('.q-foot >> text=Back').count()) throw new Error('Back on question 1 (the account is already made)');
      await pg.locator('.q-exit').click(); await pg.waitForSelector('.lp-hero-h, .lp-h1');
    });
    await step(tag, 'E2 Continue with Google first → account picker → 6 questions → plan → Go to dashboard → 5-step tour', async () => {
      await pg.goto(BASE + '#/start'); await pg.locator('.acct-google').click(); await pg.waitForSelector('#gp-title');
      await pg.locator('.acct-list >> text=Alex Morgan').click(); await pg.waitForSelector('text=Nice to meet you, Alex! Question 1 of 6');
      await answerQuestions(pg);
      if (await pg.locator('.acct-google, #ob-email').count()) throw new Error('Google or email boxes still on the plan page');
      await pg.click('text=Go to dashboard'); await pg.waitForSelector('text=Start here');
      await pg.waitForSelector('.tour-card >> text=Step 1 of 5'); await pg.waitForSelector('.tour-card >> text=Start here');
      for (let i = 2; i <= 5; i++) { await pg.locator('.tour-card button.primary').click(); await pg.waitForSelector(`.tour-card >> text=Step ${i} of 5`); }
      await pg.waitForSelector('.tour-card >> text=Sign out is in Settings'); await pg.locator('.tour-card >> text=Got it').click(); await pg.waitForTimeout(200);
      if (await pg.locator('.tour').count()) throw new Error('tour still open');
      const st = await state(pg); if (st.profile.account?.provider !== 'google' || !st.profile.account.signedIn) throw new Error('no google account');
    });
    await step(tag, 'E3 Settings shows the account → Sign out → website', async () => {
      await go(pg, 'settings'); await pg.waitForSelector('#account >> text=alex.morgan@gmail.com');
      await pg.locator('.signout-icon:visible').click(); await pg.waitForSelector('.lp-hero-h');
    });
    await step(tag, 'E4 Sign in → Google → back to Home', async () => {
      if (tag === 'phone') { await pg.locator('.lp-burger').click(); await pg.locator('.lp-menu >> text=Sign in').click(); } else await pg.locator('.lp-nav-cta >> text=Sign in').click();
      await pg.waitForSelector('h1:has-text("Welcome back")');
      await pg.locator('.acct-google').click(); await pg.locator('.acct-list >> text=Alex Morgan').click(); await pg.waitForSelector('text=Start here');
    });
    await step(tag, 'E5 Sign in with an unknown email offers to create an account', async () => {
      await go(pg, 'settings'); await pg.locator('.signout-icon:visible').click(); await pg.waitForSelector('.lp-hero-h');
      await login(pg, 'someone@else.ca', 'anything');
      await pg.waitForSelector('text=No Keyholder account for someone@else.ca'); await pg.locator('.callout >> text=Create a free account').click(); await pg.waitForSelector('h1:has-text("Create your free account")');
    });
    await step(tag, 'E6 Province: 4 big provinces and Others; the list of the others shows only after tapping Others', async () => {
      await createAccount(pg);
      const names = await pg.locator('.choices .choice .t').allTextContents();
      if (names.length !== 5 || names[4] !== 'Others') throw new Error('choices: ' + names.join(', '));
      if (await pg.locator('#ob-prov').count()) throw new Error('the list shows before Others');
      await pg.locator('.choice:has-text("Others")').click(); await pg.waitForSelector('#ob-prov');
      if (!(await pg.locator('.q-foot button.btn.primary').isDisabled())) throw new Error('Next works before a province is chosen');
      if (await pg.locator('#ob-city').count()) throw new Error('city shows before a province');
      await pg.selectOption('#ob-prov', 'NS'); await pg.waitForSelector('#ob-city');
      if ((await pg.inputValue('#ob-city')) !== 'Halifax') throw new Error('city ' + (await pg.inputValue('#ob-city')));
      await pg.locator('.choice:has-text("Ontario")').click(); if (await pg.locator('#ob-prov').count()) throw new Error('the list stays after Ontario');
    });
    await step(tag, 'E7 Plan page: 6 full sentences with icons, two columns on a computer, no scrolling', async () => {
      await pg.goto(BASE + '#/start'); await pg.waitForSelector('h1:has-text("Where is your rental property?")'); await answerQuestions(pg);
      const items = await pg.locator('.plan-six li').count(); if (items !== 6) throw new Error(items + ' items');
      if ((await pg.locator('.plan-six li .plan-ic svg').count()) !== 6) throw new Error('icons missing');
      for (const t of await pg.locator('.plan-six li').allTextContents()) if (!/[.!]$/.test(t.trim())) throw new Error('not a full sentence: ' + t);
      if (tag !== 'phone') {
        const cols = await pg.evaluate(() => new Set([...document.querySelectorAll('.plan-six li')].map((l) => Math.round(l.getBoundingClientRect().left))).size);
        if (cols !== 2) throw new Error(cols + ' columns');
        const extra = await pg.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
        if (extra > 1) throw new Error(`scrolls ${extra}px`);
      }
    });
    await step(tag, 'E8 Settings: no Bronze, Silver and Gold property cards', async () => {
      const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
      await onboard(p); await go(p, 'settings'); await p.waitForSelector('h1:has-text("Your Keyholder")');
      const found = await p.locator('text=/Bronze|Silver|Gold/').count(); await ctx.close();
      if (found) throw new Error('levels still in Settings');
    });
    await step(tag, 'E9 A tenant since 2024 is not shown owing years of rent: asked if in good standing and the last month paid; earlier months count as paid', async () => {
      const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
      await onboard(p); await go(p, 'rentals'); await p.locator('text=Add your first property').click();
      await p.fill('#pp-nick', 'Elm house'); await p.fill('#pp-addr', '5 Elm St'); await p.locator('.drawer-foot >> text=Save property').click(); await p.waitForSelector('text=Elm house');
      await p.locator('.prop-strip').first().click(); await p.waitForTimeout(250);
      await p.locator('text=Add a unit').first().click(); await p.fill('#uf-l', 'Main'); await p.fill('#uf-r', '1800'); await p.locator('.drawer-foot >> text=Save unit').click(); await p.waitForSelector('.unit-row:has-text("Main")');
      await p.locator('text=Add tenant').first().click(); await p.fill('#tf-n0', 'Nora'); await p.fill('#tf-n0-last', 'Bell'); await p.fill('#tf-s', '2024-03-01'); await p.fill('#tf-r', '1800');
      await p.waitForSelector('#tf-standing >> text=Are they in good standing?');
      if (!(await p.inputValue('#tf-paid'))) throw new Error('no last month chosen for "Yes"');
      await p.click('#tf-save'); await p.waitForSelector('.unit-row:has-text("Nora")');
      const st = await state(p); const l = st.leases.find((x) => x.start === '2024-03-01');
      if (!l || !l.paidThrough || !l.standingChecked) throw new Error('answer not saved: ' + JSON.stringify(l));
      await go(p, 'today'); await p.waitForSelector('.rent-row');
      if (await p.locator('.rent-row:has-text("Nora") >> text=/late|owe/i').count()) throw new Error('shown as late');
      if (await p.locator('.standing-q').count()) throw new Error('asked again on Home');
      await go(p, 'rent/tenant/' + l.tenantId); await p.waitForSelector('text=Marked paid up');
      // A tenancy made before this question existed: asked once on Home; "No" with a month keeps later months owing.
      await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('keyholder:v1')); const x = s.leases[0]; delete x.paidThrough; delete x.standingChecked; s.profile.account.created = new Date().toISOString().slice(0, 10); localStorage.setItem('keyholder:v1', JSON.stringify(s)); });
      await p.reload(); await go(p, 'today'); await p.waitForSelector('.standing-q >> text=Is Nora in good standing?');
      await p.locator('.standing-q .seg >> text=No, they owe rent').click();
      await p.selectOption('.standing-q select', { index: 3 }); await p.locator('.standing-q >> text=Save').click();
      await p.waitForTimeout(300); if (await p.locator('.standing-q').count()) throw new Error('still asking');
      const l2 = (await state(p)).leases[0]; if (!l2.paidThrough || !l2.standingChecked) throw new Error('not saved');
      await ctx.close();
    });
    await step(tag, 'E10 Top right: labelled Settings button (Sign out next to it on Settings); Income and Expenses have the bank button', async () => {
      const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
      await login(p, 'test', 'test'); await p.waitForSelector('.rent-row'); await p.locator('.tour-card >> text=Skip tour').click();
      const top = tag === 'phone' ? '.mobile-top' : '.top-tools.desk';
      const s = p.locator(`${top} [aria-label="Settings"]`);
      if ((await s.innerText()).trim() !== 'Settings') throw new Error('Settings has no word');
      const box = await s.boundingBox(); if (!box || box.height < 44) throw new Error('Settings too small: ' + JSON.stringify(box));
      await s.click(); await p.waitForSelector(`${top} [aria-label="Sign out"] >> text=Sign out`);
      for (const page of ['income', 'expenses']) { await go(p, page); await p.waitForSelector('.page-head .link-bank'); }
      await ctx.close();
    });
    ok(tag, 'E errors', errsE.length === 0, errsE.slice(0, 3).join(' | '));

    // ---------------- F. Bright redesign: photos, Home cards, quick actions ----------------
    const errsF = [];
    pg = await (await b.newContext({ viewport: vp })).newPage();
    pg.on('pageerror', (e) => errsF.push(`F ${e.message}`));
    await step(tag, 'F1 Website photos and pictures load', async () => {
      for (const p of ['features', 'about', 'pricing']) {
        await pg.goto(BASE + '#/welcome/' + p); await pg.waitForTimeout(400);
        await pg.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } });
        await pg.waitForFunction(() => [...document.querySelectorAll('.lp img')].every((i) => i.complete), null, { timeout: 8000 });
        const res = await pg.$$eval('.lp img', (ims) => ({ count: ims.length, broken: ims.filter((i) => i.naturalWidth === 0).length }));
        if (!res.count || res.broken) throw new Error(`${p || 'overview'}: ${res.count} images, ${res.broken} broken`);
      }
      await pg.goto(BASE); if ((await pg.locator('.lp-step-ic svg').count()) !== 3) throw new Error('step icons missing');
    });
    await step(tag, 'F2 Phones: the Get started bar sits at the bottom once the page buttons scroll away', async () => {
      if (tag !== 'phone') return 'phone only';
      await pg.goto(BASE); await pg.locator('.lp-how .lp-step').nth(1).scrollIntoViewIfNeeded(); await pg.waitForTimeout(800);
      const box = await pg.locator('.lp-sticky').boundingBox();
      if (!box || Math.abs(box.y + box.height - vp.height) > 2) throw new Error('bar not at the bottom: ' + JSON.stringify(box));
    });
    await step(tag, 'F3 Home: rent card, bank line right under it, next step, rows titled first name · unit', async () => {
      await adminIn(pg);
      await pg.waitForSelector('.rent-card >> text=collected'); await pg.waitForSelector('.next-card');
      const order = await pg.evaluate(() => [...document.querySelector('.home-main').children].map((e) => e.className.split(' ')[0]));
      if (order[0] !== 'rent-card' || order[1] !== 'track-top') throw new Error('order: ' + order.join(', '));
      const t = (await pg.locator('.rent-row .who').first().textContent()).trim(); if (t !== 'Maya · Unit A') throw new Error('title: ' + t);
      if (await pg.locator('.rent-row .where').count()) throw new Error('unit details still shown');
    });
    await step(tag, 'F4 No Quick actions; a row still unpaid keeps its pill; dark mode keeps the rent card dark', async () => {
      if (await pg.locator('.quick, [aria-label="Quick actions"]').count()) throw new Error('Quick actions still shown');
      if (!(await row('Jordan').locator('.status').count())) throw new Error('late row lost its pill');
      await pg.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      const bg = await pg.locator('.rent-card').evaluate((e) => getComputedStyle(e).backgroundImage);
      await pg.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      if (/255, 255, 255/.test(bg)) throw new Error('rent card white in dark mode: ' + bg);
    });
    await step(tag, 'F4b Taxes: add a regular cost paid in cash (no receipt); a later "From" date explains the part year', async () => {
      await go(pg, 'paperwork/taxes'); await pg.waitForSelector('.regular-costs');
      await pg.locator('.rc-item', { hasText: 'Snow removal' }).click(); await pg.waitForSelector('.cash-note');
      if (!(await pg.locator('#ex-cash').isChecked())) throw new Error('cash box not ticked');
      await pg.fill('#ex-amt', '60'); await pg.locator('.drawer-foot >> text=Save').click(); await pg.waitForTimeout(300);
      // Added costs move out of the suggestions, into "Show … added or ignored".
      await pg.locator('#regular-costs >> text=/^Show \\d+ added or ignored/').click(); await pg.waitForSelector('.rc-item:has-text("Snow removal") .rc-n.done');
      if (await pg.locator('.tax-start').count()) throw new Error('part-year note shown for records starting in January');
      const y = new Date().getFullYear(); await pg.fill('#tax-from', `${y}-06-01`); await pg.waitForSelector('.tax-start >> text=Started part way through the year');
      await pg.waitForSelector('text=paid in cash with no receipt');
    });
    await step(tag, 'F4c Expenses → Add an expense → photo of a receipt: amount, date, store and type filled in', async () => {
      const img = await receiptImage(b, out);
      await go(pg, 'expenses'); await pg.locator('.page-head >> text=Add an expense').click();
      await pg.locator('#ex-photo').setInputFiles(img);
      await pg.waitForSelector('.read-note', { timeout: 90000 });
      const got = { amount: await pg.inputValue('#ex-amt'), date: await pg.inputValue('#ex-date'), vendor: await pg.inputValue('#ex-vendor'), type: await pg.inputValue('#ex-cat') };
      if (got.amount !== '86.45' || got.date !== RECEIPT_DATE || got.vendor !== 'Home Depot' || got.type !== 'repairs') throw new Error(JSON.stringify(got));
      await pg.waitForSelector('.read-note >> text=Please check before you save');
      await pg.locator('.drawer-foot >> text=Cancel').click();
      return `${got.vendor} ${got.amount} ${got.date}`;
    });
    await step(tag, 'F5 Tenant rows show avatars; empty states have pictures', async () => {
      await go(pg, 'today'); if (!(await pg.locator('.rent-row .avatar').count())) throw new Error('no avatars');
      await go(pg, 'rent/tenant/t-maya'); await pg.waitForSelector('h1 .avatar');
    });
    ok(tag, 'F errors', errsF.length === 0, errsF.slice(0, 3).join(' | '));

    // ---------------- G. Overview: simpler steps, Take a closer look tour, lighter closing card ----------------
    const errsG = [];
    pg = await (await b.newContext({ viewport: vp, hasTouch: tag === 'phone' })).newPage();
    pg.on('pageerror', (e) => errsG.push(`G ${e.message}`));
    const tour = async () => { await pg.goto(BASE + '#/welcome/features'); await pg.locator('#tour').scrollIntoViewIfNeeded(); await pg.waitForTimeout(500); };
    const active = () => pg.evaluate(() => { const on = document.querySelector('.mac-screen img.on'); const sel = document.querySelector('.lp-tour-tab[aria-selected="true"]'); return { alt: on?.getAttribute('alt') || '', loaded: !!on && on.complete && on.naturalWidth > 0, tab: sel?.textContent || '', count: document.querySelector('.lp-tour-count')?.textContent || '' }; });
    await step(tag, 'G1 Features: the five jobs open their screen in Take a closer look (no separate tabbed section); Overview: How it works in 3 steps on the blue-purple panel and who it is for; About: the questions', async () => {
      await pg.goto(BASE + '#/welcome/features'); await pg.waitForSelector('#tour');
      if (await pg.locator('.kh-tab, #explore').count()) throw new Error('the tabbed section is still there');
      await pg.locator('.kh-job', { hasText: 'Write notices' }).click(); await pg.waitForSelector('.lp-tour-tab[aria-selected="true"] >> text=Late-rent notices');
      await pg.goto(BASE + '#/welcome'); await pg.waitForSelector('.lp-hero-h');
      const panel = await pg.locator('.lp-how-panel').evaluate((el) => getComputedStyle(el).backgroundImage); if (!/gradient/.test(panel)) throw new Error('How it works has no blue-purple background');
      if ((await pg.locator('.lp-how .lp-step').count()) !== 3) throw new Error('steps');
      await pg.waitForSelector('.lp-who-line >> text=every landlord'); await pg.goto(BASE + '#/welcome/about'); await pg.waitForSelector('#faq .lp-faq');
    });
    await step(tag, 'G2 Tour: each of the 8 features shows its own screen, counter follows', async () => {
      await tour(); if ((await pg.locator('.lp-tour-tab').count()) !== 8) throw new Error('not 8 features');
      const seen = new Set();
      for (let k = 0; k < 8; k++) {
        await pg.locator('.lp-tour-tab').nth(k).click(); await pg.waitForTimeout(250);
        const a = await active(); if (!a.loaded || !a.alt || a.count !== `${k + 1} of 8`) throw new Error(`stop ${k + 1}: ${JSON.stringify(a)}`);
        if (!(await pg.locator('.mac-spot b').textContent())) throw new Error(`stop ${k + 1}: no highlight label`);
        seen.add(a.alt);
      }
      if (seen.size !== 8) throw new Error('screens repeat');
    });
    await step(tag, 'G3 Tour: Next and Previous wrap around', async () => {
      await pg.locator('.lp-tour-nav [aria-label="Next feature"]').click(); await pg.waitForTimeout(200);
      if ((await active()).count !== '1 of 8') throw new Error('next from 8 did not wrap');
      await pg.locator('.lp-tour-nav [aria-label="Previous feature"]').click(); await pg.waitForTimeout(200);
      if ((await active()).count !== '8 of 8') throw new Error('previous from 1 did not wrap');
    });
    await step(tag, 'G4 Tour: arrow keys move between features', async () => {
      await pg.locator('.lp-tour-tab[aria-selected="true"]').focus(); await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(200);
      const a = await active(); if (a.count !== '1 of 8' || !(await pg.evaluate(() => document.activeElement?.getAttribute('aria-selected') === 'true'))) throw new Error(JSON.stringify(a));
    });
    await step(tag, 'G5 Tour: tap the screen to enlarge; Esc and the close button both close it', async () => {
      await pg.locator('.mac-screen').click(); await pg.waitForSelector('.lp-zoom img');
      if (tag === 'phone' && !(await pg.evaluate(() => document.querySelector('.lp-zoom img').getBoundingClientRect().width > window.innerWidth))) throw new Error('phone: enlarged screen not wider than the phone');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(150); if (await pg.locator('.lp-zoom').count()) throw new Error('Esc did not close');
      await pg.locator('.mac-screen').click(); await pg.locator('.lp-zoom-close').click(); await pg.waitForTimeout(150); if (await pg.locator('.lp-zoom').count()) throw new Error('close button did not close');
    });
    await step(tag, 'G6 Phones: swipe the screen to go to the next feature', async () => {
      if (tag !== 'phone') return 'phone only';
      const before = (await active()).count;
      await pg.locator('.mac-screen').evaluate((el) => {
        const r = el.getBoundingClientRect(); const y = r.top + r.height / 2;
        const t = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(r.right - 30)], changedTouches: [t(r.right - 30)] }));
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(r.left + 30)] }));
      });
      await pg.waitForTimeout(250);
      const after = (await active()).count; if (after === before) throw new Error('swipe did nothing: ' + after);
      if (await pg.locator('.lp-zoom').count()) throw new Error('swipe opened the enlarged view');
    });
    await step(tag, 'G7 The closing card is light (no gradient)', async () => {
      const bg = await pg.locator('.lp-cta-card').evaluate((el) => { const c = getComputedStyle(el); return { img: c.backgroundImage, color: c.backgroundColor }; });
      if (bg.img !== 'none') throw new Error('still a gradient');
      const rgb = bg.color.match(/\d+/g).map(Number); if (rgb.slice(0, 3).some((v) => v < 235)) throw new Error('not light: ' + bg.color);
    });
    ok(tag, 'G errors', errsG.length === 0, errsG.slice(0, 3).join(' | '));

    // ---------------- H. Admin-only sample, and several tenants per unit ----------------
    const errsH = [];
    pg = await (await b.newContext({ viewport: vp })).newPage();
    pg.on('pageerror', (e) => errsH.push(`H ${e.message}`));
    await step(tag, 'H1 One sign-in form: wrong passwords refused; test / test opens the demo; no Admin sign in link', async () => {
      await pg.goto(BASE + '#/signin'); if (await pg.locator('text=Admin sign in').count()) throw new Error('old Admin sign in link still there');
      for (const [u, pw] of [['test', 'nope'], ['admin', 'letmein'], ['not-an-email', 'x']]) {
        await login(pg, u, pw); await pg.waitForSelector('.acct-error >> text=not right');
        if (await pg.locator('.rent-row, .sp').count()) throw new Error(`${u} opened with a wrong password`);
      }
      await login(pg, 'test', 'test'); await pg.waitForSelector('.sample-banner >> text=Demo:');
      await pg.locator('.tour-card >> text=Skip tour').click();
      await pg.goto(BASE + '#/support'); await pg.waitForTimeout(300); if (await pg.locator('.sp').count()) throw new Error('the demo reached the support dashboard');
      await go(pg, 'settings/data'); for (const t of ['Restore sample data', 'Replay the signup questions']) if (!(await pg.locator(`text=${t}`).count())) throw new Error(`admin has no "${t}"`);
      await pg.locator('.signout-icon:visible').click(); await pg.waitForSelector('.lp-hero-h');
    });
    await step(tag, 'H2 Signing in as admin sets your own account aside; signing out brings it back', async () => {
      await onboard(pg); await pg.waitForSelector('text=Start here');
      await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('keyholder:v1')); s.properties.push({ id: 'p-oak', nickname: 'Oak house', address: '9 Oak St', city: 'Toronto', province: 'ON', type: 'house', rentalSharePct: 100, ownerOccupied: false, ownershipPct: 100, claimCCA: false }); localStorage.setItem('keyholder:v1', JSON.stringify(s)); });
      await pg.reload(); await go(pg, 'settings/data');
      for (const t of ['Restore sample data', 'Replay the signup questions']) if (await pg.locator(`text=${t}`).count()) throw new Error(`a real account sees "${t}"`);
      await pg.locator('.signout-icon:visible').click(); await pg.waitForSelector('.lp-hero-h');
      await adminIn(pg); await go(pg, 'rentals'); await pg.waitForSelector('text=Maple triplex');
      if (await pg.locator('text=Oak house').count()) throw new Error('own data mixed into the sample');
      await pg.locator('.sample-banner >> text=Sign out').click(); await pg.waitForSelector('.lp-hero-h');
      await login(pg, 'alex.morgan@example.com', 'my-password');
      await pg.waitForSelector('.rent-card, .start-steps'); await go(pg, 'rentals'); await pg.waitForSelector('text=Oak house');
      if (await pg.locator('text=Maple triplex').count()) throw new Error('sample left behind in the account');
    });
    await step(tag, 'H3 An old demo left in the browser is a visitor: Sign in and Get started both work', async () => {
      await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('keyholder:v1')); s.profile.sample = true; delete s.profile.account; localStorage.setItem('keyholder:v1', JSON.stringify(s)); });
      await pg.goto(BASE + '#/welcome'); await pg.reload(); await pg.waitForSelector('.lp-hero-h');
      if (await pg.locator('text=Open my dashboard').count()) throw new Error('"Open my dashboard" shown to an old demo');
      await pg.locator(tag === 'phone' ? '.lp-signin-xs' : '.lp-nav-cta >> text=Sign in').click(); await pg.waitForSelector('h1:has-text("Welcome back")');
      await pg.goto(BASE + '#/welcome'); await pg.locator('.lp-hero >> text=Get started').click(); await pg.waitForSelector('.q-question');
    });
    await step(tag, 'H4 Shared lease: both people listed with their own email; the reminder goes to both', async () => {
      await adminIn(pg); await go(pg, 'rent/tenant/t-patel');
      if ((await pg.locator('.people-list li').count()) !== 2) throw new Error('not two people');
      await pg.waitForSelector('.people-list >> text=priya.patel@example.com');
      await go(pg, 'rentals'); await pg.locator('.unit-row', { hasText: 'Jordan' }).locator('text=Late rent options').click(); await pg.locator('.drawer >> text=Write reminder').click();
      const to = await pg.locator('.drawer .to-line').textContent(); if (!/jpatel@example\.com/.test(to) || !/priya\.patel@example\.com/.test(to)) throw new Error('To: ' + to);
      await pg.keyboard.press('Escape'); return to.trim();
    });
    await step(tag, 'H5 By the room: a row per rented room, and "2 of 3 rooms rented" with the free room', async () => {
      await go(pg, 'today');
      for (const t of ['Sam · Room 1', 'Grace · Room 2']) if (!(await pg.locator('.rent-row .who', { hasText: t }).count())) throw new Error(`${t} not shown`);
      await go(pg, 'rentals'); await pg.waitForSelector('.unit-row >> text=Room 3 is free');
      await go(pg, 'rent/property/p-birch/find'); await pg.waitForSelector('text=2 of 3 rooms rented');
    });
    await step(tag, 'H5b A room marked paid by hand stays paid: receipt sent → "Rent paid · date"; its waiting bank deposit joins that payment (no "Rent to confirm"); the unit counts 2 of 2', async () => {
      await go(pg, 'rent/tenant/t-sam'); await pg.click('.page-head >> text=Confirm rent'); await pg.locator('.drawer-foot >> text=Mark paid').click(); await pg.waitForTimeout(300);
      await go(pg, 'today');
      const sam = pg.locator('.rent-row.room-row', { hasText: 'Sam' });
      if ((await sam.locator('.row-act .btn').first().textContent()).trim() !== 'Send receipt') throw new Error('Sam: ' + (await sam.textContent()));
      await sam.locator('text=Send receipt').click(); await pg.waitForTimeout(300);
      const pill = (await sam.locator('.status').textContent()).trim();
      if (!/^Rent paid · /.test(pill) || (await sam.locator('.row-act .btn:not(.dots)').count())) throw new Error('Sam after receipt: ' + (await sam.textContent()));
      if (!/2 of 2 paid/.test(await pg.locator('.rent-row.unit-head', { hasText: 'Basement' }).textContent())) throw new Error('unit row not 2 of 2');
      const st = await state(pg); const tx = st.txns.find((t) => t.id === 'tx-sam'); const pay = st.payments.find((p) => p.leaseId === 'l-sam' && p.source === 'manual');
      if (tx.status !== 'matched' || tx.paymentId !== pay.id) throw new Error('deposit not joined: ' + tx.status);
      await go(pg, 'rent/property/p-birch');
      if (!/2 of 2 paid/.test(await pg.locator('.unit-row.unit-head').first().textContent())) throw new Error('Rentals unit row');
      if (!/Rent paid · /.test(await pg.locator('.unit-row.room-row', { hasText: 'Sam' }).textContent())) throw new Error('Rentals Sam row');
      return pill;
    });
    await step(tag, 'H6 Switch Unit C to "By the room": accepting one applicant keeps the others open', async () => {
      await go(pg, 'rent/property/p-maple'); await pg.locator('.unit-row:has(.unit-label:text-is("C"))').locator('.dots').click(); await pg.locator('[role=menuitem]:has-text("Edit unit")').click();
      await pg.locator('.drawer [aria-label="How is it rented?"] >> text=By the room').click(); await pg.fill('#uf-rooms', '2');
      await pg.locator('.drawer-foot >> text=Save unit').click(); await pg.waitForTimeout(250);
      await go(pg, 'rent/property/p-maple/find'); await pg.waitForSelector('text=0 of 2 rooms rented');
      await pg.locator('.unit-row', { hasText: 'Daniel Osei' }).locator('text=Review').click();
      await pg.locator('.drawer-foot >> text=Accept').click(); await pg.waitForSelector('.drawer >> text=Which room?');
      await pg.locator('.drawer-foot >> text=Make them the tenant').click(); await pg.waitForTimeout(300);
      const st = await state(pg);
      const lease = st.leases.find((l) => l.unitId === 'u-c'); const novaks = st.applicants.find((a) => a.id === 'ap-2');
      if (lease?.room !== 'Room 1') throw new Error('lease room: ' + lease?.room);
      if (novaks.status === 'declined') throw new Error('other applicants were declined while a room is free');
      if (!st.listings.some((l) => l.unitId === 'u-c')) throw new Error('listing closed while a room is free');
      await pg.waitForSelector('text=1 of 2 rooms rented');
    });
    await step(tag, 'H7 Applications list each co-applicant with their own job and income', async () => {
      await pg.locator('.unit-row', { hasText: 'Lena Novak' }).locator('text=Review').click();
      await pg.waitForSelector('.drawer >> text=Novak Plumbing'); await pg.waitForSelector('.drawer >> text=City of Hamilton'); await pg.waitForSelector('.drawer >> text=Household income');
      await pg.keyboard.press('Escape');
    });
    await step(tag, 'H8 Rentals ⋯ menu: End lease and Delete tenant; deleting someone with payments suggests ending the lease instead', async () => {
      await go(pg, 'rent/property/p-birch'); await pg.locator('.unit-row', { hasText: 'Sam Okafor' }).locator('.dots').click();
      for (const t of ['Raise rent', 'End lease', 'Delete tenant']) if (!(await pg.locator(`[role=menuitem]:has-text("${t}")`).count())) throw new Error('menu has no ' + t);
      await pg.locator('[role=menuitem]:has-text("Delete tenant")').click();
      await pg.waitForSelector('.drawer >> text=Did Sam live there?'); await pg.locator('.drawer >> text=End lease instead').click();
      await pg.waitForSelector('.drawer h2:has-text("End lease")'); await approve(pg);
      const l = (await state(pg)).leases.find((x) => x.id === 'l-sam'); if (!l.end) throw new Error('lease not ended');
      return 'Sam\'s lease ends ' + l.end;
    });
    await step(tag, 'H9 Tenant page: Delete tenant removes the tenant, their lease and payments, and goes back to the property', async () => {
      await go(pg, 'rent/tenant/t-grace'); await pg.click('#td-delete'); await pg.waitForSelector('.drawer h2:has-text("Delete Grace Liu?")'); await approve(pg);
      await pg.waitForSelector('.page-head, .prop-hero, h1'); const h = await pg.evaluate(() => location.hash);
      if (!h.includes('/rent/property/p-birch')) throw new Error('went to ' + h);
      const st = await state(pg);
      if (st.tenants.some((t) => t.id === 't-grace') || st.leases.some((l) => l.id === 'l-grace') || st.payments.some((p) => p.leaseId === 'l-grace')) throw new Error('Grace is still there');
      if (!st.audit.some((a) => a.action === 'Tenant deleted')) throw new Error('not in the history');
    });
    await step(tag, 'H10 Settings profile: changes wait for Save (button off until something changes)', async () => {
      await go(pg, 'settings'); if (!(await pg.locator('#st-save').isDisabled())) throw new Error('Save is on with nothing changed');
      await pg.fill('#st-ph', '416-555-0199'); await pg.waitForSelector('.profile-save >> text=Not saved yet');
      if ((await state(pg)).profile.phone === '416-555-0199') throw new Error('saved before Save');
      await pg.click('#st-save'); await pg.waitForSelector('.profile-save >> text=Saved');
      if ((await state(pg)).profile.phone !== '416-555-0199') throw new Error('not saved');
      if (!(await pg.locator('#st-save').isDisabled())) throw new Error('Save still on after saving');
    });
    await step(tag, 'H11 Property tabs: Units, then Tenants (the list, with Add tenant and Find a tenant at the side)', async () => {
      await go(pg, 'rent/property/p-maple'); const tabs = (await pg.locator('.tabs a, [role=tab]').allTextContents()).join(' ');
      if (!/Units.*Tenants/.test(tabs)) throw new Error('tabs: ' + tabs);
      await pg.locator('.tabs a:has-text("Tenants")').first().click();
      await pg.waitForSelector('#tenants .unit-row:has-text("Maya Chen")'); await pg.waitForSelector('#tenants-find');
      await pg.click('#tenants-add'); await pg.waitForSelector('#vacant-units'); await pg.waitForSelector('#tf-save');
    });
    await step(tag, 'H12 Delete a unit that never had a tenant from its ⋯ menu; a rented unit cannot be deleted', async () => {
      await go(pg, 'rent/property/p-maple'); await pg.click('#add-unit'); await pg.fill('#uf-l', 'Z');
      await pg.locator('.drawer-foot >> text=Save unit').click(); await pg.waitForTimeout(300);
      const row = pg.locator('.unit-row:has(.unit-label:text-is("Z"))'); await row.locator('.dots').click();
      await pg.locator('[role=menuitem]:has-text("Delete unit")').click(); await pg.waitForSelector('.drawer h2:has-text("Delete Unit Z?")'); await approve(pg);
      if ((await state(pg)).units.some((u) => u.label === 'Z')) throw new Error('unit Z still there');
      await pg.keyboard.press('Escape');
      await pg.locator('.unit-row:has(.unit-label:text-is("A"))').locator('.dots').first().click();
      if (!(await pg.locator('text=end the lease first').count())) throw new Error('no reason shown for a rented unit');
      await pg.keyboard.press('Escape');
    });
    await step(tag, 'H13 Bronze: one two-step path, step 2 greyed until step 1, no duplicate "Add what you paid"', async () => {
      await go(pg, 'rent/property/p-birch/value'); await pg.waitForSelector('#level-steps .ls-step.now >> text=Add what you paid');
      await pg.waitForSelector('#level-steps .ls-step.later >> text=Do step 1 first');
      const n = await pg.locator('main button:has-text("Add what you paid"), main a:has-text("Add what you paid")').count();
      if (n !== 1) throw new Error(n + ' "Add what you paid" buttons');
    });
    await step(tag, 'H14 Archive a property (sold): it leaves Rentals, leases end, records stay; Restore brings it back', async () => {
      await go(pg, 'rent/property/p-birch'); await pg.click('#archive-property'); await pg.waitForSelector('.drawer h2:has-text("Archive")');
      await approve(pg); await pg.waitForSelector('#archived');
      let st = await state(pg); const p = st.properties.find((x) => x.id === 'p-birch');
      if (p.archivedReason !== 'sold' || !p.archivedOn) throw new Error('not archived: ' + JSON.stringify(p).slice(0, 120));
      if (await pg.locator('.prop-card:has-text("Home + basement suite"), .unit-list:has-text("Home + basement suite")').count()) throw new Error('still in Rentals');
      if (!st.payments.some((x) => st.leases.find((l) => l.id === x.leaseId && st.units.find((u) => u.id === l.unitId)?.propertyId === 'p-birch'))) throw new Error('payments were removed');
      await pg.locator('#archived >> text=Restore').first().click(); await pg.waitForTimeout(300);
      st = await state(pg); if (st.properties.find((x) => x.id === 'p-birch').archivedOn) throw new Error('not restored');
    });
    await step(tag, 'H15 Rentals: money in while rent is owed shows "From your bank"; Not rent is remembered for that sender and gone everywhere', async () => {
      await pg.evaluate(() => { const k = 'keyholder:v1'; const d = JSON.parse(localStorage.getItem(k)); d.txns.unshift({ id: 'tx-mom', source: 'bank', bankId: d.banks[0]?.id, date: new Date().toISOString().slice(0, 10), amount: 30000, payer: 'MOM', memo: '', status: 'new', checked: true }); localStorage.setItem(k, JSON.stringify(d)); });
      await pg.reload(); await go(pg, 'rentals');
      const row = pg.locator('#bank-deposits .bank-row:has-text("MOM")'); await row.waitFor();
      await row.locator('text=Not rent').click(); await pg.waitForTimeout(300);
      const st = await state(pg);
      if (st.txns.find((t) => t.id === 'tx-mom').status !== 'ignored' || !st.profile.notRentPayers?.includes('MOM')) throw new Error('not remembered');
      if (await pg.locator('#bank-deposits .bank-row:has-text("MOM")').count()) throw new Error('still on Rentals');
      await go(pg, 'today'); if (await pg.locator('text=from MOM').count()) throw new Error('still on Home');
    });
    await step(tag, 'H16 Settings → Preferences: one line each, with icons and the options right there', async () => {
      await go(pg, 'settings/preferences');
      for (const id of ['appearance', 'rent-tracking']) { const h = await pg.locator(`#pref-${id}`).evaluate((e) => e.getBoundingClientRect().height); if (h > (tag === 'phone' ? 280 : 140)) throw new Error(`${id} line is ${h}px tall`); }
      if ((await pg.locator('#appearance [role=radio] svg').count()) !== 3) throw new Error('theme icons');
      await pg.locator('#appearance [role=radio]:has-text("Night")').click(); if ((await state(pg)).profile.theme !== 'dark') throw new Error('theme not set');
      await pg.locator('#appearance [role=radio]:has-text("Device")').click();
      await pg.click('#pref-grain'); const g = (await state(pg)).profile.paperGrain; await pg.click('#pref-grain'); if ((await state(pg)).profile.paperGrain === g) throw new Error('grain toggle');
    });
    await step(tag, 'H17 A vacant unit has Add tenant next to its main button; it opens the Add tenant tab', async () => {
      await go(pg, 'rentals'); await pg.locator('.add-tenant-quick').first().click();
      await pg.waitForSelector('#vacant-units'); if (!(await pg.evaluate(() => location.hash)).includes('/add-tenant')) throw new Error('not the Add tenant tab');
    });
    await step(tag, 'H18 Tenants page (menu): every tenant with their unit and property; ⋯ actions; Find a tenant lists the properties with a vacancy', async () => {
      await go(pg, 'tenants'); await pg.waitForSelector('#tenants .unit-row');
      if (!(await pg.locator('#tenants .unit-row:has-text("Maya Chen")').textContent()).includes('Maple triplex')) throw new Error('no property on the row');
      await pg.locator('#tenants .unit-row:has-text("Maya Chen") .dots').click(); await pg.waitForSelector('[role=menuitem]:has-text("End lease")'); await pg.keyboard.press('Escape');
      await pg.click('#tenants-find'); if (await pg.locator('[role=menuitem]').count()) await pg.locator('[role=menuitem]').first().click();
      await pg.waitForTimeout(300); if (!(await pg.evaluate(() => location.hash)).includes('/find')) throw new Error('Find a tenant did not open a property');
    });
    await step(tag, 'H19 Home ⋯ menu floats above the page (not cut off by its card)', async () => {
      await go(pg, 'today'); const dots = pg.locator('.rent-list .dots, .prop-line .dots').first(); await dots.scrollIntoViewIfNeeded(); await dots.click();
      const ok = await pg.evaluate(() => { const m = document.querySelector('.row-menu-pop'); if (!m || m.parentElement !== document.body) return false; const r = m.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + 10); return !!top && !!top.closest('.row-menu-pop'); });
      if (!ok) throw new Error('menu hidden or inside the card'); await pg.keyboard.press('Escape');
    });
    await step(tag, 'H20 Home: a unit rented by the room with free rooms has Add tenant on its own row; Find a tenant is its own page', async () => {
      await go(pg, 'today'); const btn = pg.locator('.unit-head .add-tenant-quick').first(); await btn.waitFor();
      await btn.click(); await pg.waitForSelector('#vacant-units');
      await go(pg, 'rent/property/p-maple'); if ((await pg.locator('.tabs a:has-text("Find a tenant")').count())) throw new Error('Find a tenant is still a tab');
      await go(pg, 'rent/property/p-maple/find'); await pg.waitForSelector('.find-page h1:has-text("Find a tenant")'); await pg.waitForSelector('.find-page .crumb:has-text("Back to Maple triplex")');
      await go(pg, 'find'); await pg.waitForSelector('.find-page h1:has-text("Find a tenant")');
    });
    await step(tag, 'H21 Rent tracking: switching to "I mark it" with banks connected asks first and names the banks it disconnects', async () => {
      await go(pg, 'settings/preferences'); const n = (await state(pg)).banks.length; if (!n) return 'no bank connected';
      await pg.click('#rt-manual'); await pg.waitForSelector('#rt-confirm >> text=disconnects');
      await pg.locator('#rt-confirm >> text=Keep my bank').click(); if ((await state(pg)).banks.length !== n) throw new Error('disconnected without confirming');
      await pg.click('#rt-manual'); await pg.click('#rt-manual-confirm'); await pg.waitForTimeout(250);
      if ((await state(pg)).banks.length !== 0) throw new Error('banks still connected');
    });
    await step(tag, 'H22 Expenses: tax years (current active) and Upload statement; a CSV is read, checked line by line, added once (a second upload of it adds nothing)', async () => {
      await go(pg, 'expenses'); await pg.waitForSelector('#tax-years .tax-year.on >> text=Current');
      for (const id of ['#upload-statement', '.add-expense']) if (!(await pg.locator(id).count())) throw new Error('missing ' + id);
      const csv = require('path').join(require('os').tmpdir(), `kh-${tag}-stmt.csv`);
      require('fs').writeFileSync(csv, 'Date,Description,Amount\n2026-10-01,E-TRANSFER MAYA CHEN,1650.00\n2026-10-03,ENBRIDGE GAS,-212.40\n2026-10-20,UNIQUE VENDOR 77,-86.45\n');
      const before = (await state(pg)).txns.length;
      for (const round of [1, 2]) {
        await pg.click('#upload-statement'); await pg.locator('#statement-file').setInputFiles(csv); await pg.waitForSelector('.statement-lines tbody tr');
        if ((await pg.locator('.statement-lines tbody tr').count()) !== 3) throw new Error('lines read');
        await pg.fill('#st-bank-0', 'RBC Royal Bank'); await pg.click('#statement-import'); await pg.waitForSelector('#statement-done');
        const st = await state(pg); const added = st.txns.length - before;
        if (round === 1 && (added !== 3 || !st.statements?.length)) throw new Error('added ' + added);
        if (round === 2 && added !== 3) throw new Error('second upload added again: ' + added);
        await pg.locator('.drawer-foot >> text=Done').click();
      }
    });
    await step(tag, 'H23 Paperwork → Taxes: From is January 1; close the year step by step; Regular costs include legal, management and Other, and × stops a suggestion', async () => {
      await go(pg, 'paperwork/taxes'); const y = await pg.inputValue('#tax-from'); if (!/-01-01$/.test(y)) throw new Error('From ' + y);
      await pg.waitForSelector('#close-year .close-steps'); for (const t of ['Bank statements', 'Rent', 'Mortgage payments', 'Property tax and insurance']) await pg.waitForSelector(`#close-year >> text=${t}`);
      if ((await pg.locator('#regular-costs > .rc-list:first-of-type li').count()) > 8) throw new Error('more than 8 boxes before Show more');
      if (await pg.locator('#rc-more').count()) await pg.click('#rc-more');
      for (const t of ['Legal fees', 'Management fees', 'Other']) await pg.waitForSelector(`#regular-costs >> text=${t}`);
      await pg.locator('#regular-costs li:has-text("Snow removal") .rc-x').click(); await pg.waitForTimeout(200);
      if (await pg.locator('#regular-costs > .rc-list:first-of-type li:has-text("Snow removal")').count()) throw new Error('still suggested after ×');
    });
    await step(tag, 'H24 Setup progress: four stages in order, the current one named; the ring has a colour for its score', async () => {
      await go(pg, 'today'); await pg.locator('.setup-circle:visible').first().click(); await pg.waitForSelector('.stage-bar li');
      if ((await pg.locator('.stage-bar li').count()) !== 4) throw new Error('stages'); await pg.waitForSelector('#score >> text=/Stage \\d of 4/');
      if (!(await pg.locator('.score-ring[class*="tone-"]').count())) throw new Error('no colour'); await pg.keyboard.press('Escape');
    });
    await step(tag, 'H25 Add an expense opens the form first; the camera is a button in it', async () => {
      await go(pg, 'expenses'); await pg.click('.add-expense'); await pg.waitForSelector('#ex-amt'); await pg.waitForSelector('#ex-photo');
      await pg.keyboard.press('Escape');
    });
    await step(tag, 'H26 Settings in 3 tabs (Profile, Preferences with Reminders and Data, Billing); old links open the right tab; Billing shows the plan and payment', async () => {
      await go(pg, 'settings'); if ((await pg.locator('.settings-tabs .tab').count()) !== 3) throw new Error('tabs');
      await go(pg, 'settings/data'); await pg.waitForSelector('#st-tab-preferences.on'); await pg.waitForSelector('#data'); await pg.waitForSelector('#reminders-receipts');
      await go(pg, 'settings#rent-tracking'); await pg.waitForSelector('#st-tab-preferences.on'); await pg.waitForSelector('#rent-tracking');
      await pg.click('#st-tab-billing'); await pg.waitForSelector('#billing-plan >> text=Your plan'); await pg.waitForSelector('#billing-pay >> text=No card on file');
      await go(pg, 'today'); await pg.waitForSelector('#ytd >> text=Net worth'); await pg.waitForSelector('#ytd h2:has-text("Portfolio summary")'); if (!/^Cash flow, \d{4} so far$/.test((await pg.locator('#ytd-cash').textContent()).trim())) throw new Error('cash flow has no year'); if (await pg.locator('.home-side >> text=/in review/').count()) throw new Error('month in review still on Home'); if ((await pg.locator('#ytd .ytd-over > div').count()) !== 2 || (await pg.locator('#ytd .ytd-over >> text=Properties').count())) throw new Error('overview should be Net worth and Units rented only'); if (await pg.$('#ytd-worth')) throw new Error('worth/owed line should be gone');
    });
    await step(tag, 'H26b Income → View shows the receipt as the tenant gets it (the PDF layout), and Download PDF gives that PDF', async () => {
      await go(pg, 'income'); await pg.locator('table.ledger button', { hasText: 'View' }).first().click();
      await pg.waitForSelector('#receipt-view .rcpt-head >> text=RENT RECEIPT'); await pg.waitForSelector('#receipt-view .rcpt-amount >> text=AMOUNT RECEIVED'); await pg.waitForSelector('#receipt-view .rcpt-stamp');
      const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#receipt-pdf')]);
      const head = require('fs').readFileSync(await dl.path()).subarray(0, 5).toString(); if (head !== '%PDF-') throw new Error('not a PDF: ' + head);
      await pg.keyboard.press('Escape');
    });
    await step(tag, 'H28 Income → Add other income: a bill share for a tenant, its receipt sent from the done step, tagged in the list and counted', async () => {
      await go(pg, 'income'); await pg.click('#income-other'); await pg.waitForSelector('.oi-kind.on >> text=Bill share');
      await pg.selectOption('#oi-who', { index: 1 }); if ((await pg.locator('#oi-bill option').count()) > 1) await pg.selectOption('#oi-bill', { index: 1 });
      await pg.fill('#oi-amt', '75'); await pg.click('#oi-save'); await pg.waitForSelector('#oi-done >> text=ready to send');
      await pg.locator('#oi-done .resend-receipt').click(); await pg.waitForTimeout(250); await pg.locator('.drawer-foot >> text=Done').click();
      await pg.waitForSelector('tr.other-income .inc-tag >> text=Bill share');
      const st = await state(pg); const inc = (st.income ?? []).find((i) => i.amount === 7500); if (!inc) throw new Error('not saved');
      const r = st.receipts.find((x) => x.incomeId === inc.id); if (!r || r.status !== 'sent') throw new Error('receipt not sent: ' + JSON.stringify(r));
      await pg.locator('tr.other-income button', { hasText: 'View' }).first().click(); await pg.waitForSelector('#receipt-view .rcpt-head >> text=PAYMENT RECEIPT'); await pg.keyboard.press('Escape');
    });
    await step(tag, 'H29 A bank deposit that matches no rent offers "Bill share or other" first; Taxes keeps improvements apart (class picker, download, how to file)', async () => {
      await pg.evaluate(() => { const k = 'keyholder:v1'; const s = JSON.parse(localStorage.getItem(k)); s.txns.push({ id: 'tx-bill', source: 'bank', date: s.txns[0]?.date ?? '2026-11-05', amount: 6123, payer: 'MAYA CHEN', memo: 'gas share', status: 'new' }); localStorage.setItem(k, JSON.stringify(s)); });
      await pg.reload(); await pg.waitForTimeout(600);
      await go(pg, 'rentals'); const dep = pg.locator('#bank-deposits .bank-row', { hasText: '$61.23' });
      if (await dep.count()) {
        await dep.locator('button.btn.primary').click(); await pg.waitForSelector('#md-other.primary'); await pg.waitForSelector('#md-other-hint');
        await pg.click('#md-other'); await pg.waitForSelector('#oi-save'); if ((await pg.inputValue('#oi-amt')) !== '61.23') throw new Error('amount not filled: ' + (await pg.inputValue('#oi-amt')));
        await pg.click('#oi-save'); await pg.waitForSelector('#oi-done'); await pg.locator('.drawer-foot >> text=Done').click();
        const st = await state(pg); if (st.txns.find((t) => t.id === 'tx-bill')?.status !== 'matched') throw new Error('deposit not filed');
      }
      await go(pg, 'paperwork/taxes'); await pg.waitForSelector('#improvements >> text=Capital improvements'); await pg.waitForSelector('#file-cca'); await pg.waitForSelector('#file-base');
      if (await pg.locator('#imp-download').isEnabled()) { const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#imp-download')]); const txt = require('fs').readFileSync(await dl.path(), 'utf8'); if (!/Adjusted cost base/.test(txt)) throw new Error('spreadsheet'); }
      await pg.click('#file-base'); await pg.waitForSelector('#file-base.on'); await pg.click('#file-cca'); await pg.waitForSelector('#file-cca.on');
    });
    await step(tag, 'H30 Months marked paid up show on Income with Send receipt; sending records the month and sends its receipt', async () => {
      await pg.evaluate(() => { const k = 'keyholder:v1'; const s = JSON.parse(localStorage.getItem(k)); const l = s.leases.find((x) => x.id === s.payments[0].leaseId); const ids = new Set([l.id]); s.payments = s.payments.filter((p) => !ids.has(p.leaseId)); l.start = '2026-01-01'; l.paidThrough = '2026-10'; delete l.end; localStorage.setItem(k, JSON.stringify(s)); });
      await pg.reload(); await pg.waitForTimeout(600);
      await go(pg, 'income'); const b = pg.locator('button[id^="pu-send-"]'); await b.first().waitFor();
      const n = await pg.locator('td >> text=marked paid up').count(); if (n < 1) throw new Error('no paid-up rows');
      const before = (await state(pg)).payments.length; await b.first().click(); await pg.waitForTimeout(300);
      const st = await state(pg); if (st.payments.length !== before + 1) throw new Error('no payment recorded');
      const pay = st.payments[st.payments.length - 1]; const r = st.receipts.find((x) => x.paymentId === pay.id); if (!r || r.status !== 'sent') throw new Error('receipt not sent');
      if ((await pg.locator('button[id^="pu-send-"]').count()) !== (await b.count())) throw new Error('row still offers send');
    });
    await step(tag, 'H31 What you pay: the mortgage and property tax in one card; changes start on a date (tax with the mortgage, new rate and payment)', async () => {
      const pid = (await state(pg)).mortgages[0].propertyId;
      await go(pg, `rent/property/${pid}/mortgage`); await pg.waitForSelector('#what-you-pay #pay-mortgage');
      await pg.click('#pay-tax-change'); await pg.click('#pt-mortgage'); await pg.fill('#pt-each', '450'); await pg.click('#pt-save');
      await pg.waitForSelector('#pay-tax >> text=paid with your mortgage'); await pg.waitForSelector('#pay-mortgage >> text=property tax collected by');
      await pg.click('#pay-mortgage-change'); await pg.fill('#mc-rate', '4.25'); await pg.fill('#mc-pay', '2450'); await pg.click('#mc-save');
      await pg.waitForSelector('#pay-mortgage >> text=$2,450.00');
      const m = (await state(pg)).mortgages[0];
      if ((m.changes || []).length !== 2 || !m.changes.some((c) => c.taxWithPayment === 45000) || !m.changes.some((c) => c.payment === 245000 && c.ratePct === 4.25)) throw new Error(JSON.stringify(m.changes));
    });
    await step(tag, 'H27 Resend a rent receipt from Income and from a tenant\'s messages; long lists show 8 lines, then Show more', async () => {
      await go(pg, 'income'); await pg.waitForSelector('.resend-receipt');
      const before = (await state(pg)).messages.length; await pg.locator('.resend-receipt').first().click(); await pg.waitForTimeout(250);
      if ((await state(pg)).messages.length < before) throw new Error('no message');
      const rows = await pg.locator('table.ledger tbody tr').count(); if (rows > 8) throw new Error(rows + ' rows before Show more');
      if (await pg.locator('.show-more').count()) { await pg.locator('.show-more').first().click(); if ((await pg.locator('table.ledger tbody tr').count()) <= 8) throw new Error('Show more did nothing'); }
      await go(pg, 'rent/tenant/t-maya'); await pg.waitForSelector('.section >> text=Messages sent');
      if ((await pg.locator('table.ledger tbody tr').count()) > 8) throw new Error('ledger longer than 8');
    });
    ok(tag, 'H errors', errsH.length === 0, errsH.slice(0, 3).join(' | '));

    // ---------------- I. Logo, and never the same buttons twice ----------------
    const errsI = [];
    pg = await (await b.newContext({ viewport: vp, timezoneId: 'America/Vancouver' })).newPage();
    pg.on('pageerror', (e) => errsI.push(`I ${e.message}`));
    const hidden = (sel) => pg.evaluate((x) => { const el = document.querySelector(x); return !el || getComputedStyle(el).visibility === 'hidden'; }, sel);
    const scrollTo = async (sel) => { await pg.evaluate((x) => document.querySelector(x).scrollIntoView({ block: 'center' }), sel); await pg.waitForTimeout(450); };
    await step(tag, 'I1 The logo is the house key, on the website and in the app', async () => {
      await pg.goto(BASE); if (!(await pg.locator('.lp-nav .keymark.km-b').count())) throw new Error('website logo');
      await adminIn(pg); if (!(await pg.locator(tag === 'phone' ? '.mobile-top .keymark.km-b' : '.rail .keymark.km-b').count())) throw new Error('app logo');
      await pg.locator('.sample-banner >> text=Sign out').click(); await pg.waitForSelector('.lp-hero-h');
    });
    await step(tag, `I2 ${tag === 'phone' ? "Bottom Get started bar hides while the page's own Get started shows" : 'Sign in and Sign up stay at the top right all the way down'}`, async () => {
      await pg.goto(BASE + '#/welcome'); await pg.waitForTimeout(500);
      if (tag === 'phone') {
        if (!(await hidden('.lp-sticky'))) throw new Error('shown at the top, next to the page button');
        await scrollTo('.lp-how .lp-step:nth-child(2)'); if (await hidden('.lp-sticky')) throw new Error('not shown mid-page');
        await scrollTo('.lp-cta-card'); if (!(await hidden('.lp-sticky'))) throw new Error('shown next to the closing card');
      } else {
        for (const sel of ['.lp-how .lp-step:nth-child(2)', '.lp-cta-card']) { if (await hidden('.lp-nav-cta')) throw new Error('hidden before ' + sel); await scrollTo(sel); }
        if (await hidden('.lp-nav-cta')) throw new Error('hidden next to the closing card');
        await pg.goto(BASE + '#/welcome/pricing'); await pg.waitForTimeout(500); if (await hidden('.lp-nav-cta')) throw new Error('hidden on Pricing');
      }
    });
    await step(tag, 'I3 The menu lights up the page you are on (Overview, Features, Contact)', async () => {
      if (tag === 'phone') return 'computer menu';
      for (const [r, l] of [['', 'Overview'], ['features', 'Features'], ['contact', 'Contact']]) {
        await pg.goto(BASE + '#/welcome/' + r); await pg.waitForTimeout(300);
        if ((await pg.locator('.lp-links a.on').textContent()) !== l) throw new Error(`${r || 'overview'}: not ${l}`);
      }
    });
    await step(tag, 'I4 Provinces opens on the province of the device (Vancouver → BC)', async () => {
      await pg.goto(BASE + '#/welcome/provinces'); await pg.waitForSelector('.lp-tile.on');
      if ((await pg.locator('.lp-tile.on').textContent()) !== 'BC') throw new Error('selected ' + (await pg.locator('.lp-tile.on').textContent()));
      await pg.waitForSelector('.lp-map-hint >> text=time zone');
    });
    await step(tag, 'I5 After signing out: Sign in and Sign up at the top right, one Get started on the banner', async () => {
      await onboard(pg); await pg.waitForSelector('text=Start here');
      await go(pg, 'settings'); await pg.locator('.signout-icon:visible').click(); await pg.waitForSelector('.lp-hero-h');
      const hero = (await pg.locator('.lp-hero [data-cta] .btn').allTextContents()).join('|');
      if (hero !== 'Get started') throw new Error('banner buttons: ' + hero);
      if (tag !== 'phone') { const top = (await pg.locator('.lp-nav-cta .btn').allTextContents()).join('|'); if (top !== 'Sign in|Sign up') throw new Error('top right: ' + top); }
    });
    ok(tag, 'I errors', errsI.length === 0, errsI.slice(0, 3).join(' | '));

    // ---------------- J. Support dashboard (admin / admin) ----------------
    const errsJ = [];
    pg = await (await b.newContext({ viewport: vp })).newPage();
    pg.on('pageerror', (e) => errsJ.push(`J ${e.message}`));
    await step(tag, 'J1 admin / admin opens the support dashboard: what needs you, and the numbers', async () => {
      await login(pg, 'admin', 'admin'); await pg.waitForSelector('.sp-head h1:has-text("Overview")');
      if ((await pg.locator('.sp-needs li').count()) < 3) throw new Error('needs-you list short');
      if ((await pg.locator('.sp-tiles.four .sp-tile').count()) !== 4) throw new Error('number tiles');
    });
    await step(tag, 'J2 Every support page opens, with no sideways scroll', async () => {
      for (const [p, h] of [['inbox', 'Inbox'], ['customers', 'Customers'], ['revenue', 'Revenue'], ['growth', 'Growth'], ['health', 'System health'], ['rules', 'Province rules'], ['announcements', 'Announcements'], ['privacy', 'Privacy & audit'], ['team', 'Team & settings']]) {
        await go(pg, 'support/' + p); await pg.waitForSelector(`.sp-head h1:has-text("${h}")`);
        if (await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error(`${p}: sideways scroll`);
      }
    });
    await step(tag, 'J3 Inbox: open a request, send a saved reply; it waits on the customer and is logged', async () => {
      await go(pg, 'support/inbox'); const subject = (await pg.locator('.sp-tickets strong').first().textContent()).trim();
      await pg.locator('.sp-tickets a').first().click(); await pg.waitForSelector('.sp-thread');
      await pg.locator('.sp-reply select').selectOption({ index: 1 }); await pg.locator('.sp-reply-foot .btn.primary').click(); await pg.waitForTimeout(200);
      await pg.waitForSelector('.sp-head >> text=Waiting on them');
      await go(pg, 'support/privacy'); await pg.waitForSelector('.ledger >> text=Reply sent'); return subject;
    });
    await step(tag, 'J4 Search finds a customer and adds a note (no trial: Starter is free for good)', async () => {
      await go(pg, 'support'); const name = (await pg.locator('.sp-list strong').first().textContent()).trim();
      await pg.fill('#sp-q', name); await pg.locator(`.sp-search-res >> text=${name}`).first().click(); await pg.waitForSelector(`.sp-head h1:has-text("${name}")`);
      if (await pg.locator('text=Extend trial').count()) throw new Error('trial button still there');
      await pg.fill('#cn', 'Called about rooms'); await pg.locator('.sp-addrow button').first().click(); await pg.waitForSelector('text=Called about rooms');
      return name;
    });
    await step(tag, 'J5 Announcements: a message for both shows on the website and in the app, then hides', async () => {
      await go(pg, 'support/announcements'); await pg.fill('.sp-card textarea', 'Bank checks pause tonight at 2 a.m.');
      await pg.locator('.seg[aria-label="Show on"] >> text=Both').click(); await pg.locator('.sp-card .btn.primary', { hasText: 'Post' }).click(); await pg.waitForTimeout(200);
      await go(pg, 'welcome'); await pg.waitForSelector('.announce.website >> text=Bank checks pause');
      // The app side, with the demo login (admin only opens the dashboard), then back to the dashboard.
      await go(pg, 'support'); await pg.locator('.sp-rail-foot >> text=Sign out').click(); await pg.waitForSelector('.lp-hero-h');
      await login(pg, 'test', 'test'); await pg.waitForSelector('.announce.app >> text=Bank checks pause');
      await pg.locator('.tour-card >> text=Skip tour').click(); await go(pg, 'settings'); await pg.locator('.signout-icon:visible').click(); await pg.waitForSelector('.lp-hero-h');
      await login(pg, 'admin', 'admin'); await pg.waitForSelector('.sp-head');
      await go(pg, 'support/announcements'); await pg.locator('.sp-rows li', { hasText: 'Bank checks pause' }).locator('text=Hide').click(); await pg.waitForTimeout(200);
      await go(pg, 'welcome'); if (await pg.locator('.announce').count()) throw new Error('still showing after Hide');
    });
    await step(tag, 'J6 Privacy: answer a data request; it leaves the to-do list', async () => {
      await go(pg, 'support/privacy'); const n = await pg.locator('.sp-rows li').count();
      await pg.locator('.sp-rows li').first().locator('.btn.primary').click(); await pg.waitForTimeout(200);
      if ((await pg.locator('.sp-rows li').count()) !== n - 1) throw new Error('request still open');
    });
    await step(tag, 'J7 Revenue: retry a failed payment; Province rules: mark one checked', async () => {
      await go(pg, 'support/revenue'); const before = await pg.locator('text=Retry payment').count(); await pg.locator('text=Retry payment').first().click(); await pg.waitForTimeout(200);
      if ((await pg.locator('text=Retry payment').count()) !== before - 1) throw new Error('payment still failed');
      await go(pg, 'support/rules'); await pg.locator('tr', { hasText: 'Alberta' }).locator('text=Checked today').click(); await pg.waitForTimeout(200);
      if (!(await pg.locator('tr', { hasText: 'Alberta' }).locator('text=Verified').count())) throw new Error('Alberta not verified');
    });
    await step(tag, 'J7b Super user (admin / admin): a new price shows on the website; a promo code; no Banks page, every bank can be picked', async () => {
      const groups = await pg.locator('.sp-nav-group > p').allTextContents(); if (!groups.includes('Super user')) throw new Error('no Super user group');
      await go(pg, 'support/pricing'); await pg.fill('#sp-price', '12'); await pg.locator('#price >> text=Save price').click(); await pg.waitForSelector('#price >> text=$12.00');
      await pg.fill('#promo-code', 'PREVIEW10'); await pg.fill('#promo-value', '10'); await pg.locator('#promotions >> text=Add code').click(); await pg.waitForSelector('#promotions >> text=PREVIEW10');
      // Comparison rates: savings and the stock index fund are set here; the GIC is the Bank of Canada's.
      await pg.waitForSelector('#benchmarks >> text=/5-year GIC: [0-9.]+%/'); await pg.fill('#bm-savings', '3.3'); await pg.fill('#bm-index', '6.8');
      await pg.locator('#benchmarks >> text=Save rates').click(); await pg.waitForSelector('#benchmarks >> text=High-interest savings: 3.3%');
      if (await pg.locator('.sp-nav a:has-text("Banks"), a[href*="support/banks"]').count()) throw new Error('the Banks page is still in the menu');
      if (await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('sideways scroll');
      await go(pg, 'welcome/pricing'); await pg.locator('.lp-price.best').scrollIntoViewIfNeeded(); await pg.waitForSelector('.lp-price.best >> text=$12');
      // Every bank can be picked in the sample landlord app (test / test): there is no turning banks off.
      await go(pg, 'support'); await pg.locator('.sp-rail-foot >> text=Sign out').click(); await pg.waitForSelector('.lp-hero-h');
      await login(pg, 'test', 'test'); await pg.waitForSelector('.rent-row'); await pg.locator('.tour-card >> text=Skip tour').click(); await pg.waitForTimeout(200);
      await go(pg, 'settings#rent-tracking'); await pg.locator('#rt-add').click(); await pg.waitForSelector('.drawer');
      if (await pg.locator('.drawer .choice:has-text("RBC")').isDisabled()) throw new Error('RBC cannot be picked');
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
      // The rates set on the dashboard reach the app: a Silver property's "Your money is earning".
      await pg.reload(); await go(pg, 'today'); await pg.waitForSelector('.rent-row');
      const silver = await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('keyholder:v1')); const p = s.properties.find((x) => x.purchasePrice && x.purchaseDate); return p && p.id; });
      if (!silver) throw new Error('the sample has no property with a purchase price');
      await go(pg, `rent/property/${silver}/value`); await pg.waitForSelector('.bench-sources >> text=High-interest savings 3.3%');
      await pg.waitForSelector('.bench-sources >> text=/5-year GIC [0-9.]+%: Bank of Canada/');
      // Address suggestions when adding a property (the preview suggests from sample addresses).
      await go(pg, 'rentals'); await pg.locator('button:has-text("Add property"), a:has-text("Add property")').first().click(); await pg.waitForSelector('#pp-addr');
      await pg.locator('#pp-addr').pressSequentially('453 w 12', { delay: 20 }); await pg.waitForSelector('.addr-list >> text=Vancouver, BC');
      await pg.locator('.addr-list button').first().click(); await pg.waitForTimeout(150);
      const filled = [await pg.inputValue('#pp-addr'), await pg.inputValue('#pp-prov'), await pg.inputValue('#pp-city'), await pg.inputValue('#pp-postal')].join(' | ');
      if (filled !== '453 W 12th Ave | BC | Vancouver | V5Y 1V4') throw new Error('filled: ' + filled);
      await pg.locator('.drawer >> text=Cancel').click(); await pg.waitForTimeout(150);
      await go(pg, 'settings'); await pg.locator('.signout-icon:visible').click(); await pg.waitForSelector('.lp-hero-h');
      await login(pg, 'admin', 'admin'); await pg.waitForSelector('.sp-head');
    });
    await step(tag, 'J7c admin / admin sees only the dashboard: no sample landlord app button, the app redirects to the dashboard', async () => {
      if (await pg.locator('text=Sample landlord app').count()) throw new Error('Sample landlord app button still there');
      await go(pg, 'today'); await pg.waitForSelector('.sp-head'); const h = await pg.evaluate(() => location.hash); if (!h.startsWith('#/support')) throw new Error('opened ' + h);
    });
    await step(tag, 'J7d Connections lists every service (in use: Google, Email, Address lookup, Plaid; coming: Stripe; no property values)', async () => {
      await go(pg, 'support/connections'); await pg.waitForSelector('#conn-preview');
      for (const [g, names] of [['now', ['Google sign-in', 'Email (Resend)', 'Address lookup (Google Places)', 'Bank data (Plaid)']], ['coming', ['Stripe payments']]]) {
        const got = await pg.locator(`#group-${g} .sp-conn h2`).allTextContents();
        if (got.join('|') !== names.join('|')) throw new Error(`${g}: ${got.join(', ')}`);
      }
      if (await pg.locator('text=Flinks').count()) throw new Error('Flinks still listed');
      if (await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('sideways scroll');
    });
    await step(tag, 'J7e Overview: Needs you now and the map half and half (map on the right); a dot per city, the busiest places listed', async () => {
      await go(pg, 'support'); await pg.waitForSelector('.sp-lmap svg');
      const dots = await pg.locator('.sp-lmap-dot').count(); if (dots < 10) throw new Error(dots + ' dots');
      // Top row: Needs you now on the left, the map on the right, half and half, same height (stacked on phones).
      const boxes = await pg.evaluate(() => [...document.querySelectorAll('.sp-top-row > section')].map((x) => { const r = x.getBoundingClientRect(); return { id: x.getAttribute('aria-labelledby'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }));
      if (boxes.map((x) => x.id).join() !== 'needs,map') throw new Error('order: ' + JSON.stringify(boxes));
      if (tag !== 'phone' && !(boxes[1].x > boxes[0].x && Math.abs(boxes[0].w - boxes[1].w) <= 2 && Math.abs(boxes[0].h - boxes[1].h) <= 2 && boxes[0].y === boxes[1].y)) throw new Error('not half and half: ' + JSON.stringify(boxes));
      if (tag === 'phone' && !(boxes[1].y > boxes[0].y)) throw new Error('not stacked: ' + JSON.stringify(boxes));
      if ((await pg.locator('.sp-lmap-prov').count()) !== 13) throw new Error('provinces and territories missing');
      const box = await pg.locator('.sp-lmap svg').boundingBox(); if (!box || box.height < 150) throw new Error('map too small');
      await pg.locator('.sp-lmap-top li').first().hover(); await pg.waitForSelector('.sp-lmap-caption >> text=landlords');
      await pg.waitForSelector('text=City level only');
    });
    await step(tag, 'J8 Sign out returns to the website, and the dashboard is closed again', async () => {
      if (tag === 'phone') await go(pg, 'support');
      await pg.locator('.sp-rail-foot >> text=Sign out').click(); await pg.waitForSelector('.lp-hero-h');
      await go(pg, 'support'); await pg.waitForTimeout(200); if (await pg.locator('.sp').count()) throw new Error('dashboard still open');
    });
    ok(tag, 'J errors', errsJ.length === 0, errsJ.slice(0, 3).join(' | '));
  }
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.tag.padEnd(7)} ${r.name}${r.note ? ' — ' + r.note : ''}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
  await b.close();
})();
