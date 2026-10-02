import { describe, expect, it } from 'vitest';
import { RevealService } from './reveal.service';

describe('RevealService', () => {
  it('shows a small array in full once a search no longer narrows it', () => {
    const reveal = new RevealService();
    // First drawn while a search let only 2 of its 3 items through.
    expect(reveal.count('tags', 2, 2)).toBe(2);
    expect(reveal.count('tags', 3, 3)).toBe(3);
  });

  it('keeps revealed-more progress across a narrowing filter', () => {
    const reveal = new RevealService();
    reveal.revealMore('items', 20);
    expect(reveal.count('items', 5, 5)).toBe(5);
    expect(reveal.count('items', 1000, 50)).toBe(70);
  });

  it('reveals everything, and only as far as a jump needs', () => {
    const reveal = new RevealService();
    reveal.ensure('items', 10, 50);
    expect(reveal.count('items', 1000, 50)).toBe(50);
    reveal.ensure('items', 59, 50);
    expect(reveal.count('items', 1000, 50)).toBe(60);
    reveal.revealAll('items');
    expect(reveal.count('items', 1000, 50)).toBe(1000);
  });
});
