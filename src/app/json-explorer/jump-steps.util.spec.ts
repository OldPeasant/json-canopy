import { describe, expect, it } from 'vitest';
import { revealSteps } from './jump-steps.util';

const doc = {
  team: 'x',
  members: [
    { id: 1, name: 'a', contact: { email: 'e' }, skills: ['m', 'n'] },
    { id: 2, name: 'b' },
  ],
  tags: ['p', 'q', 'r'],
  mixed: [{ a: 1 }, 'loose'],
};

describe('revealSteps', () => {
  it('has no steps for the root', () => {
    expect(revealSteps(doc, [])).toEqual([]);
  });

  it('opens each object on the way, naming the column it may have hidden', () => {
    const steps = revealSteps(doc, ['members', 0, 'contact', 'email']);
    expect(steps.map(({ uid, path, kind, colKey, position }) => ({ uid, path, kind, colKey, position }))).toEqual([
      { uid: '', path: '', kind: 'object', colKey: ':members', position: 1 },
      { uid: '.members', path: 'members', kind: 'records', colKey: 'members:contact', position: 0 },
      { uid: '.members[0].contact', path: 'members.*.contact', kind: 'object', colKey: 'members.*.contact:email', position: 0 },
    ]);
  });

  it('takes row and column of a record cell as one step', () => {
    const steps = revealSteps(doc, ['members', 1, 'name']);
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ uid: '.members', kind: 'records', colKey: 'members:name', position: 1 });
  });

  it('stops at a row when the problem is about the row itself', () => {
    const steps = revealSteps(doc, ['members', 1]);
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ uid: '.members', kind: 'records', position: 1 });
    expect(steps[1].colKey).toBeUndefined();
  });

  it('counts items of a plain array by index, with no column', () => {
    const steps = revealSteps(doc, ['tags', 2]);
    expect(steps[1]).toMatchObject({ uid: '.tags', path: 'tags', kind: 'items', position: 2 });
    expect(steps[1].colKey).toBeUndefined();
  });

  it('reaches inside plain arrays nested in records', () => {
    const steps = revealSteps(doc, ['members', 0, 'skills', 1]);
    expect(steps[2]).toMatchObject({ uid: '.members[0].skills', path: 'members.*.skills', kind: 'items', position: 1 });
  });

  it('handles the loose item of a mixed array as an item, not a cell', () => {
    const steps = revealSteps(doc, ['mixed', 1]);
    expect(steps[1]).toMatchObject({ uid: '.mixed', path: 'mixed', kind: 'records', position: 1 });
    expect(steps[1].colKey).toBeUndefined();
  });

  it('escapes keys the way the table does', () => {
    const steps = revealSteps({ 'a.b': { c: 1 } }, ['a.b', 'c']);
    expect(steps[1].uid).toBe('.a\\.b');
  });

  it('does not run past a path the data does not have', () => {
    expect(() => revealSteps(doc, ['team', 'nope', 'deeper'])).not.toThrow();
  });

  it('reports the position of a key among its siblings', () => {
    expect(revealSteps(doc, ['tags'])[0].position).toBe(2);
  });
});
