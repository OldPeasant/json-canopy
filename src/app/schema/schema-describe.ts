import type { JsonSchema } from './schema.types';

const MAX_LISTED = 12;

/** The types a resolved schema allows, as one line: `integer`, `null | object`, or '' when it does not say. */
export function typeLabel(s: JsonSchema, resolve: (n: JsonSchema) => JsonSchema = (n) => n, depth = 0): string {
  const own = [s.type].flat().filter((t): t is string => typeof t === 'string');
  if (own.length) return own.join(' | ');
  const alternatives = s.oneOf ?? s.anyOf;
  if (alternatives && depth < 4) {
    const labels = alternatives.map((a) => typeLabel(resolve(a), resolve, depth + 1)).filter(Boolean);
    return [...new Set(labels.flatMap((l) => l.split(' | ')))].join(' | ');
  }
  return '';
}

/** Constraints of a resolved schema in plain words. Says nothing about what the UI already shows (type, default). */
export function describeConstraints(s: JsonSchema): string[] {
  const out: string[] = [];
  if (s.const !== undefined) out.push(`must be ${JSON.stringify(s.const)}`);
  else if (s.enum) out.push(`one of: ${listed(s.enum)}`);

  if (s.minimum !== undefined) out.push(`≥ ${s.minimum}`);
  if (s.exclusiveMinimum !== undefined) out.push(`> ${s.exclusiveMinimum}`);
  if (s.maximum !== undefined) out.push(`≤ ${s.maximum}`);
  if (s.exclusiveMaximum !== undefined) out.push(`< ${s.exclusiveMaximum}`);
  if (s.multipleOf !== undefined) out.push(`multiple of ${s.multipleOf}`);

  if (s.minLength !== undefined) out.push(`length ≥ ${s.minLength}`);
  if (s.maxLength !== undefined) out.push(`length ≤ ${s.maxLength}`);
  if (s.format !== undefined) out.push(`format: ${s.format}`);
  if (s.pattern !== undefined) out.push(`pattern: ${s.pattern}`);

  if (s.minItems !== undefined) out.push(`items ≥ ${s.minItems}`);
  if (s.maxItems !== undefined) out.push(`items ≤ ${s.maxItems}`);
  if (s.uniqueItems) out.push('unique items');

  if (s.required?.length) out.push(`required: ${s.required.join(', ')}`);
  if (s.minProperties !== undefined) out.push(`keys ≥ ${s.minProperties}`);
  if (s.maxProperties !== undefined) out.push(`keys ≤ ${s.maxProperties}`);
  if (s.additionalProperties === false || s['unevaluatedProperties'] === false) out.push('no other keys');
  return out;
}

function listed(values: unknown[]): string {
  const shown = values.slice(0, MAX_LISTED).map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  return shown.join(', ') + (values.length > MAX_LISTED ? `, … (${values.length} in all)` : '');
}
