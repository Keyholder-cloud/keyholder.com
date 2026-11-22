import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fstatic from '@fastify/static';
import { z, ZodError } from 'zod';
import type { AppState } from '../src/data/types';
import { emptyState } from '../src/data/seed';
import type { Config } from './config';
import type { Db } from './db';
import { queueMail, recordError } from './email';
import { newTicketAdminMail, resetMail, ticketAckMail, welcomeMail } from './mails';
import { burnPasswordCheck, newToken, normEmail, passwordProblem, sha256, verifyPassword, hashPassword } from './security';
import { backupHash, checkCode, looksLikeBackup, newBackupCodes, newSecret, otpauthUri } from './totp';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, AuthenticatorTransport } from '@simplewebauthn/server';
import {
  accountFor, audit, createLinkToken, createSession, createUser, endAllSessions, endSession, isTeam, publicUser, readState, sessionUser,
  SESSION_COOKIE, stateProblem, useLinkToken, userByEmail, userById, writeState, type User,
} from './services';
import { applyChange, benchmarksNow, customerState, deleteAccount, snapshot, startFresh, unitPrice } from './support';
import { fieldOf, Keys, type ServiceId } from './keys';
import { applyBankUpdate, dropBankFromState, itemByPlaidId, itemsFor, Plaid, PlaidError, syncItem } from './plaid';
import { fillOfficial, formFilename, OfficialFormError } from './officialForms';
import { hasOfficialForm, OFFICIAL } from '../src/lib/ltbForms';
import { formById } from '../src/lib/forms';

declare module 'fastify' {
  interface FastifyRequest { user: User | null; sessionToken: string | null }
}

/** A browser remembered after the second step ("Remember this device?"). Site-wide, so it always comes back. */
const TRUST_COOKIE = 'kh_device';
/** The earlier name (path /api/auth): still read, and cleared when a new one is set. */
const OLD_TRUST_COOKIE = 'kh_trust';
/** Every remembered-device token the browser sent (old and new names; a browser can hold more than one). */
const trustTokens = (req: FastifyRequest): string[] => {
  const raw = String(req.headers.cookie ?? '');
  const out = new Set<string>();
  for (const part of raw.split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k === TRUST_COOKIE || k === OLD_TRUST_COOKIE) { try { out.add(decodeURIComponent(part.slice(i + 1).trim())); } catch { /* not ours */ } }
  }
  return [...out].filter(Boolean);
};
/** The support dashboard asks the team for two-step sign-in; the app shows the set-up when it sees this. */
export const TEAM_TWO_STEP = 'Two-step sign-in is required for the Keyholder team. Set it up to continue.';

export const VERSION = '2.0.0';

/** Thrown to send a clear message with a status code. */
class Http extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string) => { throw new Http(status, message); };

export interface Deps { cfg: Config; db: Db; fetch?: typeof fetch; staticDir?: string | null; keys?: Keys; plaid?: Plaid }

export async function buildApp({ cfg, db, fetch: fetcher = fetch, staticDir, keys = new Keys(cfg), plaid = new Plaid(keys, fetcher, cfg.plaidBaseUrl) }: Deps) {
  const app = Fastify({
    logger: cfg.logLevel === 'silent' ? false : { level: cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    bodyLimit: 12 * 1024 * 1024, // a landlord's data with receipt photos
    trustProxy: cfg.trustProxy,
  });

  // JSON bodies, keeping the raw text: Plaid signs its webhooks over the exact body.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try { done(null, body ? JSON.parse(body as string) : {}); } catch { const e = new Error('That is not valid JSON.') as Error & { statusCode: number }; e.statusCode = 400; done(e, undefined); }
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'wasm-unsafe-eval' lets the on-device receipt reader (WebAssembly) start; it does not allow eval of text.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'https://cdn.plaid.com'],
        frameSrc: ['https://cdn.plaid.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'https://production.plaid.com', 'https://sandbox.plaid.com'],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: cfg.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: cfg.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', errorResponseBuilder: () => ({ statusCode: 429, error: 'Too many tries. Wait a minute and try again.' }) });

  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  // Who is asking (from the session cookie), and a cross-site check on anything that changes data:
  // the request must come from this site and carry our header (a form on another site cannot add it).
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url !== '/api/plaid/webhook') {
      const origin = req.headers.origin;
      const sameSite = !origin || origin === cfg.appUrl || (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
      if (!sameSite || req.headers['x-keyholder'] !== '1') fail(403, 'This request did not come from the Keyholder app.');
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const u = await sessionUser(db, token, cfg.sessionDays);
      if (u) { req.user = u; req.sessionToken = token; }
    }
  });

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof Http) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Some details are missing or not right.', issues: err.issues.map((i) => i.path.join('.')) });
    const e = err as { statusCode?: number; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.statusCode === 413 ? 'That is too big to save.' : e.message });
    req.log.error(err);
    await recordError(db, `API ${req.method} ${req.routeOptions?.url ?? req.url}`, e.message).catch(() => {});
    return reply.code(500).send({ error: 'Something went wrong on our side. Please try again.' });
  });

  const ip = (req: FastifyRequest) => req.ip;
  const need = (req: FastifyRequest): User => req.user ?? fail(401, 'Please sign in again.');
  const needStaff = (req: FastifyRequest): User => {
    const u = need(req); if (!isTeam(u.role)) fail(403, 'Only the Keyholder team can open this.');
    if (!u.totp_enabled_at && keys.canSave) fail(403, TEAM_TWO_STEP);
    return u;
  };
  const needSuper = (req: FastifyRequest): User => { const u = need(req); if (u.role !== 'super') fail(403, 'Only the super user can do this.'); return u; };
  // ---------------- Two-step sign-in (authenticator app) ----------------
  // On with an authenticator app, fingerprint or face (passkeys), or both; backup codes always.
  const twoStepOn = (u: User) => !!u.totp_enabled_at;
  // ---- Fingerprint or face (passkeys, WebAuthn) ----
  const rp = (() => { const x = new URL(cfg.appUrl); return { id: x.hostname, origin: x.origin }; })();
  type PasskeyRow = { id: string; public_key: string; counter: string | number; transports: string[] | null; name: string; created_at: Date; last_used_at: Date | null };
  const passkeysOf = (userId: string) => db.query<PasskeyRow>('select * from passkeys where user_id = $1 order by created_at', [userId]);
  /** Checks a fingerprint/face answer against the person's devices and the challenge they were given. */
  const checkPasskey = async (u: User, response: AuthenticationResponseJSON, challenge: string | null | undefined): Promise<boolean> => {
    if (!challenge || !response?.id) return false;
    const row = (await passkeysOf(u.id)).find((x) => x.id === response.id); if (!row) return false;
    try {
      const v = await verifyAuthenticationResponse({ response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.id, requireUserVerification: true,
        credential: { id: row.id, publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')), counter: Number(row.counter), transports: (row.transports ?? undefined) as AuthenticatorTransport[] | undefined } });
      if (!v.verified) return false;
      await db.query('update passkeys set counter = $2, last_used_at = now() where id = $1', [row.id, v.authenticationInfo.newCounter]);
      return true;
    } catch { return false; }
  };
  /** A short name for a new device, from the browser: "iPhone", "Mac", "Windows"… */
  const deviceName = (ua = '') => {
    const what = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows computer' : /Linux/.test(ua) ? 'Linux computer' : 'This device';
    const app = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return app ? `${app} on ${what}` : what;
  };
  /** A second factor for a signed-in action (new backup codes, turning it off): a code, a backup code, or fingerprint/face. */
  const confirmSecond = async (u: User, b: { code?: string; passkey?: AuthenticationResponseJSON }) => {
    if (b.passkey) { const ok = await checkPasskey(u, b.passkey, u.webauthn_challenge); if (ok) await db.query('update users set webauthn_challenge = null where id = $1', [u.id]); return ok; }
    return !!b.code && !!(await secondFactor(u, b.code));
  };
  const SecondBody = z.object({ code: z.string().max(20).optional(), passkey: z.any().optional() });
  // ---- "Confirm it's you" before sensitive changes ----
  // Fresh = signed in, or confirmed again, in the last 10 minutes on this session.
  const FRESH_MINUTES = 10;
  const isFresh = async (req: FastifyRequest) => !!req.sessionToken && !!(await db.one<{ ok: boolean }>(
    `select true as ok from sessions where token_hash = $1 and greatest(created_at, coalesce(verified_at, created_at)) > now() - ($2 || ' minutes')::interval`,
    [sha256(req.sessionToken), String(FRESH_MINUTES)]));
  const needFresh = async (req: FastifyRequest) => { if (!(await isFresh(req))) fail(403, 'Please confirm it is you first.'); };
  const markVerified = (req: FastifyRequest) => db.query('update sessions set verified_at = now() where token_hash = $1', [sha256(req.sessionToken!)]);
  /** This browser was trusted for 30 days after a code (only for the same person). */
  // Each use keeps it for another 30 days (forgotten after 30 days unused, a new password, or Forget in Settings).
  const trustedDevice = async (req: FastifyRequest, u: User) => {
    const tokens = trustTokens(req);
    const hit = tokens.length ? await db.query(`update trusted_devices set last_used_at = now(), expires_at = now() + interval '30 days'
      where token_hash = any($1) and user_id = $2 and expires_at > now() returning 1 as ok`, [tokens.map(sha256), u.id]) : [];
    // In the logs (no token): whether this browser said it was remembered, and whether that was found.
    req.log.info({ rememberedDevice: { sent: tokens.length, found: hit.length > 0 } }, 'two-step: remembered device check');
    return hit.length > 0;
  };
  const rememberDevice = async (req: FastifyRequest, reply: FastifyReply, u: User) => {
    const token = newToken();
    await db.query(`insert into trusted_devices (token_hash, user_id, expires_at, id, name, last_used_at) values ($1, $2, now() + interval '30 days', $3, $4, now())`,
      [sha256(token), u.id, randomUUID(), deviceName(req.headers['user-agent']).slice(0, 60)]);
    reply.setCookie(TRUST_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, path: '/', maxAge: 30 * 86400 });
    reply.clearCookie(OLD_TRUST_COOKIE, { path: '/api/auth' });
  };
  const forgetDeviceCookie = (reply: FastifyReply) => { reply.clearCookie(TRUST_COOKIE, { path: '/' }); reply.clearCookie(OLD_TRUST_COOKIE, { path: '/api/auth' }); };
  /** The password (or Google) was right; the code comes next. A ticket for that, good for 10 minutes and 5 tries. */
  const twoStepTicket = async (u: User) => {
    const token = newToken();
    await db.query(`insert into two_step_tickets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '10 minutes')`, [sha256(token), u.id]);
    return token;
  };
  /** Checks an authenticator code or a backup code (used once). Returns how, or null. */
  const secondFactor = async (u: User, code: string): Promise<'app' | 'backup' | null> => {
    if (looksLikeBackup(code)) {
      const h = backupHash(code); const left = u.backup_codes ?? [];
      if (!left.includes(h)) return null;
      await db.query('update users set backup_codes = $2 where id = $1', [u.id, JSON.stringify(left.filter((x) => x !== h))]);
      return 'backup';
    }
    if (!u.totp_secret) return null;
    const step = checkCode(keys.decrypt(u.totp_secret), code, u.totp_last_step == null ? null : Number(u.totp_last_step));
    if (step === null) return null;
    await db.query('update users set totp_last_step = $2 where id = $1', [u.id, step]);
    return 'app';
  };
  const startSession = async (req: FastifyRequest, reply: FastifyReply, u: User) => {
    const token = await createSession(db, u.id, cfg.sessionDays, { ip: ip(req), ua: req.headers['user-agent'] });
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, path: '/', maxAge: cfg.sessionDays * 86400 });
  };
  // What the app needs to know. Google and email follow the keys in effect (Connections page, then Render).
  // banks: bank checks are on when Plaid is set up (Connections).
  // addressLookup: address suggestions (Google Places) when its key is set.
  // A fingerprint of the app being served (it changes with each deploy), so a tab left open can offer to reload.
  let build = 'dev';
  const publicConfig = async () => {
    await keys.refresh(db);
    return { google: !!keys.google(), emailDelivery: keys.email().provider !== 'log', banks: plaid.ready(), addressLookup: !!keys.places(), benchmarks: await benchmarksNow(db), version: VERSION, build, twoStep: keys.canSave };
  };
  // Counted per address and email, after the body is read, so one person's typos never lock out another.
  const authLimit = { rateLimit: { hook: 'preHandler' as const, max: 10, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => `${r.ip}:${normEmail(String((r.body as { email?: string })?.email ?? ''))}` } };

  /** The account behind the username "admin": the ADMIN_EMAIL account, else the oldest admin. */
  const teamAdmin = async () => (cfg.admin ? await userByEmail(db, cfg.admin.email) : undefined)
    ?? (await db.one<User>(`select * from users where role in ('super', 'admin') and disabled_at is null order by role = 'super' desc, created_at limit 1`));

  // ---------------- Public ----------------
  app.get('/api/health', async () => {
    await db.query('select 1');
    return { ok: true, version: VERSION, db: db.kind };
  });
  app.get('/api/session', async (req) => ({ user: req.user ? publicUser(req.user) : null, config: await publicConfig() }));
  // The Landlord plan price, for the website's Pricing page (set by the super user).
  app.get('/api/pricing', async (_req, reply) => { reply.header('Cache-Control', 'public, max-age=60'); return { unitCents: await unitPrice(db) }; });
  app.get('/api/announcements', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    const rows = await db.query<{ id: string; text: string; where_shown: string; tone: string; created_at: Date }>(`select id, text, where_shown, tone, created_at from announcements where active order by created_at desc limit 5`);
    return rows.map((a) => ({ id: a.id, text: a.text, where: a.where_shown, tone: a.tone, active: true, created: new Date(a.created_at).toISOString() }));
  });

  // ---------------- Accounts ----------------
  const Signup = z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(200), password: z.string().max(200), emailUpdates: z.boolean().optional() });
  app.post('/api/auth/signup', { config: authLimit }, async (req, reply) => {
    const b = Signup.parse(req.body);
    const bad = passwordProblem(b.password); if (bad) fail(400, bad);
    if (await userByEmail(db, b.email)) fail(409, 'There is already a Keyholder account for this email. Sign in instead.');
    const u = await db.tx(async (q) => {
      const u = await createUser(q, { email: b.email, name: b.name, password: b.password });
      const accountId = await accountFor(q, u.id);
      const token = await createLinkToken(q, u.id, 'verify', 24 * 7);
      await queueMail(q, { ...welcomeMail(u.email, u.name, `${cfg.appUrl}/#/verify?token=${token}`), accountId });
      await audit(q, { actor: u.email, actorId: u.id, accountId, scope: 'auth', action: 'Signed up', detail: 'Email and password', ip: ip(req) });
      return u;
    });
    await startSession(req, reply, u);
    return reply.code(201).send({ user: publicUser(u) });
  });

  const Login = z.object({ email: z.string().trim().max(200), password: z.string().max(200) });
  app.post('/api/auth/login', { config: authLimit }, async (req, reply) => {
    const b = Login.parse(req.body);
    // The username "admin" is the first team account (ADMIN_EMAIL), so the team can sign in with "admin".
    const u = b.email.trim().toLowerCase() === 'admin' ? await teamAdmin() : await userByEmail(db, b.email);
    const ok = u && !u.disabled_at ? await verifyPassword(b.password, u.password_hash) : (await burnPasswordCheck(b.password), false);
    if (!ok || !u) {
      if (u) await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Sign-in failed', detail: 'Wrong password', ip: ip(req) });
      fail(401, u && !u.password_hash && u.google_sub ? 'This account signs in with Google.' : 'That email or password is not right.');
    }
    if (twoStepOn(u!) && !(await trustedDevice(req, u!))) return { twoStep: true, ticket: await twoStepTicket(u!) };
    await startSession(req, reply, u!);
    await audit(db, { actor: u!.email, actorId: u!.id, scope: 'auth', action: 'Signed in', ip: ip(req) });
    return { user: publicUser(u!) };
  });

  // The second step: the code from the authenticator app, or a backup code. `trust`: skip the code here for 30 days.
  // Limited per sign-in (each ticket allows 5 wrong codes); a new ticket needs the password again.
  const ticketLimit = { rateLimit: { hook: 'preHandler' as const, max: 10, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => `${r.ip}:${String((r.body as { ticket?: string })?.ticket ?? '').slice(0, 16)}` } };
  app.post('/api/auth/two-step', { config: ticketLimit }, async (req, reply) => {
    const b = z.object({ ticket: z.string().min(10).max(100), code: z.string().max(20).optional(), passkey: z.any().optional(), trust: z.boolean().optional() }).parse(req.body);
    const t = await db.one<{ user_id: string; attempts: number; challenge: string | null }>(`select user_id, attempts, challenge from two_step_tickets where token_hash = $1 and used_at is null and expires_at > now()`, [sha256(b.ticket)]);
    const u = t && t.attempts < 5 ? await userById(db, t.user_id) : undefined;
    if (!u || u.disabled_at || !twoStepOn(u)) fail(400, 'This sign-in has expired. Please sign in again.');
    const how = b.passkey ? ((await checkPasskey(u!, b.passkey, t!.challenge)) ? 'passkey' : null) : b.code ? await secondFactor(u!, b.code) : null;
    if (!how) {
      await db.query('update two_step_tickets set attempts = attempts + 1 where token_hash = $1', [sha256(b.ticket)]);
      await audit(db, { actor: u!.email, actorId: u!.id, scope: 'auth', action: 'Sign-in failed', detail: 'Wrong two-step code', ip: ip(req) });
      fail(401, b.passkey ? 'Fingerprint or face did not work. Try again, or use a code.' : 'That code is not right. Use the newest code in your app, or a backup code.');
    }
    await db.query('update two_step_tickets set used_at = now() where token_hash = $1', [sha256(b.ticket)]);
    await startSession(req, reply, u!);
    if (b.trust) await rememberDevice(req, reply, u!);
    await audit(db, { actor: u!.email, actorId: u!.id, scope: 'auth', action: 'Signed in', detail: how === 'backup' ? 'Two-step: backup code' : how === 'passkey' ? 'Two-step: fingerprint or face' : 'Two-step: authenticator code', ip: ip(req) });
    return { user: publicUser((await userById(db, u!.id))!) };
  });

  // Turning it on: a new secret (shown as a QR code), then the first code from the app confirms it and gives backup codes.
  app.post('/api/auth/two-step/setup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const u = need(req);
    if (!keys.canSave) fail(400, 'Two-step sign-in needs KEYS_SECRET to be set in Render.');
    const secret = newSecret();
    await db.query('update users set totp_pending = $2 where id = $1', [u.id, keys.encrypt(secret)]);
    return { secret, uri: otpauthUri(secret, u.email) };
  });
  app.post('/api/auth/two-step/enable', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const u = need(req);
    const { code } = z.object({ code: z.string().max(20) }).parse(req.body);
    if (!u.totp_pending) fail(400, 'Start again: choose "Turn on two-step sign-in".');
    const secret = keys.decrypt(u.totp_pending!);
    const step = checkCode(secret, code);
    if (step === null) fail(400, 'That code is not right. Check the time on your phone and use the newest code.');
    if (twoStepOn(u)) {
      // Already on (fingerprint or face): the app is added; the backup codes stay as they are.
      await db.query(`update users set totp_secret = totp_pending, totp_pending = null, totp_last_step = $2 where id = $1`, [u.id, step]);
      await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Authenticator app added', ip: ip(req) });
      return { backupCodes: null, user: publicUser((await userById(db, u.id))!) };
    }
    const backup = newBackupCodes();
    await db.query(`update users set totp_secret = totp_pending, totp_pending = null, totp_enabled_at = now(), totp_last_step = $2, backup_codes = $3 where id = $1`, [u.id, step, JSON.stringify(backup.hashes)]);
    await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Two-step sign-in turned on', ip: ip(req) });
    return { backupCodes: backup.codes, user: publicUser((await userById(db, u.id))!) };
  });
  // New backup codes (the old ones stop working); needs a current code.
  app.post('/api/auth/two-step/backup-codes', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const u = need(req);
    const b = SecondBody.parse(req.body);
    if (!twoStepOn(u)) fail(400, 'Two-step sign-in is off.');
    if (!(await confirmSecond(u, b))) fail(400, 'That code is not right.');
    const backup = newBackupCodes();
    await db.query('update users set backup_codes = $2 where id = $1', [u.id, JSON.stringify(backup.hashes)]);
    await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'New backup codes', ip: ip(req) });
    return { backupCodes: backup.codes, user: publicUser((await userById(db, u.id))!) };
  });
  // "Remember this device?", asked right after the second step: this browser skips it next time.
  app.post('/api/auth/remember-device', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = need(req);
    if (!twoStepOn(u)) fail(400, 'Two-step sign-in is off.');
    // Only straight after signing in on this browser (the session is new).
    const sid = req.cookies[SESSION_COOKIE];
    const fresh = sid && await db.one('select 1 as ok from sessions where token_hash = $1 and created_at > now() - interval \'15 minutes\'', [sha256(sid)]);
    if (!fresh) fail(400, 'Sign in again to remember this device.');
    if (!(await trustedDevice(req, u))) await rememberDevice(req, reply, u);
    await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Device remembered', detail: deviceName(req.headers['user-agent']), ip: ip(req) });
    return { ok: true };
  });
  app.get('/api/auth/devices', async (req) => {
    const u = need(req);
    const mine = new Set(trustTokens(req).map(sha256));
    const rows = await db.query<{ id: string; name: string; created_at: Date; last_used_at: Date | null; token_hash: string }>(
      'select id, name, created_at, last_used_at, token_hash from trusted_devices where user_id = $1 and expires_at > now() order by coalesce(last_used_at, created_at) desc', [u.id]);
    return rows.map((r) => ({ id: r.id, name: r.name || 'Browser', added: new Date(r.created_at).toISOString().slice(0, 10), lastUsed: r.last_used_at ? new Date(r.last_used_at).toISOString().slice(0, 10) : null, thisDevice: mine.has(r.token_hash) }));
  });
  app.post('/api/auth/devices/forget', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = need(req);
    const { id, all } = z.object({ id: z.string().uuid().optional(), all: z.boolean().optional() }).parse(req.body);
    if (all) await db.query('delete from trusted_devices where user_id = $1', [u.id]);
    else await db.query('delete from trusted_devices where user_id = $1 and id = $2', [u.id, id ?? null]);
    if (all || !(await db.one('select 1 as ok from trusted_devices where user_id = $1 and token_hash = any($2)', [u.id, trustTokens(req).map(sha256)]))) forgetDeviceCookie(reply);
    await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: all ? 'All remembered devices forgotten' : 'Remembered device forgotten', ip: ip(req) });
    return { ok: true };
  });

  // Turning it off: a landlord's choice (needs a current code). The Keyholder team keeps it on.
  app.post('/api/auth/two-step/disable', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = need(req);
    const b = SecondBody.parse(req.body);
    if (isTeam(u.role)) fail(403, 'Two-step sign-in stays on for the Keyholder team.');
    if (!twoStepOn(u)) return { user: publicUser(u) };
    if (!(await confirmSecond(u, b))) fail(400, 'That code is not right.');
    await db.query(`update users set totp_secret = null, totp_pending = null, totp_enabled_at = null, totp_last_step = null, backup_codes = null where id = $1`, [u.id]);
    await db.query('delete from passkeys where user_id = $1', [u.id]);
    await db.query('delete from trusted_devices where user_id = $1', [u.id]);
    forgetDeviceCookie(reply);
    await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Two-step sign-in turned off', ip: ip(req) });
    return { user: publicUser((await userById(db, u.id))!) };
  });

  // Whether this session is fresh, and the ways to confirm (the landlord's usual way first).
  app.get('/api/auth/confirm', async (req) => {
    const u = need(req);
    return { fresh: await isFresh(req), ways: { password: !!u.password_hash, google: !!u.google_sub && !!keys.google(), passkey: Number(u.passkey_count ?? 0) > 0, app: !!u.totp_secret && !!u.totp_enabled_at } };
  });
  // Confirm with the password, a fingerprint or face on this device, or an app or backup code. (Google: the
  // sign-in redirect with intent=verify, below.)
  app.post('/api/auth/confirm', { config: authLimit }, async (req) => {
    const u = need(req);
    const b = z.object({ password: z.string().max(200).optional(), code: z.string().max(20).optional(), passkey: z.any().optional() }).parse(req.body);
    let ok = false, how = '';
    if (b.password) { ok = !!u.password_hash && (await verifyPassword(b.password, u.password_hash)); how = 'password'; }
    else if (b.passkey || b.code) { ok = twoStepOn(u) && (await confirmSecond(u, b)); how = b.passkey ? 'fingerprint or face' : 'code'; }
    if (!ok) { await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Confirm it is you failed', detail: how, ip: ip(req) }); fail(400, how === 'password' ? 'That password is not right.' : 'That did not work. Please try again.'); }
    await markVerified(req);
    await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Confirmed it is them', detail: how, ip: ip(req) });
    return { fresh: true };
  });

  // ---- Fingerprint or face (passkeys) ----
  // Adding this device: the browser asks for fingerprint or face, and the device's key is saved (the first one turns
  // two-step sign-in on, with backup codes).
  app.post('/api/auth/passkey/register-options', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const u = need(req);
    await needFresh(req);
    const existing = await passkeysOf(u.id);
    const options = await generateRegistrationOptions({
      rpName: 'Keyholder', rpID: rp.id, userName: u.email, userDisplayName: u.name || u.email, userID: new TextEncoder().encode(u.id),
      attestationType: 'none', excludeCredentials: existing.map((x) => ({ id: x.id, transports: x.transports ?? undefined })),
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    });
    await db.query('update users set webauthn_challenge = $2, webauthn_challenge_at = now() where id = $1', [u.id, options.challenge]);
    return options;
  });
  app.post('/api/auth/passkey/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const u = need(req);
    await needFresh(req);
    const b = z.object({ response: z.any(), name: z.string().max(60).optional() }).parse(req.body);
    const fresh = u.webauthn_challenge && u.webauthn_challenge_at && Date.now() - new Date(u.webauthn_challenge_at).getTime() < 5 * 60_000;
    if (!fresh) fail(400, 'That took too long. Please try again.');
    let info: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try { info = await verifyRegistrationResponse({ response: b.response, expectedChallenge: u.webauthn_challenge!, expectedOrigin: rp.origin, expectedRPID: rp.id, requireUserVerification: true }); }
    catch { fail(400, 'This device could not be added. Please try again.'); }
    if (!info!.verified) fail(400, 'This device could not be added. Please try again.');
    const c = info!.registrationInfo!.credential;
    const name = (b.name || deviceName(req.headers['user-agent'])).slice(0, 60);
    await db.query('insert into passkeys (id, user_id, public_key, counter, transports, name) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing',
      [c.id, u.id, Buffer.from(c.publicKey).toString('base64url'), c.counter, JSON.stringify(c.transports ?? []), name]);
    await db.query('update users set webauthn_challenge = null where id = $1', [u.id]);
    let backupCodes: string[] | null = null;
    if (!twoStepOn(u)) {
      const backup = newBackupCodes(); backupCodes = backup.codes;
      await db.query('update users set totp_enabled_at = now(), backup_codes = $2 where id = $1', [u.id, JSON.stringify(backup.hashes)]);
      await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Two-step sign-in turned on', detail: 'Fingerprint or face', ip: ip(req) });
    }
    await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Fingerprint or face added', detail: name, ip: ip(req) });
    return { backupCodes, user: publicUser((await userById(db, u.id))!) };
  });
  app.get('/api/auth/passkeys', async (req) => {
    const u = need(req);
    return (await passkeysOf(u.id)).map((x) => ({ id: x.id, name: x.name, added: new Date(x.created_at).toISOString().slice(0, 10), lastUsed: x.last_used_at ? new Date(x.last_used_at).toISOString().slice(0, 10) : null }));
  });
  app.post('/api/auth/passkey/remove', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const u = need(req);
    await needFresh(req);
    const { id } = z.object({ id: z.string().max(300) }).parse(req.body);
    const mine = await passkeysOf(u.id);
    if (!mine.some((x) => x.id === id)) fail(404, 'That device is not on your account.');
    if (mine.length === 1 && !u.totp_secret) fail(400, isTeam(u.role) ? 'This is your only way to do two-step sign-in. Add an authenticator app first.' : 'This is your only way to do two-step sign-in. Add an authenticator app first, or turn two-step sign-in off.');
    await db.query('delete from passkeys where id = $1 and user_id = $2', [id, u.id]);
    await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Fingerprint or face removed', detail: mine.find((x) => x.id === id)?.name, ip: ip(req) });
    return { user: publicUser((await userById(db, u.id))!) };
  });
  // Using it: at sign-in (with the ticket), or for a signed-in action (no ticket). Says whether an app code works too.
  app.post('/api/auth/passkey/options', { config: ticketLimit }, async (req) => {
    const { ticket } = z.object({ ticket: z.string().min(10).max(100).optional() }).parse(req.body ?? {});
    let u: User | undefined;
    if (ticket) {
      const t = await db.one<{ user_id: string; attempts: number }>(`select user_id, attempts from two_step_tickets where token_hash = $1 and used_at is null and expires_at > now()`, [sha256(ticket)]);
      u = t && t.attempts < 5 ? await userById(db, t.user_id) : undefined;
      if (!u) fail(400, 'This sign-in has expired. Please sign in again.');
    } else u = need(req);
    const mine = await passkeysOf(u!.id);
    if (!mine.length) return { options: null, app: !!u!.totp_secret };
    const options = await generateAuthenticationOptions({ rpID: rp.id, allowCredentials: mine.map((x) => ({ id: x.id, transports: x.transports ?? undefined })), userVerification: 'required' });
    if (ticket) await db.query('update two_step_tickets set challenge = $2 where token_hash = $1', [sha256(ticket), options.challenge]);
    else await db.query('update users set webauthn_challenge = $2, webauthn_challenge_at = now() where id = $1', [u!.id, options.challenge]);
    return { options, app: !!u!.totp_secret };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionToken) await endSession(db, req.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/forgot', { config: authLimit }, async (req) => {
    const { email } = z.object({ email: z.string().trim().email().max(200) }).parse(req.body);
    const u = await userByEmail(db, email);
    if (u && !u.disabled_at) await db.tx(async (q) => {
      const token = await createLinkToken(q, u.id, 'reset', 1);
      await queueMail(q, resetMail(u.email, u.name, `${cfg.appUrl}/#/reset?token=${token}`));
      await audit(q, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Password reset asked', ip: ip(req) });
    });
    return { ok: true }; // the same answer either way: it does not reveal who has an account
  });

  app.post('/api/auth/reset', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ token: z.string().min(10).max(100), password: z.string().max(200) }).parse(req.body);
    const bad = passwordProblem(b.password); if (bad) fail(400, bad);
    const hash = await hashPassword(b.password);
    const u = await db.tx(async (q) => {
      const t = await useLinkToken(q, b.token, ['reset', 'invite']);
      if (!t) fail(400, 'This link has expired or was already used. Ask for a new one.');
      await q.query('update users set password_hash = $2, email_verified_at = coalesce(email_verified_at, now()) where id = $1', [t!.userId, hash]);
      await endAllSessions(q, t!.userId);
      await q.query('delete from trusted_devices where user_id = $1', [t!.userId]);
      const u = (await userById(q, t!.userId))!;
      await audit(q, { actor: u.email, actorId: u.id, scope: 'auth', action: t!.purpose === 'invite' ? 'Team invitation accepted' : 'Password reset', ip: ip(req) });
      return u;
    });
    if (twoStepOn(u)) return { twoStep: true, ticket: await twoStepTicket(u) };
    await startSession(req, reply, u);
    return { user: publicUser(u) };
  });

  app.post('/api/auth/verify', async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.body);
    const t = await useLinkToken(db, token, ['verify']);
    if (!t) fail(400, 'This link has expired or was already used.');
    await db.query('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [t!.userId]);
    return { ok: true };
  });

  app.post('/api/auth/resend-verify', { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (req) => {
    const u = need(req);
    if (u.email_verified_at) return { ok: true };
    const token = await createLinkToken(db, u.id, 'verify', 24 * 7);
    await queueMail(db, welcomeMail(u.email, u.name, `${cfg.appUrl}/#/verify?token=${token}`));
    return { ok: true };
  });

  app.post('/api/auth/password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const u = need(req);
    const b = z.object({ current: z.string().max(200).optional(), next: z.string().max(200) }).parse(req.body);
    if (u.password_hash && !(await verifyPassword(b.current ?? '', u.password_hash))) fail(400, 'Your current password is not right.');
    const bad = passwordProblem(b.next); if (bad) fail(400, bad);
    await db.query('update users set password_hash = $2 where id = $1', [u.id, await hashPassword(b.next)]);
    await endAllSessions(db, u.id, req.sessionToken ?? undefined);
    await db.query('delete from trusted_devices where user_id = $1', [u.id]);
    await audit(db, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Password changed', ip: ip(req) });
    return { ok: true };
  });

  // ---------------- Google sign-in (when GOOGLE_CLIENT_ID / SECRET are set) ----------------
  const redirectUri = `${cfg.appUrl}/api/auth/google/callback`;
  const googleKeys = async () => { await keys.refresh(db); return keys.google() ?? fail(404, 'Google sign-in is not set up.'); };
  app.get('/api/auth/google/start', async (req, reply) => {
    const g = await googleKeys();
    const state = newToken();
    const asked = (req.query as { intent?: string }).intent;
    // verify: a signed-in landlord confirms it is them with Google again (before a sensitive change).
    const intent = asked === 'signup' ? 'signup' : asked === 'verify' && req.user ? 'verify' : 'signin';
    reply.setCookie('kh_oauth', `${state}.${intent}`, { httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, path: '/api/auth/google', maxAge: 600 });
    const q = new URLSearchParams({ client_id: g.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  });
  app.get('/api/auth/google/callback', async (req, reply) => {
    const g = await googleKeys();
    const { code, state } = req.query as { code?: string; state?: string };
    const [want, intent] = String(req.cookies.kh_oauth ?? '').split('.');
    reply.clearCookie('kh_oauth', { path: '/api/auth/google' });
    if (!code || !state || state !== want) return reply.redirect(`${cfg.appUrl}/#/signin?error=google`);
    const tok = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    if (!tok.ok) { await recordError(db, 'Google sign-in', `token ${tok.status}`); return reply.redirect(`${cfg.appUrl}/#/signin?error=google`); }
    const { access_token } = (await tok.json()) as { access_token: string };
    const info = (await (await fetcher('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access_token}` } })).json()) as { sub: string; email: string; email_verified: boolean; name?: string };
    if (!info.sub || !info.email || !info.email_verified) return reply.redirect(`${cfg.appUrl}/#/signin?error=google`);
    if (intent === 'verify') {
      // Only the same Google account as the one signed in counts; nothing else changes.
      const me = req.user;
      const same = !!me && !!req.sessionToken && (me.google_sub === info.sub || (!me.google_sub && normEmail(me.email) === normEmail(info.email)));
      if (same) { await markVerified(req); await audit(db, { actor: me!.email, actorId: me!.id, scope: 'auth', action: 'Confirmed it is them', detail: 'Google', ip: ip(req) }); }
      return reply.redirect(`${cfg.appUrl}/#/settings?verified=${same ? 'google' : 'wrong-google'}`);
    }
    let isNew = false;
    const u = await db.tx(async (q) => {
      let u = (await q.one<User>('select * from users where google_sub = $1', [info.sub])) ?? (await userByEmail(q, info.email));
      if (u && !u.google_sub) await q.query('update users set google_sub = $2, email_verified_at = coalesce(email_verified_at, now()) where id = $1', [u.id, info.sub]);
      if (!u) {
        isNew = true;
        u = await createUser(q, { email: info.email, name: info.name ?? info.email.split('@')[0], googleSub: info.sub, verified: true });
        await accountFor(q, u.id);
        await audit(q, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Signed up', detail: 'Google', ip: ip(req) });
      } else await audit(q, { actor: u.email, actorId: u.id, scope: 'auth', action: 'Signed in', detail: 'Google', ip: ip(req) });
      return u;
    });
    if (u.disabled_at) return reply.redirect(`${cfg.appUrl}/#/signin?error=google`);
    if (twoStepOn(u) && !(await trustedDevice(req, u))) return reply.redirect(`${cfg.appUrl}/#/signin?twostep=${await twoStepTicket(u)}&intent=${intent === 'signup' ? 'signup' : 'signin'}`);
    await startSession(req, reply, u);
    return reply.redirect(`${cfg.appUrl}/#/auth/google?intent=${intent === 'signup' || isNew ? 'signup' : 'signin'}`);
  });

  // ---------------- A landlord's data ----------------
  // Clear all data (Settings): only after confirming it is them. Keeps the profile; a new epoch, so a copy
  // still open on another device cannot save the old data back.
  app.post('/api/state/clear', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const { u, accountId } = await ownerAccount(req);
    await needFresh(req);
    const s = await readState(db, accountId);
    const d = emptyState((s.data as AppState | null)?.profile);
    d.epoch = randomUUID();
    const r = await writeState(db, accountId, s.revision, d, u.email, { reset: true });
    await audit(db, { actor: u.email, actorId: u.id, accountId, scope: 'app', action: 'All data cleared', ip: ip(req) });
    return { revision: r.revision, data: d };
  });

  const ownerAccount = async (req: FastifyRequest) => { const u = need(req); if (u.role !== 'owner') fail(403, 'Team accounts have no rental data.'); return { u, accountId: await accountFor(db, u.id) }; };
  app.get('/api/state', async (req) => { const { accountId } = await ownerAccount(req); const s = await readState(db, accountId); return { revision: s.revision, data: s.data }; });
  app.get('/api/state/meta', async (req) => { const { accountId } = await ownerAccount(req); const s = await readState(db, accountId); return { revision: s.revision, updatedAt: s.updatedAt ?? null }; });
  app.put('/api/state', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const { u, accountId } = await ownerAccount(req);
    const b = z.object({ baseRevision: z.number().int().min(0), data: z.unknown() }).parse(req.body);
    const bad = stateProblem(b.data); if (bad) fail(422, bad);
    const r = await writeState(db, accountId, b.baseRevision, b.data as AppState, u.email);
    return { revision: r.revision, merged: r.merged, data: r.merged ? r.data : undefined, stale: r.stale || undefined };
  });

  app.get('/api/account/export', async (req, reply) => {
    const { u, accountId } = await ownerAccount(req);
    const s = await readState(db, accountId);
    const tickets = await db.query('select subject, status, messages, created_at from support_tickets where account_id = $1', [accountId]);
    const log = await db.query('select at, action, detail from audit_log where account_id = $1 or actor_id = $2 order by at desc limit 1000', [accountId, u.id]);
    await db.query(`insert into data_requests (id, account_id, email, kind, status, done_at) values ($1, $2, $3, 'copy', 'done', now())`, [randomUUID(), accountId, u.email]);
    await audit(db, { actor: u.email, actorId: u.id, accountId, scope: 'app', action: 'Data downloaded', ip: ip(req) });
    reply.header('Content-Disposition', `attachment; filename="keyholder-${new Date().toISOString().slice(0, 10)}.json"`);
    return { exported: new Date().toISOString(), account: publicUser(u), data: s.data, revision: s.revision, supportRequests: tickets, activity: log };
  });

  app.delete('/api/account', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { u, accountId } = await ownerAccount(req);
    const b = z.object({ password: z.string().max(200).optional(), email: z.string().max(200).optional() }).parse(req.body ?? {});
    const ok = u.password_hash ? await verifyPassword(b.password ?? '', u.password_hash) : normEmail(b.email ?? '') === normEmail(u.email);
    if (!ok) fail(400, u.password_hash ? 'Your password is not right.' : 'Type your email to confirm.');
    await removeBanksAtPlaid(accountId);
    await db.tx((q) => deleteAccount(q, accountId, 'the landlord'));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------------- Bank data (Plaid) ----------------
  const needPlaid = async () => {
    await keys.refresh(db);
    if (!plaid.ready()) fail(400, 'Bank connections are not set up yet.');
  };
  const plaidFail = (e: unknown): never => {
    if (e instanceof PlaidError) fail(e.status >= 500 ? 502 : 400, e.message || 'The bank service did not answer. Try again in a minute.');
    throw e;
  };
  const webhookUrl = `${cfg.appUrl}/api/plaid/webhook`;
  async function removeBanksAtPlaid(accountId: string) {
    await keys.refresh(db);
    for (const it of await itemsFor(db, accountId)) {
      try { if (plaid.ready()) await plaid.remove(keys.decrypt(it.access_token)); } catch { /* removed or unreachable: the row goes anyway */ }
      await db.query('delete from bank_items where id = $1', [it.id]);
    }
  }
  // Opens Plaid's bank sign-in. With itemId: sign in again to a bank that asks for it.
  app.post('/api/bank/link-token', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { accountId } = await ownerAccount(req);
    await needPlaid();
    const { itemId } = z.object({ itemId: z.string().uuid().optional() }).parse(req.body ?? {});
    let token: string | undefined;
    if (itemId) { const it = (await itemsFor(db, accountId)).find((x) => x.id === itemId); if (!it) fail(404, 'No such bank.'); token = keys.decrypt(it!.access_token); }
    // Banks that sign in on their own site (OAuth: RBC, TD, Scotiabank…) come back to /plaid-oauth. If that address
    // is not registered in the Plaid Dashboard yet, Link still opens without it (fine on computers).
    try { return { linkToken: await plaid.linkToken(accountId, webhookUrl, token, `${cfg.appUrl}/plaid-oauth`) }; }
    catch (e) {
      if (e instanceof PlaidError && /redirect/i.test(e.message)) {
        await recordError(db, 'Bank connections', 'Add https://…/plaid-oauth to Allowed redirect URIs in the Plaid Dashboard (API page): banks like RBC need it on phones.');
        try { return { linkToken: await plaid.linkToken(accountId, webhookUrl, token) }; } catch (e2) { return plaidFail(e2); }
      }
      return plaidFail(e);
    }
  });
  // Plaid's window closed with a problem: its exact code is kept for support (Platform → System health).
  app.post('/api/bank/link-error', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { u, accountId } = await ownerAccount(req);
    const s = (n: number) => z.string().max(n).nullish();
    const b = z.object({ error_code: s(80), error_type: s(80), error_message: s(300), display_message: s(300), request_id: s(80), link_session_id: s(120), institution: s(120), status: s(80) }).parse(req.body ?? {});
    const line = `${b.institution || 'A bank'}: ${b.error_code || b.status || 'closed'}${b.error_type ? ` (${b.error_type})` : ''}${b.error_message ? ` · ${b.error_message}` : ''}${b.request_id ? ` · request ${b.request_id}` : ''}${b.link_session_id ? ` · session ${b.link_session_id}` : ''}`;
    if (b.error_code) await recordError(db, 'Bank connections', line);
    await audit(db, { actor: u.email, actorId: u.id, accountId, scope: 'app', action: 'Bank connection did not finish', detail: line.slice(0, 300), ip: ip(req) });
    return { ok: true };
  });
  // After the landlord signed in at their bank (in Plaid's window): keep the connection and read the first transactions.
  app.post('/api/bank/exchange', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { u, accountId } = await ownerAccount(req);
    await needPlaid();
    const b = z.object({ publicToken: z.string().min(10).max(300), institution: z.object({ name: z.string().max(120).optional(), institution_id: z.string().max(80).optional() }).nullish() }).parse(req.body);
    let ex: { access_token: string; item_id: string };
    try { ex = await plaid.exchange(b.publicToken); } catch (e) { return plaidFail(e); }
    const name = (b.institution?.name || 'Bank').slice(0, 120);
    let accounts: { id: string; name: string; mask: string | null }[] = [];
    try { accounts = (await plaid.accounts(ex.access_token)).accounts.map((a) => ({ id: a.account_id, name: a.name, mask: a.mask })); } catch { /* shown without account numbers */ }
    const id = randomUUID();
    await db.query(`insert into bank_items (id, account_id, item_id, access_token, institution, accounts) values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (item_id) do update set access_token = excluded.access_token, status = 'connected'`, [id, accountId, ex.item_id, keys.encrypt(ex.access_token), name, JSON.stringify(accounts)]);
    await audit(db, { actor: u.email, actorId: u.id, accountId, scope: 'app', action: 'Bank connected', detail: name, ip: ip(req) });
    const it = (await itemByPlaidId(db, ex.item_id))!;
    let added = 0;
    try { added = await syncItem(db, plaid, keys, it); } catch { /* the first transactions arrive with Plaid's webhook */ }
    return { ok: true, bank: name, added };
  });
  // "Check now": reads what Plaid already has (no request to the bank, no extra charge).
  app.post('/api/bank/sync', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req) => {
    const { accountId } = await ownerAccount(req);
    await needPlaid();
    let added = 0;
    for (const it of await itemsFor(db, accountId)) {
      try { added += await syncItem(db, plaid, keys, it); }
      catch (e) { if (e instanceof PlaidError && e.code === 'ITEM_LOGIN_REQUIRED') await db.query(`update bank_items set status = 'needs-reauth', error = $2 where id = $1`, [it.id, e.code]); else if (!(e instanceof PlaidError)) throw e; }
    }
    return { added };
  });
  // Disconnect a bank: removed at Plaid (it stops billing), then from Keyholder.
  app.delete('/api/bank/:id', async (req) => {
    const { u, accountId } = await ownerAccount(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await keys.refresh(db);
    const it = (await itemsFor(db, accountId)).find((x) => x.id === id);
    if (it) {
      try { if (plaid.ready()) await plaid.remove(keys.decrypt(it.access_token)); } catch { /* already gone at Plaid */ }
      await db.query('delete from bank_items where id = $1', [it.id]);
      await audit(db, { actor: u.email, actorId: u.id, accountId, scope: 'app', action: 'Bank disconnected', detail: it.institution, ip: ip(req) });
    }
    await dropBankFromState(db, accountId, id);
    return { ok: true };
  });
  // Plaid tells Keyholder as soon as it has new transactions: read them right away (real time, from Plaid's copy).
  app.post('/api/plaid/webhook', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    await keys.refresh(db);
    if (!plaid.ready()) return reply.code(200).send({ ok: true });
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
    if (!(await plaid.verifyWebhook(req.headers['plaid-verification'] as string | undefined, raw))) return reply.code(401).send({ error: 'Not from Plaid.' });
    const b = req.body as { webhook_type?: string; webhook_code?: string; item_id?: string; error?: { error_code?: string } | null };
    const it = b.item_id ? await itemByPlaidId(db, b.item_id) : undefined;
    if (!it) return { ok: true };
    if (b.webhook_type === 'TRANSACTIONS' && b.webhook_code === 'SYNC_UPDATES_AVAILABLE') {
      try { await syncItem(db, plaid, keys, it); } catch (e) { await recordError(db, 'Bank data', `sync ${(e as Error).message}`); }
    } else if (b.webhook_type === 'ITEM' && (b.webhook_code === 'ERROR' || b.webhook_code === 'PENDING_EXPIRATION' || b.webhook_code === 'PENDING_DISCONNECT')) {
      await db.query(`update bank_items set status = 'needs-reauth', error = $2 where id = $1`, [it.id, b.error?.error_code ?? b.webhook_code]);
      await applyBankUpdate(db, it.account_id, { ...it, status: 'needs-reauth' }, [], []);
    }
    return { ok: true };
  });

  // ---------------- Ontario's official LTB forms ----------------
  // The official form filled in with the values the app worked out (to look at before approving, or to download a
  // served one again). Only the landlord's own document; nothing is stored.
  const formValues = z.record(z.string().max(200), z.union([z.string().max(3000), z.literal(true), z.object({ radio: z.string().max(10) })]))
    .refine((v) => Object.keys(v).length <= 250, 'Too many fields.');
  app.post('/api/forms/:formId/pdf', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    await ownerAccount(req);
    const { formId } = z.object({ formId: z.string().max(40) }).parse(req.params);
    if (!hasOfficialForm(formId)) fail(404, 'There is no official form for this notice.');
    const b = z.object({ values: formValues, filename: z.string().max(120).optional() }).parse(req.body);
    try {
      const pdf = await fillOfficial(formId, b.values);
      reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${(b.filename ?? `${formId}.pdf`).replace(/[^\w .-]/g, '')}"`).header('Cache-Control', 'no-store');
      return reply.send(Buffer.from(pdf));
    } catch (e) {
      if (e instanceof OfficialFormError) fail(422, e.message);
      throw e;
    }
  });
  // A served notice, emailed to everyone on the lease who agreed to notices by email, with the official form attached.
  app.post('/api/notices/:id/email', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { u, accountId } = await ownerAccount(req);
    const { id } = z.object({ id: z.string().max(80) }).parse(req.params);
    const s = await readState(db, accountId);
    const n = s.data?.notices?.find((x) => x.id === id);
    if (!n || !n.official || !hasOfficialForm(n.formId)) fail(404, 'That notice is not saved yet, or has no official form.');
    const t = s.data!.tenants.find((x) => x.id === n!.tenantId);
    if (!t?.emailConsent) fail(400, 'The tenant has not agreed to notices by email. Deliver it by hand or by mail.');
    const people = (t!.people?.length ? t!.people : [{ name: t!.names[0] ?? '', email: t!.email, phone: t!.phone }]).filter((p) => p.email);
    if (!people.length) fail(400, 'Add the tenant\'s email address first.');
    const f = formById(n!.formId)!;
    const landlord = s.data!.profile.name || u.name;
    const filename = formFilename(f.code, t!.names.join(' & '), n!.servedOn ?? new Date().toISOString().slice(0, 10));
    let queued = 0;
    for (const p of people) {
      const id2 = await queueMail(db, {
        to: p.email, toName: p.name, replyTo: u.email, kind: 'notice', accountId, dedupeKey: `notice:${n!.id}:${p.email.toLowerCase()}`,
        subject: `${f.code}: ${f.title}`,
        text: [`Hello ${p.name || t!.names.join(' & ')},`, '',
          `${landlord} has given you a notice: ${f.code}, ${f.title}. It is attached as the Landlord and Tenant Board's form (${OFFICIAL[n!.formId].version}).`,
          n!.terminationDate ? `The date in the notice: ${n!.terminationDate}.` : '', '',
          'Please read it carefully. For information about your rights, contact the Landlord and Tenant Board: tribunalsontario.ca/ltb, 1-888-332-3234.', '',
          `Reply to this email to reach ${landlord}.`].filter((x, k, a) => x !== '' || a[k - 1] !== '').join('\n'),
        attachment: { formId: n!.formId, values: n!.official!.values, filename },
      });
      if (id2) queued++;
    }
    await audit(db, { actor: u.email, actorId: u.id, accountId, scope: 'app', action: 'Notice emailed', detail: `${f.code} to ${people.length} tenant${people.length > 1 ? 's' : ''}`, ip: ip(req) });
    return { queued, to: people.map((p) => p.email) };
  });

  // ---------------- Help: a landlord writes to support ----------------
  app.post('/api/support/tickets', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const u = need(req);
    const b = z.object({ subject: z.string().trim().min(2).max(140), message: z.string().trim().min(2).max(5000), category: z.enum(['question', 'bank', 'billing', 'receipts', 'notices', 'account', 'bug']).default('question') }).parse(req.body);
    const id = `T-${Math.floor(100000 + Math.random() * 900000)}`;
    const accountId = u.role === 'owner' ? await accountFor(db, u.id) : null;
    await db.tx(async (q) => {
      await q.query(`insert into support_tickets (id, account_id, user_id, email, name, subject, category, priority, messages) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [id, accountId, u.id, u.email, u.name, b.subject, b.category, b.category === 'bank' ? 'high' : 'normal',
          JSON.stringify([{ from: 'customer', who: u.name || u.email, at: new Date().toISOString(), text: b.message }])]);
      await queueMail(q, { ...ticketAckMail(u.email, u.name, b.subject), accountId });
      const staff = await q.query<{ email: string }>(`select email from users where role in ('super', 'admin') and disabled_at is null limit 5`);
      for (const s of staff) await queueMail(q, newTicketAdminMail(s.email, `${u.name} <${u.email}>`, b.subject, b.message, `${cfg.appUrl}/#/support/inbox`));
      await audit(q, { actor: u.email, actorId: u.id, accountId, scope: 'app', action: 'Support request sent', detail: b.subject, ip: ip(req) });
    });
    return reply.code(201).send({ ok: true });
  });
  app.get('/api/support/tickets', async (req) => {
    const u = need(req);
    const rows = await db.query<{ id: string; subject: string; status: string; created_at: Date; messages: unknown[] }>('select id, subject, status, created_at, messages from support_tickets where user_id = $1 order by created_at desc limit 20', [u.id]);
    return rows.map((r) => ({ id: r.id, subject: r.subject, status: r.status, created: new Date(r.created_at).toISOString(), replies: r.messages.filter((m) => (m as { from: string }).from === 'agent').length }));
  });

  // ---------------- Support dashboard (team only) ----------------
  app.get('/api/admin/support', async (req) => snapshot(db, needStaff(req)));
  app.put('/api/admin/support', async (req) => {
    const me = needStaff(req);
    const b = z.object({ next: z.any(), log: z.object({ action: z.string().max(100), detail: z.string().max(500) }).optional() }).parse(req.body);
    if (!b.next || typeof b.next !== 'object') fail(400, 'Nothing to save.');
    if (me.role === 'support' && b.log && /Role changed|Team member|Account deleted|Reply-time|Province rules|Saved reply/.test(b.log.action)) fail(403, 'Only an admin can do that.');
    if (me.role !== 'super' && b.log && /Role changed|Team member|Price|Promotion|Bank/.test(b.log.action)) fail(403, 'Only the super user can do that.');
    const done = await applyChange(db, cfg, me, b.next, b.log, ip(req));
    return { done, snapshot: await snapshot(db, me) };
  });
  app.get('/api/admin/customers/:id/state', async (req) => {
    const me = needStaff(req);
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) fail(404, 'No such account.');
    const data = await customerState(db, id);
    await audit(db, { actor: me.email, actorId: me.id, accountId: id, scope: 'admin', action: 'Viewed landlord account', detail: id.slice(0, 8), ip: ip(req) });
    return { data };
  });
  app.get('/api/admin/email', async (req) => {
    needStaff(req);
    return db.query(`select id, kind, to_email, subject, status, last_error, created_at, sent_at from outbox order by created_at desc limit 200`);
  });

  // ---------------- Address lookup (Google Places, Canada) ----------------
  // The app asks the server, which asks Google with the key kept here (never in the browser). Signed-in
  // people only, and a limit per person, so the key cannot be used up by others.
  const placesKey = async () => { await keys.refresh(db); return keys.places() ?? fail(404, 'Address lookup is not set up.'); };
  const lookupLimit = { rateLimit: { hook: 'preHandler' as const, max: 60, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => r.user?.id ?? r.ip } };
  const Session = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
  app.get('/api/address/suggest', { config: lookupLimit }, async (req) => {
    need(req);
    const { q, session } = z.object({ q: z.string().trim().min(3).max(200), session: Session }).parse(req.query);
    const key = await placesKey();
    const r = await fetcher('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify({ input: q, includedRegionCodes: ['ca'], languageCode: 'en', sessionToken: session }),
    });
    if (!r.ok) { await recordError(db, 'Address lookup', `suggestions ${r.status}`); fail(502, 'Address suggestions are not working right now. Type the address instead.'); }
    type Pred = { placeId: string; text?: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } };
    const b = (await r.json()) as { suggestions?: { placePrediction?: Pred }[] };
    const suggestions = (b.suggestions ?? []).flatMap((x) => (x.placePrediction ? [x.placePrediction] : [])).slice(0, 5)
      .map((x) => ({ id: x.placeId, main: x.structuredFormat?.mainText?.text ?? x.text?.text ?? '', secondary: x.structuredFormat?.secondaryText?.text ?? '' }));
    return { suggestions };
  });
  app.get('/api/address/details', { config: lookupLimit }, async (req) => {
    need(req);
    const { id, session } = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/), session: Session }).parse(req.query);
    const key = await placesKey();
    const r = await fetcher(`https://places.googleapis.com/v1/places/${id}${session ? `?sessionToken=${session}` : ''}`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'addressComponents,location' },
    });
    if (!r.ok) { await recordError(db, 'Address lookup', `details ${r.status}`); fail(502, 'That address could not be filled in. Type it instead.'); }
    const b = (await r.json()) as { addressComponents?: { longText: string; shortText: string; types: string[] }[]; location?: { latitude: number; longitude: number } };
    const part = (type: string, short = false) => { const c = (b.addressComponents ?? []).find((x) => x.types.includes(type)); return c ? (short ? c.shortText : c.longText) : ''; };
    const street = [part('street_number'), part('route')].filter(Boolean).join(' ');
    const unit = part('subpremise');
    return {
      street: unit && street ? `${unit}-${street}` : street,
      city: part('locality') || part('sublocality') || part('postal_town') || part('administrative_area_level_3'),
      province: part('administrative_area_level_1', true), postalCode: part('postal_code'), country: part('country', true),
      lat: b.location?.latitude ?? null, lng: b.location?.longitude ?? null,
    };
  });

  // ---------------- Public application form (/apply/<slug>): no account needed ----------------
  // The listing a landlord saved under "Find a tenant". Only what a rental ad shows: the address, unit, rent, date.
  const listingBySlug = async (slug: string) => {
    const row = await db.one<{ account_id: string }>(`select account_id from account_state where data->'listings' @> $1::jsonb limit 1`, [JSON.stringify([{ slug }])]);
    if (!row) return null;
    const s = await readState(db, row.account_id);
    const d = s.data; if (!d) return null;
    const l = d.listings.find((x) => x.slug === slug); const unit = l && d.units.find((u) => u.id === l.unitId);
    const prop = unit && d.properties.find((p) => p.id === unit.propertyId);
    if (!l || !unit || !prop || prop.archived) return null;
    return { accountId: row.account_id, state: s, listing: l, unit, prop, landlord: (d.profile.name || '').split(' ')[0] || 'The landlord', ownerEmail: d.profile.email };
  };
  const Slug = z.object({ slug: z.string().regex(/^[a-z0-9-]{3,80}$/) });
  app.get('/api/apply/:slug', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { slug } = Slug.parse(req.params);
    const f = await listingBySlug(slug); if (!f) fail(404, 'This listing is closed or the link is not right. Ask the landlord for a new link.');
    const { listing, unit, prop, landlord } = f!;
    return { unit: unit.label, rooms: unit.rentedBy === 'room', address: prop.address, city: prop.city, province: prop.province, rent: listing.askingRent, available: listing.available, notes: listing.notes ?? '', landlord, bedrooms: unit.bedrooms ?? null };
  });
  const money = z.number().int().min(0).max(100_000_00);
  const short = (n: number) => z.string().trim().max(n);
  const Application = z.object({
    people: z.array(z.object({ name: short(120).min(2), email: z.string().trim().email().max(200).or(z.literal('')), phone: short(40), employer: short(120), jobTitle: short(80).optional(), monthlyIncome: money })).min(1).max(6),
    occupants: z.number().int().min(1).max(20), moveIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currentAddress: short(200).min(3), yearsAtAddress: z.number().min(0).max(80), currentRent: money.optional(), landlordName: short(120).optional(), landlordPhone: short(40).optional(), reasonLeaving: short(300).optional(),
    employedYears: z.number().min(0).max(60).optional(), employerContact: short(160).optional(), otherIncome: money.optional(), otherIncomeSource: short(120).optional(),
    leaseTerm: short(60).optional(), vehicles: z.number().int().min(0).max(10).optional(), pets: z.boolean(), petsWhat: short(120).optional(), smoking: z.boolean().optional(),
    emergencyContact: short(200).optional(), references: short(500).optional(), notes: short(1000).optional(),
    consentReferences: z.literal(true), creditConsent: z.boolean().optional(), website: z.string().max(0).optional(),
  });
  app.post('/api/apply/:slug', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { slug } = Slug.parse(req.params);
    const b = Application.parse(req.body);
    if (!b.people[0].email) fail(400, 'Add an email so the landlord can reach you.');
    const f = await listingBySlug(slug); if (!f) fail(404, 'This listing is closed or the link is not right. Ask the landlord for a new link.');
    const d = structuredClone(f!.state.data!) as AppState;
    const id = randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const people = b.people.map((p) => ({ name: p.name, email: p.email, phone: p.phone, employer: p.employer, jobTitle: p.jobTitle, monthlyIncome: p.monthlyIncome }));
    d.applicants.push({
      id: `ap-${id.slice(0, 12)}`, unitId: f!.unit.id, names: people.map((p) => p.name), email: people[0].email, phone: people[0].phone, submitted: today, moveIn: b.moveIn,
      currentAddress: b.currentAddress, yearsAtAddress: b.yearsAtAddress, employer: people.map((p) => p.employer).filter(Boolean).join('; '),
      monthlyIncome: people.reduce((a, p) => a + p.monthlyIncome, 0), references: b.references ?? '', pets: b.pets,
      notes: [b.petsWhat ? `Pets: ${b.petsWhat}` : '', b.notes ?? ''].filter(Boolean).join(' · '), status: 'new',
      occupants: b.occupants, emergencyContact: b.emergencyContact, currentRent: b.currentRent, landlordName: b.landlordName, landlordPhone: b.landlordPhone,
      reasonLeaving: b.reasonLeaving, jobTitle: people[0].jobTitle, employedYears: b.employedYears, employerContact: b.employerContact, otherIncome: b.otherIncome,
      otherIncomeSource: b.otherIncomeSource, leaseTerm: b.leaseTerm, vehicles: b.vehicles, smoking: b.smoking, creditConsent: !!b.creditConsent, people,
    });
    d.audit.unshift({ id: randomUUID(), at: new Date().toISOString(), action: 'Application received', detail: `${people.map((p) => p.name).join(' & ')} for Unit ${f!.unit.label}, ${f!.prop.nickname}` });
    await writeState(db, f!.accountId, f!.state.revision, d, 'Application form');
    if (f!.ownerEmail) {
      await queueMail(db, { accountId: f!.accountId, kind: 'application', to: f!.ownerEmail, subject: `New application for Unit ${f!.unit.label}, ${f!.prop.nickname}`,
        text: `${people.map((p) => p.name).join(' & ')} applied for Unit ${f!.unit.label} at ${f!.prop.address}.\n\nReview it in Keyholder: ${cfg.appUrl}/#/rent/property/${f!.prop.id}/find\n`, dedupeKey: `application-${id}` }).catch(() => null);
    }
    return reply.code(201).send({ ok: true });
  });

  // ---------------- Start fresh for real bank data (super user only) ----------------
  app.post('/api/admin/start-fresh', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const me = needSuper(req);
    const b = z.object({ password: z.string().max(200), confirm: z.literal('START FRESH') }).parse(req.body);
    if (!me.password_hash || !(await verifyPassword(b.password, me.password_hash))) fail(400, 'Your password is not right.');
    // Connections at Plaid are removed too (old ones were made with test keys and stop working anyway).
    await keys.refresh(db, true);
    for (const it of await db.query<{ access_token: string }>('select access_token from bank_items')) {
      try { if (plaid.ready()) await plaid.remove(keys.decrypt(it.access_token)); } catch { /* made with other keys, or already gone */ }
    }
    const r = await startFresh(db, me.email);
    await audit(db, { actor: me.email, actorId: me.id, scope: 'admin', action: 'Started fresh for real bank data', detail: `${r.accounts} accounts: ${r.expenses} expenses, ${r.transactions} bank transactions, ${r.payments} bank-matched rent payments, ${r.banks} bank connections removed`, ip: ip(req) });
    return r;
  });

  // ---------------- Connections: API keys (super user only) ----------------
  app.get('/api/admin/connections', async (req) => {
    needSuper(req);
    await keys.refresh(db, true);
    return { canSave: keys.canSave, services: keys.describe() };
  });
  app.put('/api/admin/connections', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const me = needSuper(req);
    const b = z.object({ password: z.string().max(200), values: z.record(z.string().max(80), z.string().max(2000).nullable()) }).parse(req.body);
    if (!keys.canSave) fail(400, 'Add KEYS_SECRET in Render first (Environment), then try again.');
    if (!me.password_hash || !(await verifyPassword(b.password, me.password_hash))) fail(400, 'Your password is not right.');
    for (const [name, v] of Object.entries(b.values)) {
      const f = fieldOf(name); if (!f) fail(400, `Unknown setting: ${name}`);
      if (v && f!.options && !f!.options.includes(v.trim())) fail(400, `${f!.label}: choose ${f!.options.join(' or ')}.`);
    }
    // Sending email through a provider needs its key (set now, saved earlier, or in Render).
    await keys.refresh(db, true);
    const after = (n: string) => (n in b.values ? (b.values[n] ?? '').trim() || keys.envValue(n) : keys.get(n));
    const provider = after('email.provider');
    if (provider === 'resend' && !after('email.resendKey')) fail(400, 'Sending with Resend needs the Resend API key.');
    if (provider === 'postmark' && !after('email.postmarkToken')) fail(400, 'Sending with Postmark needs the Postmark server token.');
    const lines = await db.tx(async (q) => {
      const l = await keys.save(q, b.values, me.email);
      for (const line of l) await audit(q, { actor: me.email, actorId: me.id, scope: 'admin', action: 'API key changed', detail: line, ip: ip(req) });
      return l;
    });
    await keys.refresh(db, true);
    return { saved: lines.length, canSave: keys.canSave, services: keys.describe() };
  });
  app.post('/api/admin/connections/test', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const me = needSuper(req);
    const { service } = z.object({ service: z.enum(['google', 'email', 'places', 'stripe', 'plaid']) }).parse(req.body);
    await keys.refresh(db, true);
    const r = await keys.test(service as ServiceId, fetcher, cfg.appUrl);
    await audit(db, { actor: me.email, actorId: me.id, scope: 'admin', action: 'Connection tested', detail: `${service}: ${r.ok ? 'ok' : 'not working'}`, ip: ip(req) });
    return r;
  });

  // ---------------- Local tools (never in production) ----------------
  if (cfg.devTools) {
    // Local tests: make this session's sign-in an hour old, so "Confirm it's you" is asked.
    app.post('/api/dev/age-session', async (req) => {
      need(req);
      await db.query(`update sessions set created_at = now() - interval '1 hour', verified_at = null where token_hash = $1`, [sha256(req.sessionToken!)]);
      return { ok: true };
    });
    app.get('/api/dev/outbox', async (req) => {
      const to = String((req.query as { to?: string }).to ?? '');
      return db.query(`select kind, to_email, subject, text_body, status, created_at, attachment->>'formId' as attached_form, attachment->>'filename' as attached_file from outbox where ($1 = '' or lower(to_email) = lower($1)) order by created_at desc limit 50`, [to]);
    });
  }

  // ---------------- The website and app ----------------
  // index.html gets a marker so the app knows a Keyholder server is behind it (static hosts serve the
  // file without it, and the app then stays in browser-only mode without asking).
  const dir = staticDir === undefined ? resolve(process.cwd(), 'dist') : staticDir;
  const indexFile = dir ? join(dir, 'index.html') : '';
  const page = indexFile && existsSync(indexFile)
    // <base href="/">: pages at deeper addresses (/apply/<listing>, /plaid-oauth) load the app's files from the root.
    ? readFileSync(indexFile, 'utf8').replace(/<head>/i, '<head>\n    <base href="/" />\n    <meta name="keyholder-server" content="1" />')
    : null;
  if (page) build = createHash('sha256').update(page).digest('hex').slice(0, 12);
  if (dir && page) {
    await app.register(fstatic, {
      root: dir, wildcard: true, index: false,
      setHeaders: (res, path) => res.header('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    });
  }
  const sendPage = (reply: FastifyReply) => reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(page);
  if (page) { app.get('/', async (_req, reply) => sendPage(reply)); app.get('/index.html', async (_req, reply) => sendPage(reply)); }
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET' || !page) return reply.code(404).send({ error: 'Not found.' });
    return sendPage(reply);
  });

  return app;
}
