import type { Discriminator, GhostKey, JsonSchema, JsonType, NodeMeta, Path, Primitive, Problem, VariantInfo, VariantSwitch } from './schema.types';
import { describeConstraints, typeLabel } from './schema-describe';
import { createValidator, type Validator } from './schema-validator';

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
  private validator?: Validator;

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

  /**
   * What the schema says about the node at `path`, for tooltips and styling,
   * or undefined if it says nothing about that path. `readOnly` is inherited
   * from ancestors; everything else comes from the node itself.
   */
  metaAt(path: Path, data?: unknown): NodeMeta | undefined {
    const nodes = this.nodesAt(path, data);
    if (!nodes.length) return undefined;
    const first = <T>(pick: (n: JsonSchema) => T | undefined): T | undefined => nodes.map(pick).find((v) => v !== undefined);
    const hasDefault = nodes.some((n) => 'default' in n);
    return {
      type: first((n) => typeLabel(n, (x) => this.resolve(x)) || undefined) ?? '',
      title: first((n) => n.title),
      description: first((n) => n.description),
      examples: first((n) => n.examples),
      hasDefault,
      default: first((n) => n.default),
      deprecated: nodes.some((n) => n.deprecated === true),
      readOnly: this.readOnlyAt(path, data),
      writeOnly: nodes.some((n) => n.writeOnly === true),
      constraints: nodes.length === 1 ? describeConstraints(nodes[0]) : [],
    };
  }

  /** Whether the node at `path`, or any node above it, is `readOnly`. */
  readOnlyAt(path: Path, data?: unknown): boolean {
    for (let depth = 0; depth <= path.length; depth++) {
      if (this.nodesAt(path.slice(0, depth), data).some((n) => n.readOnly === true)) return true;
    }
    return false;
  }

  /** The variants the object at `path` can be, told apart by a discriminator, or undefined when it has none. */
  variantsAt(path: Path): VariantInfo | undefined {
    const node = this.nodesAt(path).find((n) => this.discriminatorOf(n));
    const discriminator = node && this.discriminatorOf(node);
    if (!node || !discriminator) return undefined;
    const alternatives = (node.oneOf ?? node.anyOf ?? []).map((a) => this.resolve(a));
    return {
      property: discriminator.property,
      variants: alternatives.map((a, i) => ({ label: a.title ?? String(discriminator.values[i][0]), values: discriminator.values[i] })),
    };
  }

  /** Which variant the object at `path` currently is, if exactly one fits. */
  variantIndexAt(path: Path, data: unknown): number | undefined {
    const node = this.nodesAt(path).find((n) => this.discriminatorOf(n));
    return node ? this.variantIndex(node, valueAt(data, path)) : undefined;
  }

  /**
   * Reshapes the object at `path` for the variant whose discriminator value
   * is `to`: sets the discriminator, adds the required keys the object lacks,
   * resets kept keys whose values no longer fit, and — with `drop` — removes
   * keys the variant does not allow. Undefined if `to` names no variant.
   */
  switchVariant(path: Path, data: unknown, to: unknown, drop = true): VariantSwitch | undefined {
    const info = this.variantsAt(path);
    const object = valueAt(data, path);
    if (!info || !isObject(object)) return undefined;
    const node = this.nodesAt(path).find((n) => this.discriminatorOf(n))!;
    const chosen = this.variantIndex(node, { [info.property]: to });
    if (chosen === undefined) return undefined;
    const { oneOf, anyOf, ...base } = node;
    const target = this.narrow(merge(base, this.resolve((oneOf ?? anyOf ?? [])[chosen])), undefined);

    const value: Record<string, unknown> = {};
    const dropped: string[] = [];
    const reset: string[] = [];
    for (const [key, current] of Object.entries(object)) {
      if (key === info.property) {
        value[key] = to;
      } else if (drop && !this.permits(target, key)) {
        dropped.push(key);
      } else {
        const declared = target.properties?.[key];
        const allowed = declared && this.enumerated(declared);
        const fits = !allowed || allowed.some((a) => deepEqual(a, current));
        value[key] = fits ? current : this.seed(declared!);
        if (!fits) reset.push(key);
      }
    }
    value[info.property] = to;
    const added: string[] = [];
    for (const key of target.required ?? []) {
      const declared = target.properties?.[key];
      if (!(key in value) && declared) {
        value[key] = this.seed(declared);
        added.push(key);
      }
    }
    return { value, dropped, reset, added };
  }

  /** Like `ghostKeys`, for the object at `path` in `data`; leaves out deprecated keys, which are not worth offering. */
  ghostKeysAt(path: Path, data: unknown): GhostKey[] {
    const value = valueAt(data, path);
    if (!isObject(value)) return [];
    const seen = new Set<string>();
    return this.nodesAt(path, data)
      .flatMap((node) => this.ghostKeys(node, value))
      .filter((g) => !g.schema.deprecated && !seen.has(g.key) && seen.add(g.key));
  }

  /**
   * Every non-deprecated property name declared for the objects allowed at
   * `path`, in schema order, across all variants. What a table of records
   * can offer as a column even when no row has a value there yet.
   */
  declaredKeysAt(path: Path): string[] {
    const keys = new Set<string>();
    const collect = (node: JsonSchema, depth: number): void => {
      const s = this.resolve(node);
      for (const [key, prop] of Object.entries(s.properties ?? {})) {
        if (!this.resolve(prop).deprecated) keys.add(key);
      }
      if (depth < 8) for (const alt of s.oneOf ?? s.anyOf ?? []) collect(alt, depth + 1);
    };
    this.nodesAt(path).forEach((n) => collect(n, 0));
    return [...keys];
  }

  /** The keys the schema requires of the object at `path`, given which variant `data` selects. */
  requiredAt(path: Path, data?: unknown): Set<string> {
    return new Set(this.nodesAt(path, data).flatMap((n) => n.required ?? []));
  }

  /**
   * Whether `key` may be added to the object at `path`: it is declared or
   * matches a pattern, or the object is open. False only where the schema
   * closes the object (`additionalProperties`/`unevaluatedProperties: false`)
   * and the key is not one it declares. Where the schema says nothing, true.
   */
  permitsKey(path: Path, data: unknown, key: string): boolean {
    const nodes = this.nodesAt(path, data);
    return !nodes.length || nodes.some((n) => this.permits(n, key));
  }

  /**
   * A starting value for a new key or item shaped by `node`: its default,
   * else its const or first enumerated value, else the empty value of its
   * type. Objects get their required keys, seeded the same way, so the
   * result is as close to valid as the schema allows without asking the user.
   */
  seed(node: JsonSchema, depth = 0): unknown {
    const s = this.resolve(node);
    if (s.default !== undefined) return structuredClone(s.default);
    if (s.const !== undefined) return structuredClone(s.const);
    const listed = this.enumerated(s);
    if (listed?.length) return structuredClone(listed[0]);
    const alternatives = (s.oneOf ?? s.anyOf)?.map((a) => this.resolve(a));
    if (alternatives?.length) {
      const { oneOf, anyOf, ...base } = s;
      // Prefer a real value over null when the schema allows either.
      const pick = alternatives.find((a) => a.type !== 'null' && a.const !== null) ?? alternatives[0];
      return this.seed(merge(base, pick), depth);
    }
    const types = [s.type].flat().filter((t): t is string => typeof t === 'string');
    const type = types.find((t) => t !== 'null') ?? types[0] ?? (s.properties ? 'object' : s.items ? 'array' : undefined);
    switch (type) {
      case 'number':
      case 'integer':
        return typeof s.minimum === 'number' ? s.minimum : 0;
      case 'boolean':
        return false;
      case 'null':
        return null;
      case 'array':
        return [];
      case 'object': {
        const out: Record<string, unknown> = {};
        if (depth < 4) {
          for (const key of s.required ?? []) {
            if (s.properties?.[key]) out[key] = this.seed(s.properties[key], depth + 1);
          }
        }
        return out;
      }
      default:
        return '';
    }
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

  /**
   * The values a scalar at `path` may take, when the schema lists them all
   * (enum, const, or alternatives of those) — what a dropdown offers. The
   * property that selects a variant is the exception: it offers the values
   * of every variant, since choosing one is how you switch variants.
   */
  choicesAt(path: Path, data?: unknown): Primitive[] | undefined {
    let nodes = this.nodesAt(path, data);
    const key = path[path.length - 1];
    if (typeof key === 'string' && this.nodesAt(path.slice(0, -1)).some((p) => this.discriminatorOf(p)?.property === key)) {
      nodes = this.nodesAt(path);
    }
    if (!nodes.length) return undefined;
    const lists = nodes.map((n) => this.enumerated(n));
    if (lists.some((l) => !l)) return undefined;
    const seen = new Set<string>();
    const values = (lists as unknown[][]).flat().filter((v) => !seen.has(JSON.stringify(v)) && seen.add(JSON.stringify(v)));
    return values.every(isPrimitive) ? values : undefined;
  }

  /**
   * The JSON types the value at `path` may have, or undefined when the
   * schema says nothing about the path. Deliberately ignores the current
   * value: a `null | object` field holding null must still offer object.
   */
  typesAt(path: Path): JsonType[] | undefined {
    const nodes = this.nodesAt(path);
    if (!nodes.length) return undefined;
    const types = new Set(nodes.flatMap((n) => this.allowedTypes(n)));
    return ALL_TYPES.filter((t) => types.has(t));
  }

  /** Validates `data` against the schema. Never throws for bad data. */
  validate(data: unknown): Problem[] {
    this.validator ??= createValidator(this.root);
    return this.refineAlternatives(this.validator.check(data), data, 0);
  }

  /**
   * Ajv reports a failed oneOf/anyOf as one summary plus the errors of every
   * variant, which reads as noise. Where the value looks like one variant,
   * report only that variant's errors; where it looks like none, report the
   * closest variant's and say so.
   */
  private refineAlternatives(problems: Problem[], data: unknown, depth: number): Problem[] {
    const validator = this.validator;
    if (!validator || depth > 4) return problems;
    const summaries = problems.filter((p) => p.keyword === 'oneOf' || p.keyword === 'anyOf').sort((a, b) => a.path.length - b.path.length);
    for (const summary of summaries) {
      const replacement = this.closestVariantProblems(summary, validator, data);
      if (!replacement) continue;
      const kept = problems.filter((p) => !startsWith(p.path, summary.path));
      return this.refineAlternatives([...kept, ...replacement], data, depth + 1);
    }
    return problems;
  }

  private closestVariantProblems(summary: Problem, validator: Validator, data: unknown): Problem[] | undefined {
    const node = this.nodesAt(summary.path).find((n) => n.oneOf ?? n.anyOf);
    if (!node) return undefined;
    const { oneOf, anyOf, ...base } = node;
    const alternatives = (oneOf ?? anyOf ?? []).map((a) => this.resolve(a));
    const value = valueAt(data, summary.path);
    const under = (relative: Problem[] | undefined) => relative?.map((p) => ({ ...p, path: [...summary.path, ...p.path] }));

    const baseErrors = under(validator.checkAgainst(base, value));
    if (!baseErrors) return undefined;
    const chosen = this.variantIndex(node, value);
    const errors = alternatives.map((a) => under(validator.checkAgainst(a, value)));
    if (errors.some((e) => !e)) return undefined;
    const results = errors as Problem[][];
    const labels = alternatives.map((a, i) => a.title ?? (typeLabel(a, (x) => this.resolve(x)) || `option ${i + 1}`));

    let replacement: Problem[];
    if (chosen !== undefined) {
      replacement = [...baseErrors, ...results[chosen]];
    } else if (results.filter((r) => !r.length).length > 1) {
      replacement = [...baseErrors, { ...summary, message: `fits more than one option (${labels.join(', ')}); it must fit exactly one` }];
    } else {
      const closest = results.reduce((best, r, i) => (r.length < results[best].length ? i : best), 0);
      replacement = [...baseErrors, { ...summary, message: `fits none of the options (${labels.join(', ')}); closest is ${labels[closest]}` }, ...results[closest]];
    }
    // Never turn a failure into silence.
    return replacement.length ? replacement : undefined;
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

  private permits(node: JsonSchema, key: string): boolean {
    const s = this.resolve(node);
    if (this.ownChild(s, key)) return true;
    const alternatives = s.oneOf ?? s.anyOf;
    if (alternatives?.some((a) => this.permits(a, key))) return true;
    return s.additionalProperties !== false && s['unevaluatedProperties'] !== false;
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

  /** The complete list of values a node allows, if it gives one. */
  private enumerated(node: JsonSchema): unknown[] | undefined {
    const s = this.resolve(node);
    if (s.const !== undefined) return [s.const];
    if (s.enum) return s.enum;
    const alternatives = s.oneOf ?? s.anyOf;
    if (!alternatives) return undefined;
    const lists = alternatives.map((a) => this.enumerated(a));
    return lists.every((l) => l) ? (lists as unknown[][]).flat() : undefined;
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

function isPrimitive(v: unknown): v is Primitive {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return jsonTypeOf(v) === 'object';
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function startsWith(path: Path, prefix: Path): boolean {
  return prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg);
}

function valueAt(data: unknown, path: Path): unknown {
  return path.reduce<unknown>((value, key) => childValue(value, key), data);
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
