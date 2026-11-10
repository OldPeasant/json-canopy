import { formatPath, type Path } from '../schema';

// JSON Lines (also called NDJSON): one JSON document per line. Pure and
// Angular-free. A file is read this way when it is not one JSON document as a
// whole (or its name says it is JSON Lines), and its lines mostly are.
//
// Every physical line is kept, so writing the file back changes only the lines
// that were edited: the others keep their exact text, blank lines included.

/** One physical line of the file. */
export type JsonLine =
  | { kind: 'json'; value: unknown; text: string; group: number }
  // Not JSON: shown as it is, in a single cell.
  | { kind: 'text'; text: string }
  // Empty or whitespace only: not shown, but kept when writing back.
  | { kind: 'blank'; text: string };

export interface JsonLinesDoc {
  lines: readonly JsonLine[];
  // The line separator the file uses, so writing back keeps it.
  eol: '\n' | '\r\n';
  // Whether the last line ends with a line break.
  finalEol: boolean;
  // How many groups of similarly shaped lines there are (see groupByShape).
  groupCount: number;
}

/** File name extensions that say a file is JSON Lines, whatever its content. */
export function isJsonLinesFileName(name: string | null | undefined): boolean {
  return !!name && /\.(jsonl|ndjson)$/i.test(name);
}

/**
 * Reads `text` as JSON Lines. Unless `force` is set (the file name says it is
 * JSON Lines), at least half of the non-blank lines must be JSON: a broken
 * pretty-printed document has a line here and there that happens to parse
 * (`"x"`, `{"a": 1}`), and is better shown with its error.
 */
export function parseJsonLines(text: string, force = false): JsonLinesDoc | undefined {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const raw = text.split(/\r?\n/);
  // A final line break ends the last line; it does not start an empty one.
  const finalEol = raw.length > 1 && raw[raw.length - 1] === '';
  if (finalEol) raw.pop();
  let json = 0;
  let other = 0;
  const parsed = raw.map((line): JsonLine | { kind: 'json'; value: unknown; text: string } => {
    if (line.trim() === '') return { kind: 'blank', text: line };
    try {
      const value = JSON.parse(line);
      json++;
      return { kind: 'json', value, text: line };
    } catch {
      other++;
      return { kind: 'text', text: line };
    }
  });
  if (!force && (json === 0 || json < other)) return undefined;
  const groups = groupByShape(parsed.filter(l => l.kind === 'json').map(l => (l as { value: unknown }).value));
  let next = 0;
  const lines = parsed.map((l): JsonLine => (l.kind === 'json' ? { ...l, group: groups.of[next++] } : l));
  return { lines, eol, finalEol, groupCount: groups.count };
}

/** The text of the file: one line per line, line breaks as they were. */
export function serializeJsonLines(doc: JsonLinesDoc): string {
  return doc.lines.map(l => l.text).join(doc.eol) + (doc.finalEol ? doc.eol : '');
}

/**
 * The document with line `index` holding `value` instead. The line keeps its
 * group: a line that is being edited does not change how it is laid out.
 */
export function withLineValue(doc: JsonLinesDoc, index: number, value: unknown): JsonLinesDoc {
  const line = doc.lines[index];
  if (line?.kind !== 'json') return doc;
  const lines = doc.lines.slice();
  lines[index] = { ...line, value, text: JSON.stringify(value) };
  return { ...doc, lines };
}

/** What a line contributes to the data the schema sees: its value, or undefined when it is not JSON. */
export function lineValues(doc: JsonLinesDoc): unknown[] {
  return doc.lines.map(l => (l.kind === 'json' ? l.value : undefined));
}

/** Indices of the lines that are shown: every line that is not blank. */
export function shownLineIndices(doc: JsonLinesDoc): number[] {
  const shown: number[] = [];
  doc.lines.forEach((l, i) => {
    if (l.kind !== 'blank') shown.push(i);
  });
  return shown;
}

/**
 * The structural path the lines of group `group` use for their root, in place
 * of the '' a whole document uses. Every bit of view state keyed by
 * structural path (orientation, hidden columns, related collapse, column
 * widths, reveal counts) is thereby shared within a group and nowhere else.
 */
export function groupRootPath(group: number): string {
  return `~g${group + 1}`;
}

/** Instance key (`uid`) of line `index`'s root: data paths start with the line's index. */
export function lineUid(index: number): string {
  return `[${index}]`;
}

/** A path into a JSON Lines document as a person would read it: `line 4: items[0].name`. */
export function formatLinePath(path: Path): string {
  if (!path.length || typeof path[0] !== 'number') return formatPath(path);
  const rest = path.slice(1);
  return `line ${path[0] + 1}${rest.length ? `: ${formatPath(rest)}` : ''}`;
}

// --- grouping by shape --------------------------------------------------------

/** Two lines are alike when this share of their key paths is the same. */
export const SIMILARITY_THRESHOLD = 0.8;

/**
 * The shape of a value: its root type and every key path in it, array items
 * counting as one (`items.*.name`). Values are ignored. An empty array says
 * nothing about what its items look like, so it is marked open (`items.*?`):
 * another shape is not told apart from this one by what it has there.
 */
export function shapeOf(value: unknown): Set<string> {
  const shape = new Set<string>([`:${rootKind(value)}`]);
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      const p = `${path}.*`;
      if (!v.length) shape.add(`${p}${OPEN}`);
      for (const item of v) {
        shape.add(p);
        walk(item, p);
      }
    } else if (typeof v === 'object' && v !== null) {
      for (const [k, child] of Object.entries(v)) {
        const p = `${path}.${k}`;
        shape.add(p);
        walk(child, p);
      }
    }
  };
  walk(value, '');
  return shape;
}

function rootKind(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'scalar';
}

const OPEN = '?';

/**
 * How much two shapes have in common: shared paths over all paths (Jaccard),
 * leaving out what one of them has below an array the other has empty.
 */
export function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  let all = 0;
  const count = (from: ReadonlySet<string>, other: ReadonlySet<string>, both: boolean): void => {
    for (const p of from) {
      if (p.endsWith(OPEN)) continue;
      if (other.has(p)) {
        if (both) {
          shared++;
          all++;
        }
      } else if (!openIn(other, p)) {
        all++;
      }
    }
  };
  count(a, b, true);
  count(b, a, false);
  return all === 0 ? 1 : shared / all;
}

// Whether `path` lies in an array that `shape` has empty.
function openIn(shape: ReadonlySet<string>, path: string): boolean {
  for (let i = path.indexOf('.*'); i >= 0; i = path.indexOf('.*', i + 2)) {
    if (shape.has(`${path.slice(0, i + 2)}${OPEN}`)) return true;
  }
  return false;
}

/**
 * Sorts values into groups of alike shape. Each value joins the group whose
 * first member it is most similar to, if at least SIMILARITY_THRESHOLD alike;
 * otherwise it starts a group of its own. Comparing with a group's first
 * member (not with all of them) keeps a group from drifting step by step
 * into something its first member no longer resembles.
 */
export function groupByShape(values: readonly unknown[]): { of: number[]; count: number } {
  const firsts: Set<string>[] = [];
  const of = values.map(value => {
    const shape = shapeOf(value);
    let best = -1;
    let bestScore = SIMILARITY_THRESHOLD;
    firsts.forEach((first, g) => {
      const score = similarity(shape, first);
      if (score >= bestScore && (best < 0 || score > bestScore)) {
        best = g;
        bestScore = score;
      }
    });
    if (best >= 0) return best;
    firsts.push(shape);
    return firsts.length - 1;
  });
  return { of, count: firsts.length };
}
