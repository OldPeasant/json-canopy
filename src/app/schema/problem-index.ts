import type { Path, Problem } from './schema.types';

/**
 * The key the table components use for a node's instance path (`uid`):
 * `.key` for object keys, `[n]` for array indices, '' for the root. In a
 * key, `\\`, `.` and `[` are backslash-escaped, so every path has exactly
 * one key and `parsePathKey` gets it back.
 */
export function appendKey(parent: string, segment: string | number): string {
  return parent + (typeof segment === 'number' ? `[${segment}]` : `.${segment.replace(/[\\.[]/g, '\\$&')}`);
}

export function pathKey(path: Path): string {
  let key = '';
  for (const segment of path) key = appendKey(key, segment);
  return key;
}

export function parsePathKey(key: string): Path {
  const path: Array<string | number> = [];
  let i = 0;
  while (i < key.length) {
    if (key[i] === '[') {
      const end = key.indexOf(']', i);
      if (end < 0) break;
      path.push(Number(key.slice(i + 1, end)));
      i = end + 1;
    } else if (key[i] === '.') {
      let segment = '';
      for (i++; i < key.length && key[i] !== '.' && key[i] !== '['; i++) {
        if (key[i] === '\\' && i + 1 < key.length) i++;
        segment += key[i];
      }
      path.push(segment);
    } else {
      i++;
    }
  }
  return path;
}

/** A path as a person would write it: `members[0].contact.email`; the document itself is `(document)`. */
export function formatPath(path: Path): string {
  if (!path.length) return '(document)';
  return path.map((seg) => (typeof seg === 'number' ? `[${seg}]` : `.${seg}`)).join('').replace(/^\./, '');
}

/**
 * Problems grouped by the node that can show them. A problem about
 * something the data lacks (a missing required key) is anchored at the
 * deepest node that does exist, because there is nothing at its own path
 * to draw on.
 */
export class ProblemIndex {
  private readonly direct = new Map<string, Problem[]>();
  private readonly below = new Map<string, number>();

  constructor(problems: readonly Problem[], private readonly data: unknown) {
    for (const problem of problems) {
      const anchor = deepestExisting(problem.path, data);
      const key = pathKey(anchor);
      const list = this.direct.get(key);
      if (list) list.push(problem);
      else this.direct.set(key, [problem]);
      for (let depth = 0; depth < anchor.length; depth++) {
        const ancestor = pathKey(anchor.slice(0, depth));
        this.below.set(ancestor, (this.below.get(ancestor) ?? 0) + 1);
      }
    }
  }

  /** The node a problem is shown on: its own path, or the deepest one the data has. */
  anchorOf(problem: Problem): Path {
    return deepestExisting(problem.path, this.data);
  }

  /** Problems that belong to the node itself. */
  at(key: string): readonly Problem[] {
    return this.direct.get(key) ?? NONE;
  }

  /** How many problems belong to nodes strictly below this one. */
  countBelow(key: string): number {
    return this.below.get(key) ?? 0;
  }
}

const NONE: readonly Problem[] = [];

function deepestExisting(path: Path, data: unknown): Path {
  let value = data;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    const has =
      Array.isArray(value)
        ? typeof seg === 'number' && seg >= 0 && seg < value.length
        : typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, seg);
    if (!has) return path.slice(0, i);
    value = (value as Record<string | number, unknown>)[seg];
  }
  return path;
}
