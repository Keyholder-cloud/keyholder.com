import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256 } from './security';

// Two-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password...):
// time-based one-time passwords (RFC 6238, the 30-second, 6-digit codes those apps show), and backup codes.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new secret for an authenticator app (160 bits, as base32). */
export const newSecret = () => toBase32(randomBytes(20));

/** The code for one 30-second step (RFC 4226 HOTP with SHA-1, 6 digits). */
export function codeAt(secret: Buffer, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export const stepNow = (ms = Date.now()) => Math.floor(ms / 30_000);

/**
 * Checks a 6-digit code, allowing one step either side for clocks that drift. Returns the step it matched, or null.
 * A step at or before `lastStep` is refused, so the same code cannot be used twice.
 */
export function checkCode(secretB32: string, code: string, lastStep: number | null = null, ms = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const secret = fromBase32(secretB32);
  const now = stepNow(ms);
  for (const s of [now, now - 1, now + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(codeAt(secret, s)), Buffer.from(c))) return s;
  }
  return null;
}

/** What the authenticator app scans (the QR code). */
export const otpauthUri = (secretB32: string, email: string, issuer = 'Keyholder') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Ten one-time backup codes like "k7qd-2m4x", for when the phone is lost; only their hashes are stored. */
export function newBackupCodes(n = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: n }, () => { const s = toBase32(randomBytes(5)).toLowerCase(); return `${s.slice(0, 4)}-${s.slice(4, 8)}`; });
  return { codes, hashes: codes.map(backupHash) };
}
export const backupHash = (code: string) => sha256(`backup:${code.toLowerCase().replace(/[^a-z2-7]/g, '')}`);
export const looksLikeBackup = (code: string) => /^[a-z2-7]{4}-?[a-z2-7]{4}$/i.test(code.trim());
