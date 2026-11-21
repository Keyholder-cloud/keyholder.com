# Keyholder: next upgrades (requirements)

Agreed with the owner on 2026-11-11 ("go with your recommendations"). Built in three phases, in order.
Phase 3 waits until the owner has created the Stripe and Plaid accounts.

Status: ☐ to do · ◐ in progress · ☑ done

## Phase 1: fixes (no outside services)

### R1. Sign up first, then the questions ☑
- Order: **Sign up** (Continue with Google, or first + last name, email, password) → **the questions** →
  **"Here's what Keyholder will automate for you"** → **Go to dashboard** → the 5-step tour.
- Google is finished before any question is asked. The plan page has no Google or email boxes.
- The name question is removed (Google or the signup form gives the first and last name).
- Someone who stops halfway has an account; their next sign-in opens the questions.
- "Email me when something needs me" stays on the plan page, above Go to dashboard.
- The browser-only preview follows the same order (with its simulated Google picker and email link).

### R2. No pretend bank on the live site ☑
- Today "Connect a bank" is a simulation: it pretends to connect, adds made-up deposits every few hours and
  counts toward setup progress.
- Live site (server): "Connect a bank" says "Coming soon" until a real bank service is connected (R12).
  The browser-only preview keeps the simulation for demos.
- Setup progress counts only a real bank connection; while banks are off, that step is not listed.
- Clean-up of live accounts: remove the pretend connection, its made-up deposits and any rent those
  deposits marked as paid. Each removal is written to the account's history. Real Plaid connections (R12) and
  their transactions are never removed, even while banks are turned off.

### R3. Sign out: small icon, Settings page only ☑
- On Settings, a small Sign out icon at the top right (next to the setup circle and the Settings icon).
- No other page shows it. The big Sign out button by the Settings title is removed.

### R4. Write to us in its own popup ☑
- Help → "Write to us" closes Help and opens a separate popup: Subject, Message, Send. The confirmation
  shows in that popup.

### R5. Appearance higher in Settings ☑
- Order: Your profile → Appearance → Rent tracking → Receipts and reminders → Data.

## Phase 2: super user and team (no outside services)

### R6. Super user ☑
- The account set as `ADMIN_EMAIL` in Render becomes the **super user** (the email stays in Render, never
  in the code).
- The super user has every admin power plus R7 to R10.
- Only the super user adds, changes or removes team accounts. Two kinds:
  - **Admin**: today's admin ("Owner") powers, without the super-user extras.
  - **Support**: today's Support powers.
- Nobody can remove the super user or change the super user's powers.

### R7. Premium price ☑
- The super user sets the Landlord plan price (today $8 per unit a month) in the dashboard.
- The website's Pricing page and answers update automatically.
- A new price applies to **new subscribers only**; existing subscribers keep theirs.

### R8. Promotions ☑
- Promo codes: % or $ off, for how many months, end date, maximum uses. Pause or end a code.
- Landlords enter a code when they upgrade; the dashboard shows how many times each was used.
- With Stripe on (R11), codes apply at checkout. (Phase 2 built creating, pausing and ending codes; the use count
  starts once checkout exists.)

### R9. Turn banks off ☑
- One switch turns bank connection off for everyone.
- Single banks can be turned off (e.g. one bank's connection is broken); landlords then see
  "Not available right now" for that bank.

### R10. API keys in the dashboard ☑
- "Connections" page, super user only: Google sign-in, email (Resend), address lookup (Google Places), Stripe,
  bank data (Plaid), property values (AVM). Grouped "In use" and "Coming"; the preview shows the same list.
  Each shows its status, a Test button, and lets you enter or replace keys.
- Keys are stored encrypted with `KEYS_SECRET` (a new Render setting). After saving only the last 4
  characters show. Changing a key asks for the password. Every change is logged.
- Keys set in Render keep working; a key saved in the dashboard takes over.

### R13. Address autocomplete (Google Places) ☑
- Typing a property address suggests Canadian addresses; picking one fills street, city, province, postal code
  and the map position. Through the server (the key never reaches the browser), signed-in people only, 60 a
  minute each. Plain box until the key is set on Connections. The preview suggests from sample addresses.

### R14. Overview map ☑
- Support → Overview: a map of Canada (provinces drawn in), one dot per city where landlords' rentals are,
  bigger for more landlords, with the busiest places listed. City level only, never street addresses.

### R15. Admin sees only the dashboard ☑
- No "Sample landlord app" button; admin / admin in the preview opens only the support dashboard too.

## Phase 3: payments and real bank data (needs the owner's Stripe and Plaid accounts)

### R11. Stripe payments ☐
- Upgrade to the Landlord plan by card on Stripe Checkout (Keyholder never sees card numbers).
- Monthly, per unit. Stripe's billing page: change card, invoices, cancel.
- Promo codes (R8) apply at checkout. The dashboard's Revenue page shows real payments.

### R12. Real bank connection (Plaid), "Link bank" on Income and Expenses ☑
- Plaid (chosen over Flinks by the owner): Plaid Link for the landlord to sign in to their bank, then read-only
  transactions. Self-serve signup and a free sandbox to build and test with; major Canadian banks.
- A small "Link bank" button by the title of Income and Expenses.
- Deposits appear in Income to match to rent; withdrawals appear in Expenses to file. Read-only.
- Real time, without extra Plaid charges: Plaid keeps its own copy of each bank up to date and tells Keyholder
  (a signed webhook) as soon as it has new transactions; Keyholder reads them from Plaid's copy
  (`/transactions/sync`, included in Plaid's monthly fee per connected bank). "Check now" does the same read.
  Keyholder never asks a bank for fresh data (`/transactions/refresh`, billed per request).
- Disconnecting a bank (or deleting the account) removes the connection at Plaid too, so it stops being billed.
- A deposit that clearly is a tenant's rent is marked paid (receipt drafted); others wait to be confirmed. Bills
  from a vendor filed before are filed again the same way.
- Real bank data needs Plaid's Production access (a business review; some Canadian banks also need an OAuth
  registration that can take weeks: start early).

### R16. Property values (AVM): removed 2026-11-14 (see R22)
- An estimated market value for each property, updated monthly, from an AVM provider. Recommended: Repliers
  Estimates to start (documented API, values from an address); Teranet (Home Value Range) for lender-grade
  values; RPS also estimates rents. MLS® (CREA DDF) has no sold prices and needs a REALTOR® and a CREA
  agreement, so it is not used for values. The Connections page has the slot (provider + API key).
- Until a provider is connected, values come from the purchase price and a market index, labelled estimates.
- Built (owner, 2026-11-12: "show the Repliers estimate even before the purchase price or mortgage"):
  - Repliers' API (docs.repliers.io/reference/create-an-estimate) needs the postal code, bedrooms, bathrooms,
    square feet, and the property type and style as the MLS board writes them. The property's Value page asks
    for these once ("Get this home's value from Repliers"), with type and style picked from the board's own list.
    No purchase price or mortgage needed.
  - The value shows on the Value page and the property card: "Worth about $X, likely between $low and $high ·
    Repliers Estimates · date · usually within about N%". Where the owner lives in part of the home, the whole
    home's value and the rented share are both shown. Refreshed about once a month.
  - If Repliers cannot value a home (add-on off, a field it does not accept…), the Value page shows Repliers'
    reason and "Try again"; Support → Health logs it.
  - The server keeps each answer 30 days per home (address and details), so a home is paid for once a month;
    corrected details ask again.
  - Without a provider the figure is labelled "Rough estimate from the rent, not an appraisal" or "Estimate from
    what you paid and the local price trend" ("Sample AVM (placeholder)" is gone).
  - Connections → Property values: optional Repliers board ID (for a key that covers more than one MLS board).
    Test checks the key, lists the board's types, styles and boards, and values a sample home.

### R19. Comparison rates ☑
- "Your money is earning" compares a property's return with high-interest savings, a 5-year GIC and a broad stock
  index fund. These were fixed placeholder numbers (2.75%, 3.6%, 7.5%).
- 5-year GIC: the Bank of Canada's weekly figure for the big banks' posted 5-year GIC rate (Valet API, series
  V80691341, free, no key), read by the server each day. 2.75% for the week of Nov 4, 2026.
- High-interest savings and the stock index fund have no official rate: the super user sets them on Price &
  promotions → Comparison rates. Each rate shows its source and date in the app.

### R17. Tenants older than Keyholder: in good standing? ☑
- Adding a tenant whose lease started before this month asks: are they in good standing, and the last month
  they paid rent in full. Months up to then count as paid ("Paid before Keyholder" in the ledger).
- Tenancies added before this question existed, showing unpaid months from before the landlord started
  Keyholder, get the same question on Home and on the tenant's page, once.

### R18. Bigger Settings and Sign out ☑
- Computers: labelled buttons (icon + word, 44px tall) at the top right; Sign out on the Settings page only.
- Phones: larger icons with the word under each. The support dashboard's Sign out is a bordered button too.

### R20. Notices are official documents (Ontario) ☑
- Owner, 2026-11-12: "Update my notices to be official documents since backend is now completed."
- On the live site, Ontario's notices are the Landlord and Tenant Board's own forms, filled in by the server from
  Keyholder's records: N4 (2026/09), N1 and N2 (v. 01/04/2022), N5 (2026/09), N12 (2026/10), N11 (v. 01/04/2022).
  The files are Tribunals Ontario's (server/forms/ltb, every page identical to the published form); Keyholder fills
  only their fields. "Open the filled form (PDF)" before approving; approving signs it with the landlord's name and
  keeps exactly what was filled in, so the served form can be opened again from any notice list ("Official form").
- Served by email (the tenant agreed to notices by email): the official form is emailed to everyone on the lease as
  a PDF attachment.
- What each form needs is asked in the notice screen: N1 or N2 (units first lived in after Nov 15, 2018 use the N2),
  above-guideline reason (LTB order or application), the landlord's mailing address (N1, N2), N5 reason, first or
  second N5 and up to three dated events (and repair or replacement cost), N12 who moves in and their relation.
- Dates follow the forms: N4 7 days (+5 by mail); N5 20 days (14 for a second N5); N12 at least 60 days, on the last
  day of a rental period and not before a fixed term ends.
- Applications (L1, L9, L2) are filed online through the Tribunals Ontario Portal; the served notice is attached
  there. Other provinces: Keyholder's summary with a link to the official form.

### R21. Unit menu above the card ☑
- The "⋯" menu on a unit row on Rentals opens on top of the page (not cut off by the card), next to its button, upward
  near the bottom of the screen, and follows the button when the page scrolls.

### R22. No property estimates: worth is what you paid, or your own estimate ☑
- Owner, 2026-11-14: "remove the property valuation as it does not appear to be accurate. The user would have to enter
  the purchase price and how much is owed will be used to calculate asset value." Keep an optional "your own
  estimate" box.
- Removed: Repliers estimates (Value page, server, Connections slot; its saved key and cache are deleted), the rough
  guess from the rent, the local price trend, nearby sales, the monthly value check and estimated value growth.
- Worth = your latest own estimate or appraisal (optional, dated, removable) or else what you paid. Yours = worth ×
  your ownership − what is owed (mortgage, or your figure). Without a purchase price or an estimate: "Add what you
  paid", and the property is left out of net worth and the return until then.
- The return is rent left over plus mortgage paid down in the last 12 months, on your money in it; still compared
  with savings, a GIC and a stock index fund. Room to borrow and a rough sale figure use the same worth.
- Bank data stays with Plaid. Stripe Financial Connections offers Canadian bank data only in rollout (general
  availability planned for Q4 2026); revisit once Stripe confirms transaction history for Canadian banks.


### R23. Old estimates gone everywhere; "Keyholder was updated" ☑
- Owner, 2026-11-14: "My dashboard is still showing repliers estimate, not sure where its getting the data from."
- Estimates saved by earlier versions (Repliers, price trend, nearby sales) are removed from each account the next
  time it opens; only what the landlord entered stays (purchase price, own estimate, appraisal). The audit log notes it.
- Problems logged by the removed property values service are closed on the support dashboard's Health page.
- A tab left open keeps running the version it loaded: the server reports a fingerprint of the app it serves, and the
  app checks it every few minutes and when the tab comes back. A new version shows "Keyholder was updated. Reload to
  get the latest version." with a Reload button.

### R24. Rent status that stays put, for every kind of rental ☑ (replaces the per-person shares of 2026-11-14)
- Owner, 2026-11-20: "I no longer see paid on lara after she has paid for the month and her receipt is sent ... for
  folks that rent a unit by the room ... after I mark them as paid they go back to asking me if they have paid rent.
  Make it like it is for Lara." and "It should reflect Rent Paid - Nov 1, similar to rent due ... hover shows a question
  mark but green".
- Paid rows show a green "Rent paid · Nov 1" pill (the day it was paid) on Home and Rentals, with the same "?" help as
  "Rent due"; its explanation bubble is green.
- Cause found for rooms: rooms usually have the same rent; a bank deposit for rent already marked paid by hand was
  offered to the next unpaid room ("Rent to confirm"). Now such a deposit is attached to that payment, whichever came
  first (deposit up to a month before or two weeks after); a named sender only matches their own rent; when rooms
  have the same rent and the sender names nobody, "Whose rent is it?" lists the rooms (and rent already marked paid)
  with nothing pre-picked.
- Rooms show under their unit on Home and Rentals ("Unit Upper · by the room · 2 of 3 paid"); each room row works like
  a whole unit. A room tenant whose lease has no room number still shows. The rent roll has a row per room.
- Several people on one lease: one row and one Mark paid (the per-person rows and shares were removed). Mark paid
  fills this month first, while it is unpaid.

### R25. Security & privacy page; ready for Plaid production ☑
- Owner, 2026-11-20: a documentation page with the sections needed to comply with Plaid, in the current design, and a
  Word document with the answers Plaid asks to become a commercial user.
- Website page /welcome/security (footer "Trust" column; linked at sign-up and before Plaid opens): Plaid bank
  connections, what we collect and why, what we never do, consent and choices, retention and deletion, protections,
  incidents, service providers, tenants' information, PIPEDA rights, terms of use, reporting a security issue.
- "Connect your bank" names Plaid and links Plaid's End User Privacy Policy before "Continue to your bank".
- The Word document (kept outside the repository) answers Plaid's company and application profile, use case, the
  25-question security questionnaire with an honest status for each, and includes a starter security policy, the
  retention policy and an action list. Contact: admin@keyholder.cloud (owner, 2026-11-21).

### R26. Rooms, ending a lease, deleting a tenant ☑
- Owner, 2026-11-21: "I have 3 tenants by the room but it shows that no rooms are rented" and "Can't see the option to
  end lease or delete tenant".
- A unit rented by the room counts every room with a tenant, also before rent starts: "3 rooms rented · rent starts
  Dec 1", then "2 of 3 paid".
- End lease and Delete tenant are on each unit's or room's ⋯ menu in Rentals and at the top of the tenant's page.
  End lease: the last day; no rent after it; history kept. Delete tenant (added by mistake): removes the tenant, their
  lease(s), payments, receipts, messages and notices; with payments on record it suggests ending the lease instead.

### R27. Two-step sign-in ☑
- Owner, 2026-11-21: "Turn on two step login for keyholder as a step" (optional for landlords).
- After the password (or Google, or a new password), a 6-digit code from an authenticator app (Google Authenticator,
  Microsoft Authenticator, 1Password…), or one of ten backup codes; "Trust this browser for 30 days".
- Landlords: optional; Settings → Two-step sign-in (QR code or key, first code, backup codes; new codes; turn off with a
  code); a Start here step for new accounts and a "Turn on" card on Home (Not now hides it for 30 days).
- The Keyholder team: required before the support dashboard opens. ADMIN_RESET_TWO_STEP=true (Render, then restart)
  turns the super user's off if their phone and backup codes are lost.
- The secret is stored encrypted (KEYS_SECRET); codes cannot be reused; 5 wrong codes end the attempt; a new password
  forgets trusted browsers. Sign-ins, failures and changes are in the audit log.
- Render: render.yaml asks for the Starter web plan (always on; the free plan sleeps after 15 minutes) and the
  basic-256mb database (backups). Emails are sent from admin@keyholder.cloud.


### R28. Fingerprint or face for two-step sign-in ☑
- Owner, 2026-11-21: "enable biometrics for 2FA instead of Google 2FA only".
- Passkeys (WebAuthn, user verification required): Face ID, Touch ID, Windows Hello, Android fingerprint. Settings →
  Two-step sign-in: turn it on with fingerprint/face or an authenticator app; add more devices; remove one; add the app
  later. The first device turns two-step on and shows the backup codes.
- At sign-in the code step shows "Use fingerprint or face" when the account has a device; the code box stays as a
  fallback (app code or backup code). Turning off and new backup codes also accept fingerprint or face.
- Counts as the team's required two-step. The only remaining method cannot be removed. Turning off removes devices.

### R29. Profile changes wait for Save ☑
- Owner, 2026-11-21: "when I update profile, e.g. add phone number there is no button to save".
- Settings → Your profile: a Save button (off until something changes), "You have changes that are not saved yet.",
  then "Saved".

### R30. Units tab and Add tenant tab ☑
- Owner, 2026-11-21: "Have a separate tab for 'Add Tenant'. Tenants can be added to vacant Units. Highlight that
  landlord need a vacant unit."
- A property has "Units" (units and rooms, Add a unit) and "Add tenant" (lists the vacant units and rooms and the
  form; with none, "You need a vacant unit to add a tenant." with Add a unit). A vacant row's ⋯ has Add tenant.

### R31. Delete a unit, end a lease, archive a property ☑
- Owner, 2026-11-21: "Make it more intuitive to delete a unit, if it has not been populated, end lease for a tenant,
  and archive a property in general (eg. if it is sold)."
- Delete unit: in the unit's ⋯ menu and Edit unit, only if it never had a tenant (otherwise greyed with the reason).
- End lease: in the ⋯ menu of every rented unit or room and on the tenant's page.
- Archive property (top of the property page): Sold or No longer rented, a date; running leases end that day; it leaves
  Home, Rentals and totals; records stay and taxes count it up to that date; Restore from the bottom of Rentals.

### R32. Bronze: one clear two-step path ☑
- Owner, 2026-11-21: "multiple paragraphs asking to Add what I paid ... make the progression more clear ... grey out
  the next".
- One "Two steps to see your full picture" box: 1 Add what you paid, 2 Add your mortgage ("Do step 1 first" until
  done). The duplicate buttons are gone; "Use your own estimate instead" stays as a small link.
