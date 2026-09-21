import type { Discriminator, GhostKey, JsonSchema, JsonType, Path, Problem } from './schema.types';
import { createValidator } from './schema-validator';

const ALL_TYPES: JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array'];

/**
 * Read-only view of one JSON Schema for the editor: resolves references,
 * maps data paths to schema nodes, infers variant discriminators, lists
 * absent optional keys and validates. Pure TypeScript, no UI.
 *
 * Only local references (`#/...`) are resolved; anything else is reported
 * in `warnings` and treated as "anything goes".
 */
export class SchemaModel {
  readonly warnings: string[] = [];
  private readonly resolved = new WeakMap<JsonSchema, JsonSchema>();
  private validator?: (data: unknown) => Problem[];

  constructor(readonly root: JsonSchema) {}

  /** Follows `$ref` and folds `allOf` into one schema. Local keywords win over referenced ones. */
  resolve(schema: JsonSchema): JsonSchema {
    return this.resolveIn(schema, new Set());
  }

  /**
   * The schemas that can apply at `path`. With `data`, oneOf/anyOf are
   * narrowed to the matching variant wherever exactly one matches.
   */
  nodesAt(path: Path, data?: unknown): JsonSchema[] {
    let nodes: JsonSchema[] = [this.root];
    let value = data;
    for (const key of path) {
      const next = new Set<JsonSchema>();
      for (const node of nodes) {
        for (const child of this.childrenOf(this.narrow(node, value), key)) next.add(child);
      }
      nodes = [...next];
      value = childValue(value, key);
    }
    return nodes.map((n) => this.narrow(n, value));
  }

  /** Like `resolve`, but replaces oneOf/anyOf by the variant `data` matches, if exactly one does. */
  narrow(node: JsonSchema, data: unknown): JsonSchema {
    const s = this.resolve(node);
    const index = this.variantIndex(s, data);
    if (index === undefined) return s;
    const { oneOf, anyOf, ...base } = s;
    const variants = oneOf ?? anyOf ?? [];
    return this.narrow(merge(base, this.resolve(variants[index])), data);
  }

  /** Index of the single oneOf/anyOf variant that `data` fits, or undefined if none or several do. */
  variantIndex(node: JsonSchema, data: unknown): number | undefined {
    const variants = this.resolve(node);
    const alternatives = (variants.oneOf ?? variants.anyOf)?.map((v) => this.resolve(v));
    if (!alternatives || data === undefined) return undefined;
    // Strict pass first (required keys must be present); loose pass tolerates half-edited data.
    for (const strict of [true, false]) {
      const hits = alternatives.flatMap((v, i) => (fits(v, data, strict) ? [i] : []));
      if (hits.length === 1) return hits[0];
    }
    return undefined;
  }

  /**
   * The property that selects between the variants, when the schema has
   * one: a key that is a `const` (or, failing that, an `enum`) in every
   * variant with values that never overlap. Standard JSON Schema has no
   * discriminator keyword, so this is inferred.
   */
  discriminatorOf(node: JsonSchema): Discriminator | undefined {
    const s = this.resolve(node);
    const variants = (s.oneOf ?? s.anyOf)?.map((v) => this.resolve(v));
    if (!variants || variants.length < 2) return undefined;
    for (const constOnly of [true, false]) {
      for (const property of Object.keys(variants[0].properties ?? {})) {
        const values = variants.map((v) => this.selectorValues(v, property, constOnly));
        if (values.some((v) => !v)) continue;
        const flat = values.flat() as unknown[];
        if (new Set(flat.map((x) => JSON.stringify(x))).size === flat.length) {
          return { property, values: values as unknown[][] };
        }
      }
    }
    return undefined;
  }

  /** Declared properties of the object at `node` that `data` does not have. */
  ghostKeys(node: JsonSchema, data: Record<string, unknown>): GhostKey[] {
    const s = this.narrow(node, data);
    const required = new Set(s.required ?? []);
    return Object.entries(s.properties ?? {})
      .filter(([key]) => !(key in data))
      .map(([key, prop]) => {
        const schema = this.resolve(prop);
        const hasDefault = 'default' in schema;
        return { key, schema, required: required.has(key), hasDefault, default: schema.default };
      });
  }

  /** The JSON types the value at `node` may have, for restricting the type dropdown. */
  allowedTypes(node: JsonSchema): JsonType[] {
    const s = this.resolve(node);
    const found = new Set<JsonType>();
    const alternatives = s.oneOf ?? s.anyOf;
    if (alternatives) alternatives.forEach((a) => this.allowedTypes(a).forEach((t) => found.add(t)));
    for (const t of [s.type].flat()) if (t) found.add(t === 'integer' ? 'number' : (t as JsonType));
    for (const v of s.const !== undefined ? [s.const] : (s.enum ?? [])) found.add(jsonTypeOf(v));
    return found.size ? ALL_TYPES.filter((t) => found.has(t)) : [...ALL_TYPES];
  }

  /** Validates `data` against the schema. Never throws for bad data. */
  validate(data: unknown): Problem[] {
    this.validator ??= createValidator(this.root);
    return this.validator(data);
  }

  private resolveIn(schema: JsonSchema, seen: Set<string>): JsonSchema {
    const cached = this.resolved.get(schema);
    if (cached) return cached;
    let out = schema;
    if (typeof out.$ref === 'string') {
      const { $ref, ...siblings } = out;
      if (seen.has($ref)) {
        this.warn(`circular $ref ${$ref}`);
        out = siblings;
      } else {
        const target = this.lookup($ref);
        out = merge(this.resolveIn(target, new Set(seen).add($ref)), siblings);
      }
    }
    if (out.allOf) {
      const { allOf, ...rest } = out;
      out = merge({}, ...allOf.map((p) => this.resolveIn(p, seen)), rest);
    }
    this.resolved.set(schema, out);
    return out;
  }

  private lookup(ref: string): JsonSchema {
    const id = this.root.$id;
    const local = id && ref.startsWith(id) ? ref.slice(id.length) : ref;
    if (!local.startsWith('#')) {
      this.warn(`unsupported $ref ${ref}`);
      return {};
    }
    let node: unknown = this.root;
    for (const part of local.slice(1).split('/').filter(Boolean)) {
      const key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
      node = (node as Record<string, unknown> | undefined)?.[key];
    }
    if (typeof node !== 'object' || node === null) {
      this.warn(`unresolved $ref ${ref}`);
      return {};
    }
    return node as JsonSchema;
  }

  /** Schemas for `key` (a property name or array index) inside the object/array schema `s`. */
  private childrenOf(s: JsonSchema, key: string | number): JsonSchema[] {
    const out: JsonSchema[] = [];
    const own = this.ownChild(s, key);
    if (own) out.push(own);
    for (const alt of s.oneOf ?? s.anyOf ?? []) out.push(...this.childrenOf(this.resolve(alt), key));
    return out.map((c) => this.resolve(c));
  }

  private ownChild(s: JsonSchema, key: string | number): JsonSchema | undefined {
    if (typeof key === 'number') {
      const positional = s.prefixItems?.[key];
      if (positional) return positional;
      return typeof s.items === 'object' ? s.items : s.items === true ? {} : undefined;
    }
    const declared = s.properties?.[key];
    if (declared) return declared;
    const patterns = Object.entries(s.patternProperties ?? {}).filter(([p]) => safeRegExp(p)?.test(key));
    if (patterns.length) return merge({}, ...patterns.map(([, v]) => v));
    if (typeof s.additionalProperties === 'object') return s.additionalProperties;
    return undefined;
  }

  private selectorValues(variant: JsonSchema, property: string, constOnly: boolean): unknown[] | undefined {
    const p = variant.properties?.[property];
    if (!p) return undefined;
    const prop = this.resolve(p);
    if (prop.const !== undefined) return [prop.const];
    return !constOnly && prop.enum ? prop.enum : undefined;
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
}

/** Combines two resolved schemas as allOf would; `b` wins for scalar keywords. */
function merge(a: JsonSchema, ...rest: JsonSchema[]): JsonSchema {
  return rest.reduce<JsonSchema>((x, y) => mergeTwo(x, y), a);
}

function mergeTwo(a: JsonSchema, b: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...a, ...b };
  for (const key of ['properties', 'patternProperties'] as const) {
    if (!a[key] && !b[key]) continue;
    const merged: Record<string, JsonSchema> = { ...a[key] };
    for (const [name, schema] of Object.entries(b[key] ?? {})) {
      // Both sides constrain the same property: keep both, resolved later.
      merged[name] = name in merged ? { allOf: [merged[name], schema] } : schema;
    }
    out[key] = merged;
  }
  if (a.required || b.required) out.required = [...new Set([...(a.required ?? []), ...(b.required ?? [])])];
  // Two oneOf/anyOf lists cannot be folded together; keep b's (a's if b has none).
  return out;
}

/** Cheap structural check: does `data` look like `variant`? Never runs full validation. */
function fits(variant: JsonSchema, data: unknown, strict: boolean): boolean {
  if (variant.type !== undefined && ![variant.type].flat().some((t) => typeMatches(t, data))) return false;
  if (variant.const !== undefined && !deepEqual(variant.const, data)) return false;
  if (variant.enum && !variant.enum.some((v) => deepEqual(v, data))) return false;
  if (isObject(data)) {
    for (const [key, prop] of Object.entries(variant.properties ?? {})) {
      if (!(key in data)) continue;
      if (prop.const !== undefined && !deepEqual(prop.const, data[key])) return false;
      if (prop.enum && !prop.enum.some((v) => deepEqual(v, data[key]))) return false;
    }
    if (strict && (variant.required ?? []).some((k) => !(k in data))) return false;
  }
  return true;
}

function typeMatches(type: string, data: unknown): boolean {
  if (type === 'integer') return Number.isInteger(data);
  return type === jsonTypeOf(data);
}

export function jsonTypeOf(v: unknown): JsonType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v === 'object' ? 'object' : (typeof v as JsonType);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return jsonTypeOf(v) === 'object';
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function childValue(value: unknown, key: string | number): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string | number, unknown>)[key] : undefined;
}

function safeRegExp(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, 'u');
  } catch {
    return undefined;
  }
}
