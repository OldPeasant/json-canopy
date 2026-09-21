import type { Path, Problem } from './schema.types';

/**
 * The key the table components already use for a node's instance path
 * (`uid`): `.key` for object keys, `[n]` for array indices, '' for the root.
 * Keys containing `.` or `[` can collide with a deeper path; the worst
 * case is a marker on the wrong node, never a lost problem.
 */
export function pathKey(path: Path): string {
  return path.map((seg) => (typeof seg === 'number' ? `[${seg}]` : `.${seg}`)).join('');
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

  constructor(problems: readonly Problem[], data: unknown) {
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
