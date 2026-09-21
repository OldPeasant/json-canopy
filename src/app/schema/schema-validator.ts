import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { JsonSchema, Path, Problem } from './schema.types';

export interface Validator {
  /** Validates a whole document against the schema. */
  check(data: unknown): Problem[];
  /**
   * Validates `value` against one sub-schema of it, with the schema's
   * definitions in reach; paths are relative to `value`. Undefined if the
   * sub-schema cannot be compiled on its own (for example because it points
   * into the middle of the root with a `#/properties/...` reference).
   */
  checkAgainst(sub: JsonSchema, value: unknown): Problem[] | undefined;
}

/**
 * Compiles `schema` with Ajv and returns validators that report problems as
 * document paths. Draft-07 schemas use Ajv's default draft; everything else
 * is treated as 2020-12. Unmodelled keywords are still enforced here.
 */
export function createValidator(schema: JsonSchema): Validator {
  const draft07 = typeof schema.$schema === 'string' && schema.$schema.includes('draft-07');
  const ajv = new (draft07 ? Ajv : Ajv2020)({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const subs = new WeakMap<JsonSchema, ValidateFunction | null>();
  return {
    check: (data) => (validate(data) ? [] : (validate.errors ?? []).map((e) => toProblem(e, data))),
    checkAgainst(sub, value) {
      let fn = subs.get(sub);
      if (fn === undefined) {
        try {
          const { $id, $schema, ...rest } = sub;
          fn = ajv.compile({ ...rest, $defs: schema.$defs, definitions: schema['definitions'] });
        } catch {
          fn = null;
        }
        subs.set(sub, fn);
      }
      if (!fn) return undefined;
      return fn(value) ? [] : (fn.errors ?? []).map((e) => toProblem(e, value));
    },
  };
}

function toProblem(e: ErrorObject, data: unknown): Problem {
  const path = pointerToPath(e.instancePath, data);
  const params = e.params as Record<string, unknown>;
  // Keywords that complain about a key report the object; point at the key.
  const key = params['missingProperty'] ?? params['additionalProperty'] ?? params['unevaluatedProperty'] ?? params['propertyName'];
  return {
    path: typeof key === 'string' ? [...path, key] : path,
    keyword: e.keyword,
    message: e.message ?? 'invalid',
    schemaPath: e.schemaPath,
  };
}

/** `/members/0/role` → `['members', 0, 'role']`; segments under an array become numbers. */
function pointerToPath(pointer: string, data: unknown): Path {
  const path: Array<string | number> = [];
  let value = data;
  for (const raw of pointer.split('/').slice(1)) {
    const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    path.push(Array.isArray(value) ? Number(seg) : seg);
    value = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[seg] : undefined;
  }
  return path;
}
