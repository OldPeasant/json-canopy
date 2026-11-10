import { describe, expect, it } from 'vitest';
import {
  formatLinePath,
  groupByShape,
  isJsonLinesFileName,
  lineValues,
  parseJsonLines,
  serializeJsonLines,
  shapeOf,
  shownLineIndices,
  similarity,
  withLineValue,
} from './json-lines.util';

describe('parseJsonLines', () => {
  it('reads one document per line, keeping blank lines and text lines', () => {
    const doc = parseJsonLines('{"a":1}\n\nnot json\n[1,2]\n')!;
    expect(doc.lines.map(l => l.kind)).toEqual(['json', 'blank', 'text', 'json']);
    expect(lineValues(doc)).toEqual([{ a: 1 }, undefined, undefined, [1, 2]]);
    expect(shownLineIndices(doc)).toEqual([0, 2, 3]);
  });

  it('gives up when fewer than half of the lines are JSON', () => {
    const broken = '{\n  "a": 1,\n  "b": {"c": 2}\n  "d": "x"\n}';
    expect(parseJsonLines(broken)).toBeUndefined();
    expect(parseJsonLines('nothing\nhere')).toBeUndefined();
  });

  it('takes any text when forced, as for a .jsonl file', () => {
    expect(parseJsonLines('nothing\nhere', true)!.lines.map(l => l.kind)).toEqual(['text', 'text']);
    expect(parseJsonLines('', true)!.lines.map(l => l.kind)).toEqual(['blank']);
  });
});

describe('serializeJsonLines', () => {
  it('gives back the text unchanged when nothing was edited', () => {
    for (const text of ['{"a": 1}\n\n  {"a":2}\nbad\n', '{"a":1}\r\n{"a":2}', '{"a":1}', '']) {
      expect(serializeJsonLines(parseJsonLines(text, true)!)).toBe(text);
    }
  });

  it('rewrites only the edited line, compactly', () => {
    const doc = parseJsonLines('{"a": 1}\r\n{"a": 2}\r\n')!;
    expect(serializeJsonLines(withLineValue(doc, 1, { a: 3, b: [true] }))).toBe('{"a": 1}\r\n{"a":3,"b":[true]}\r\n');
  });

  it('keeps an edited line in its group', () => {
    const doc = parseJsonLines('{"a":1}\n[1]\n')!;
    const edited = withLineValue(doc, 0, [1]);
    expect(edited.lines[0]).toMatchObject({ kind: 'json', group: 0 });
  });
});

describe('grouping by shape', () => {
  it('describes a value by its key paths, not its values', () => {
    expect([...shapeOf({ a: 1, b: [{ c: 2 }, { c: 3, d: null }] })].sort()).toEqual(
      [':object', '.a', '.b', '.b.*', '.b.*.c', '.b.*.d'].sort(),
    );
    expect(similarity(shapeOf({ a: 1 }), shapeOf({ a: 'x' }))).toBe(1);
  });

  it('groups lines that differ by a field or so, and keeps others apart', () => {
    const big = { id: 1, user: { name: 'a', email: 'b' }, tags: ['x'], at: 't', level: 'info' };
    const { of, count } = groupByShape([
      big,
      { ...big, extra: true }, // 9 of 10 paths shared
      { kind: 'other', payload: { x: 1 } },
      { id: 2, tags: ['y'], at: 'u' }, // 5 of 9 paths shared
      42,
      'text',
    ]);
    expect(of).toEqual([0, 0, 1, 2, 3, 3]);
    expect(count).toBe(4);
  });

  it('does not tell lines apart by what an empty array would hold', () => {
    const full = { request: { path: '/a', headers: [{ name: 'x', value: 'y' }] }, response: { status: 200, ms: 1 } };
    const empty = { request: { path: '/b', headers: [] }, response: { status: 404, ms: 2 } };
    expect(similarity(shapeOf(full), shapeOf(empty))).toBe(1);
    expect(groupByShape([full, empty]).of).toEqual([0, 0]);
  });
});

describe('isJsonLinesFileName / formatLinePath', () => {
  it('recognises JSON Lines file names', () => {
    expect(isJsonLinesFileName('log.jsonl')).toBe(true);
    expect(isJsonLinesFileName('LOG.NDJSON')).toBe(true);
    expect(isJsonLinesFileName('a.json')).toBe(false);
    expect(isJsonLinesFileName(null)).toBe(false);
  });

  it('names the line by its number', () => {
    expect(formatLinePath([3])).toBe('line 4');
    expect(formatLinePath([0, 'items', 2, 'name'])).toBe('line 1: items[2].name');
  });
});
