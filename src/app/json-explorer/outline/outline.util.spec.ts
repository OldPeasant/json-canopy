import { describe, expect, it } from 'vitest';
import { ProblemIndex, type Problem } from '../../schema';
import { outlineRows } from './outline.util';

const problem = (path: Array<string | number>): Problem => ({ path, keyword: 'x', message: 'bad', schemaPath: '#' });
const rowsOf = (data: unknown, problems: Problem[] = []) => outlineRows(data, new ProblemIndex(problems, data));

describe('outlineRows', () => {
  const doc = { name: 'x', server: { port: 1, tls: { cert: 'c', deep: { deeper: { deepest: {} } } } }, tags: ['a', 'b'], flag: true };

  it('lists objects and arrays, not plain scalars', () => {
    expect(rowsOf(doc).map((r) => `${'  '.repeat(r.depth)}${r.label}:${r.kind}`)).toEqual([
      'server:object',
      '  tls:object',
      '    deep:object',
      'tags:array',
    ]);
  });

  it('stops descending after a few levels', () => {
    expect(rowsOf(doc).some((r) => r.label === 'deeper')).toBe(false);
  });

  it('gives each row its instance key, path and size', () => {
    const tls = rowsOf(doc).find((r) => r.label === 'tls')!;
    expect(tls).toMatchObject({ key: '.server.tls', path: ['server', 'tls'], kind: 'object', size: 2 });
    expect(rowsOf(doc).find((r) => r.label === 'tags')).toMatchObject({ size: 2 });
  });

  it('counts the problems at and below a node', () => {
    const rows = rowsOf(doc, [problem(['server', 'port']), problem(['server', 'tls', 'cert'])]);
    expect(rows.find((r) => r.label === 'server')!.problems).toBe(2);
    expect(rows.find((r) => r.label === 'tls')!.problems).toBe(1);
    expect(rows.find((r) => r.label === 'tags')!.problems).toBe(0);
  });

  it('lists a scalar only when it has a problem, so errors stay findable', () => {
    const rows = rowsOf(doc, [problem(['name'])]);
    expect(rows.find((r) => r.label === 'name')).toMatchObject({ kind: 'scalar', problems: 1 });
    expect(rows.some((r) => r.label === 'flag')).toBe(false);
  });

  it('cuts off a level that is too long and says how much was left out', () => {
    const big = { catalog: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, { n: i }])) };
    const rows = rowsOf(big);
    const level = rows.filter((r) => r.depth === 1);
    expect(level).toHaveLength(41);
    expect(level[40]).toMatchObject({ kind: 'more', size: 60, label: '… 60 more' });
  });

  it('is empty for a document that is not an object', () => {
    expect(rowsOf([1, 2])).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
  });
});
