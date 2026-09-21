import { appendKey, type Path, type ProblemIndex } from '../../schema';

export interface OutlineRow {
  key: string;
  path: Path;
  label: string;
  depth: number;
  kind: 'object' | 'array' | 'scalar' | 'more';
  /** Number of children (object keys, array items); for a "more" row, how many were left out. */
  size: number;
  /** Problems at or below this node. */
  problems: number;
}

const MAX_DEPTH = 2;
const MAX_PER_LEVEL = 40;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The document's structure as a flat list for navigation: every object and
 * array down to a few levels, plus any scalar that has a problem (so an
 * error is always findable). A level is cut off after a while, with a row
 * saying how many were left out — a map of thousands of keys is not a list
 * anyone navigates.
 */
export function outlineRows(data: unknown, index: ProblemIndex): OutlineRow[] {
  const rows: OutlineRow[] = [];
  if (isObject(data)) walk(data, [], '', 0, index, rows);
  return rows;
}

function walk(obj: Record<string, unknown>, path: Path, uid: string, depth: number, index: ProblemIndex, rows: OutlineRow[]): void {
  let shown = 0;
  let left = 0;
  for (const [name, child] of Object.entries(obj)) {
    const childPath = [...path, name];
    const key = appendKey(uid, name);
    const problems = index.at(key).length + index.countBelow(key);
    const isContainer = typeof child === 'object' && child !== null;
    if (!isContainer && !problems) continue;
    if (shown >= MAX_PER_LEVEL) {
      left++;
      continue;
    }
    shown++;
    rows.push({
      key,
      path: childPath,
      label: name,
      depth,
      kind: isObject(child) ? 'object' : Array.isArray(child) ? 'array' : 'scalar',
      size: isContainer ? Object.keys(child as object).length : 0,
      problems,
    });
    if (isObject(child) && depth < MAX_DEPTH) walk(child, childPath, key, depth + 1, index, rows);
  }
  if (left) rows.push({ key: `${uid}\u0000more`, path, label: `… ${left} more`, depth, kind: 'more', size: left, problems: 0 });
}
