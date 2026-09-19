export type JsonType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

export function typeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as JsonType;
}

export function defaultForType(type: JsonType): unknown {
  switch (type) {
    case 'null':
      return null;
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'string':
      return '';
    case 'array':
      return [];
    case 'object':
      return {};
  }
}

// Recursively rebuilds a value's shape (object keys, array length) with
// every leaf reset to its type's default — used to give the user a
// ready-to-fill starting point that matches what a given column looks like
// elsewhere, without literally copying another row's data.
export function blankLike(value: unknown): unknown {
  const type = typeOf(value);
  if (type === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) out[k] = blankLike(src[k]);
    return out;
  }
  if (type === 'array') {
    return (value as unknown[]).map(blankLike);
  }
  return defaultForType(type);
}

export function withEntry(
  obj: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...obj, [key]: value };
}

export function withoutEntry(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const rest = { ...obj };
  delete rest[key];
  return rest;
}

export function withItem(arr: unknown[], index: number, value: unknown): unknown[] {
  const copy = arr.slice();
  copy[index] = value;
  return copy;
}

export function withoutItemAt(arr: unknown[], index: number): unknown[] {
  const copy = arr.slice();
  copy.splice(index, 1);
  return copy;
}

export function withAppended(arr: unknown[], value: unknown): unknown[] {
  return [...arr, value];
}
