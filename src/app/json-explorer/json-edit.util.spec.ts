import { describe, expect, it } from 'vitest';
import { blankItemLike } from './json-edit.util';

describe('blankItemLike', () => {
  it('gives an array of records a record with every key, blanked', () => {
    const arr = [
      { id: 1, name: 'Ada', contact: { email: 'a@x' } },
      { id: 2, name: 'Bob', role: 'lead' },
    ];
    expect(blankItemLike(arr)).toEqual({ id: 0, name: '', contact: { email: '' }, role: '' });
  });

  it('keeps the keys in the order the table shows them as columns', () => {
    expect(Object.keys(blankItemLike([{ b: 1 }, { a: 1, b: 2, c: 3 }]) as object)).toEqual(['b', 'a', 'c']);
  });

  it('blanks a key like the first record that has it', () => {
    expect(blankItemLike([{ v: null }, { v: 'x' }])).toEqual({ v: null });
  });

  it('ignores stray non-record items in an array of records', () => {
    expect(blankItemLike(['', { a: 'x' }, 3])).toEqual({ a: '' });
  });

  it('gives an array of plain values one more of the same type', () => {
    expect(blankItemLike([1, 2])).toBe(0);
    expect(blankItemLike(['a'])).toBe('');
    expect(blankItemLike([true])).toBe(false);
  });

  it('gives an empty array an empty string, as before', () => {
    expect(blankItemLike([])).toBe('');
  });
});
