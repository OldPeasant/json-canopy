export type Layout = 'tables' | 'form';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Which layout suits a document when the user has not chosen. Tables are
 * for lists of records; forms are for everything else, which is mostly
 * configuration. Without a schema there is nothing to build a form from, so
 * it stays tables, as it always was.
 *
 * "A list of records" means the document is one, or its own properties hold
 * one (two or more objects in an array). Lists nested deeper do not count:
 * the form shows those as tables inside itself.
 */
export function defaultLayout(data: unknown, hasSchema: boolean): Layout {
  if (!hasSchema) return 'tables';
  if (Array.isArray(data)) return 'tables';
  if (!isObject(data)) return 'tables';
  const listsRecords = Object.values(data).some((v) => Array.isArray(v) && v.filter(isObject).length >= 2);
  return listsRecords ? 'tables' : 'form';
}
