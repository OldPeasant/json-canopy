import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultLayout } from './layout.util';

const load = (file: string) => JSON.parse(readFileSync(new URL(`../../../samples/${file}`, import.meta.url), 'utf8'));

describe('defaultLayout', () => {
  it('stays with tables when there is no schema', () => {
    expect(defaultLayout(load('config/app-config.json'), false)).toBe('tables');
  });

  it('picks tables for documents that are lists of records', () => {
    expect(defaultLayout(load('team.json'), true)).toBe('tables');
    expect(defaultLayout(load('plugin-demo/filters-demo.json'), true)).toBe('tables');
    expect(defaultLayout(load('search-demo.json'), true)).toBe('tables');
    expect(defaultLayout([{ a: 1 }], true)).toBe('tables');
  });

  it('picks the form for configuration', () => {
    expect(defaultLayout(load('config/app-config.json'), true)).toBe('form');
    expect(defaultLayout(load('config/pipeline.json'), true)).toBe('form');
  });

  it('needs at least two records to call something a list', () => {
    expect(defaultLayout({ items: [{ a: 1 }] }, true)).toBe('form');
    expect(defaultLayout({ items: [{ a: 1 }, { a: 2 }] }, true)).toBe('tables');
    expect(defaultLayout({ items: ['a', 'b', 'c'] }, true)).toBe('form');
  });

  it('keeps tables for documents that are not objects', () => {
    expect(defaultLayout(3, true)).toBe('tables');
    expect(defaultLayout(null, true)).toBe('tables');
    expect(defaultLayout(['a'], true)).toBe('tables');
  });
});
