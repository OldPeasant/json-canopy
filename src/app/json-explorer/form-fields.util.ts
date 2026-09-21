import type { GhostKey } from '../schema';

export interface FormField {
  key: string;
  required: boolean;
  /** Present when the data lacks this key: the declared-but-absent "ghost" it stands for. */
  ghost?: GhostKey;
}

/**
 * The fields of an object in the form: the keys the schema declares, in
 * schema order (present ones as they are, absent ones as ghosts), then the
 * keys only the data has, in data order. Without a schema, just the data's.
 * A declared key that is absent but not offered (deprecated, or belonging to
 * another variant) is left out.
 */
export function formFields(
  value: Record<string, unknown>,
  declared: readonly string[],
  ghosts: readonly GhostKey[],
  required: ReadonlySet<string>,
): FormField[] {
  const ghostByKey = new Map(ghosts.map((g) => [g.key, g]));
  const fields: FormField[] = [];
  const placed = new Set<string>();
  for (const key of declared) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      fields.push({ key, required: required.has(key) });
    } else if (ghostByKey.has(key)) {
      fields.push({ key, required: ghostByKey.get(key)!.required, ghost: ghostByKey.get(key) });
    } else {
      continue;
    }
    placed.add(key);
  }
  for (const key of Object.keys(value)) {
    if (!placed.has(key)) fields.push({ key, required: required.has(key) });
  }
  return fields;
}
