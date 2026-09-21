import { describe, expect, it } from 'vitest';
import { ProblemIndex, pathKey } from './problem-index';
import type { Path, Problem } from './schema.types';

const problem = (path: Path, message = 'bad'): Problem => ({ path, keyword: 'x', message, schemaPath: '#' });

describe('pathKey', () => {
  it('matches the table components\' uid format', () => {
    expect(pathKey([])).toBe('');
    expect(pathKey(['members', 1, 'contact'])).toBe('.members[1].contact');
    expect(pathKey([0])).toBe('[0]');
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
