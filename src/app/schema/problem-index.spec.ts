import { describe, expect, it } from 'vitest';
import { ProblemIndex, appendKey, formatPath, parsePathKey, pathKey } from './problem-index';
import type { Path, Problem } from './schema.types';

const problem = (path: Path, message = 'bad'): Problem => ({ path, keyword: 'x', message, schemaPath: '#' });

describe('pathKey', () => {
  it('matches the table components\' uid format', () => {
    expect(pathKey([])).toBe('');
    expect(pathKey(['members', 1, 'contact'])).toBe('.members[1].contact');
    expect(pathKey([0])).toBe('[0]');
  });
});

describe('parsePathKey', () => {
  const paths: Path[] = [
    [],
    ['members', 1, 'contact'],
    [0],
    ['logging', 'loggers', 'http.client'],
    ['a[0]', 'b]', '[', ']', '.'],
    ['back\\slash', 'trailing\\'],
    ['', '0', ''],
    [1, 2, 'x'],
  ];
  it.each(paths)('round-trips %j', (...path) => {
    expect(parsePathKey(pathKey(path))).toEqual(path);
  });

  it('keeps keys that look alike apart', () => {
    expect(pathKey(['a', 'b'])).not.toBe(pathKey(['a.b']));
    expect(pathKey(['a', 0])).not.toBe(pathKey(['a[0]']));
    expect(pathKey(['0'])).not.toBe(pathKey([0]));
  });

  it('builds keys step by step', () => {
    expect(appendKey(appendKey('', 'members'), 3)).toBe('.members[3]');
  });

  it('survives malformed input', () => {
    expect(() => parsePathKey('.a[')).not.toThrow();
    expect(parsePathKey('garbage')).toEqual([]);
  });
});

describe('formatPath', () => {
  it('writes paths the way people do', () => {
    expect(formatPath([])).toBe('(document)');
    expect(formatPath(['members', 0, 'contact', 'email'])).toBe('members[0].contact.email');
    expect(formatPath([2, 'x'])).toBe('[2].x');
    expect(formatPath(['loggers', 'http.client'])).toBe('loggers.http.client');
  });
});

describe('ProblemIndex', () => {
  const data = { team: 'x', members: [{ id: 1 }, { id: 2 }] };

  it('puts a problem on the node it names', () => {
    const idx = new ProblemIndex([problem(['members', 1, 'id'], 'nope')], data);
    expect(idx.at('.members[1].id').map((p) => p.message)).toEqual(['nope']);
    expect(idx.at('.members[0].id')).toEqual([]);
  });

  it('anchors a problem about a missing key on the deepest existing node', () => {
    const idx = new ProblemIndex([problem(['members', 1, 'name'])], data);
    expect(idx.at('.members[1]')).toHaveLength(1);
    expect(idx.at('.members[1].name')).toEqual([]);
  });

  it('tells which node a problem is shown on', () => {
    const missing = problem(['members', 1, 'name']);
    const present = problem(['members', 1, 'id']);
    const idx = new ProblemIndex([missing, present], data);
    expect(idx.anchorOf(missing)).toEqual(['members', 1]);
    expect(idx.anchorOf(present)).toEqual(['members', 1, 'id']);
  });

  it('anchors a missing array item on the array', () => {
    const idx = new ProblemIndex([problem(['members', 5])], data);
    expect(idx.at('.members')).toHaveLength(1);
  });

  it('counts problems below every ancestor, root included', () => {
    const idx = new ProblemIndex([problem(['members', 0, 'id']), problem(['members', 1, 'id']), problem(['team'])], data);
    expect(idx.countBelow('')).toBe(3);
    expect(idx.countBelow('.members')).toBe(2);
    expect(idx.countBelow('.members[0]')).toBe(1);
    expect(idx.countBelow('.members[0].id')).toBe(0);
    expect(idx.countBelow('.team')).toBe(0);
  });

  it('keeps a root problem on the root', () => {
    const idx = new ProblemIndex([problem([], 'must be object')], 42);
    expect(idx.at('')).toHaveLength(1);
    expect(idx.countBelow('')).toBe(0);
  });

  it('handles keys that only exist on the prototype as missing', () => {
    const idx = new ProblemIndex([problem(['toString'])], {});
    expect(idx.at('')).toHaveLength(1);
  });
});
