import { describe, expect, it } from 'vitest';
import { seedState } from '../data/seed';
import { byValue, keyholderScore, propertyCompletion, scoreTone } from './score';
import { defaultProfile, emptyState } from '../data/seed';

const today = '2026-11-08';

describe('Keyholder score', () => {
  it('is between 0 and 100 and lists what to do, biggest gain first', () => {
    const s = seedState(undefined, '2026-11-08');
    const { score, todo } = keyholderScore(s, today);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
    const gains = todo.map((i) => i.points - i.earned);
    expect(gains).toEqual([...gains].sort((a, b) => b - a));
  });

  it('goes stage by stage (25 each): only the current stage is suggested; the colour follows the score', () => {
    const s = emptyState({ ...defaultProfile(), name: '', email: '' });
    const a = keyholderScore(s, today);
    expect(a.stage).toBe(1);
    expect(a.todo.every((i) => i.stage === 1)).toBe(true);
    expect(a.score).toBeLessThan(25);
    expect(scoreTone(a.score)).toBe('rose');
    // Stage 1 done (name, a property with a unit and its tenant with an email): at least 25, stage 2 next.
    const r = seedState(undefined, today);
    const b = keyholderScore(r, today);
    expect(b.stages[0].pct).toBeGreaterThan(0);
    expect(b.todo.every((i) => i.stage === b.stage)).toBe(true);
    expect(scoreTone(100)).toBe('done');
    expect(scoreTone(80)).toBe('teal');
  });

  it('goes up when a property gets its purchase price', () => {
    const s = seedState(undefined, '2026-11-08');
    const before = keyholderScore(s, today).score;
    const birch = s.properties.find((p) => p.id === 'p-birch')!;
    const pctBefore = propertyCompletion(s, birch, today);
    birch.purchasePrice = 108_000_000; birch.purchaseDate = '2021-09-01';
    expect(keyholderScore(s, today).score).toBeGreaterThan(before);
    expect(propertyCompletion(s, birch, today)).toBeGreaterThan(pctBefore);
  });

  it('orders properties by value, most valuable first', async () => {
    const s = seedState(undefined, '2026-11-08');
    const { propertyValue } = await import('./finance');
    const vals = byValue(s, today).map((p) => propertyValue(s, p, today).value);
    expect(vals).toEqual([...vals].sort((a, b) => b - a));
    s.properties.find((p) => p.id === 'p-birch')!.purchasePrice = 200_000_000;
    s.properties.find((p) => p.id === 'p-birch')!.purchaseDate = '2025-11-01';
    expect(byValue(s, today)[0].id).toBe('p-birch');
  });
});
