import { appendKey, type Path } from '../schema';

// What must be true of each container on the way to a node for that node to
// be on screen. Pure and Angular-free: it mirrors how `app-json-table`
// builds its instance keys (`uid`), structural paths (`*` for "any array
// row") and column keys, so the jump service can undo whatever hides a node.

/** How a container lays out its children, which decides how pagination counts them. */
export type ContainerKind = 'object' | 'records' | 'items';

export interface RevealStep {
  /** The container this step passes through: instance key and structural path. */
  uid: string;
  path: string;
  kind: ContainerKind;
  container: unknown;
  /** The column key the column menu may have hidden, when the child is one. */
  colKey?: string;
  /** Position of the child among the container's children — how far pagination must reveal. */
  position: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The containers between the document root and the node at `path`, with
 * what each must do to show its child. The node itself is not a step:
 * only what is above it has to open.
 */
export function revealSteps(data: unknown, path: Path): RevealStep[] {
  const steps: RevealStep[] = [];
  let value = data;
  let uid = '';
  let sp = '';
  for (let i = 0; i < path.length; ) {
    const seg = path[i];
    if (Array.isArray(value)) {
      const index = Number(seg);
      const item = value[index];
      const records = value.some(isObject);
      const kind: ContainerKind = records ? 'records' : 'items';
      const key = path[i + 1];
      if (records && isObject(item) && typeof key === 'string') {
        // A cell of a table of records: the row itself is not a node, so
        // row and column are one step.
        steps.push({ uid, path: sp, kind, container: value, colKey: `${sp}:${key}`, position: index });
        uid = appendKey(appendKey(uid, index), key);
        sp = sp ? `${sp}.*.${key}` : `*.${key}`;
        value = item[key];
        i += 2;
      } else if (records && isObject(item)) {
        // The row itself (a problem about a missing key): show the row and stop.
        steps.push({ uid, path: sp, kind, container: value, position: index });
        break;
      } else {
        steps.push({ uid, path: sp, kind, container: value, position: index });
        uid = appendKey(uid, index);
        sp = sp ? `${sp}.*` : '*';
        value = item;
        i++;
      }
    } else if (isObject(value)) {
      const key = String(seg);
      steps.push({ uid, path: sp, kind: 'object', container: value, colKey: `${sp}:${key}`, position: Object.keys(value).indexOf(key) });
      uid = appendKey(uid, key);
      sp = sp ? `${sp}.${key}` : key;
      value = value[key];
      i++;
    } else {
      break;
    }
  }
  return steps;
}
