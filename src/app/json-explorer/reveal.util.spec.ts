import { describe, expect, it } from 'vitest';
import { formRevealKey, initialFormRevealCount, initialRevealCount } from './reveal.util';

describe('initialFormRevealCount', () => {
  it('never starts with more than the cap, even when the byte budget allows it', () => {
    expect(initialRevealCount(3000, 50)).toBe(1000);
    expect(initialFormRevealCount(3000, 50)).toBe(200);
  });

  it('is the table\'s count when that is already small', () => {
    expect(initialFormRevealCount(10, 50)).toBe(10);
    expect(initialFormRevealCount(3000, 5000)).toBe(20);
    expect(initialFormRevealCount(0, 50)).toBe(0);
  });
});

describe('formRevealKey', () => {
  it('never collides with a table path', () => {
    expect(formRevealKey('members.*.skills')).toBe('form:members.*.skills');
    expect(formRevealKey('')).toBe('form:');
  });
});
