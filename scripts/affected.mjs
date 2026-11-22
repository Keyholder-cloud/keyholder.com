// Which checks to run for the files changed (against main): prints the commands. Used before pushing, so a fix
// is tested where it matters in minutes; GitHub still runs everything (in parallel) before anything merges.
//   node scripts/affected.mjs            → the commands for this branch's changes
import { execSync } from 'node:child_process';

const files = execSync('git diff --name-only origin/main...HEAD; git diff --name-only; git diff --name-only --cached', { encoding: 'utf8' })
  .split('\n').map((f) => f.trim()).filter(Boolean);
// File (or folder) → browser-only test sections (scripts/ux-flow-test.cjs). Unlisted app files → A and B.
const MAP = [
  [/^src\/screens\/(Landing|Security)/, 'C,D,G'], [/^src\/screens\/(Account|AuthLinks|Onboarding)/, 'D,E'],
  [/^src\/support\/|^src\/screens\/Support/, 'J'], [/^src\/screens\/Money|^src\/components\/StatementUpload|^src\/lib\/(taxyear|statements)/, 'F,H'],
  [/^src\/screens\/(Rentals|PropertyDetail|TenantDetail)|^src\/components\/(TenantActions|PropertyActions)/, 'B,H'],
  [/^src\/components\/(HomeCards|Journey|levels|Setup)|^src\/lib\/score/, 'A,B,F'], [/^src\/screens\/Settings/, 'A,E'],
  [/^src\/components\/Brand|^src\/assets/, 'I,G'], [/^src\/styles\//, 'A,B,H'],
];
const sections = new Set(); let server = false, unit = false;
for (const f of files) {
  if (/^server\//.test(f) || /^src\/components\/(TwoStep|ConfirmIt)|^src\/data\/(api|sync)/.test(f)) server = true;
  if (/\.(ts|tsx)$/.test(f)) unit = true;
  if (!/^src\//.test(f)) continue;
  const hit = MAP.filter(([re]) => re.test(f));
  (hit.length ? hit.map(([, s]) => s) : ['A,B']).forEach((s) => s.split(',').forEach((x) => sections.add(x)));
}
const out = ['npx tsc --noEmit -p . && npx tsc -p tsconfig.server.json --noEmit'];
if (unit) out.push('npx vitest run');
if (server) out.push('npm run build && node scripts/e2e-server.cjs');
if (sections.size) out.push(`npx vite build && ONLY=${[...sections].sort().join(',')} node scripts/ux-flow-test.cjs   # needs: npx vite preview --port 4173 &`);
console.log(`${files.length} changed files\n` + out.join('\n'));
