import { Injectable, computed, signal } from '@angular/core';
import { ProblemIndex, SchemaModel, loadSchema, parsePathKey, type GhostKey, type JsonSchema, type JsonType, type NodeMeta, type Primitive, type VariantInfo, type VariantSwitch } from '../../schema';

const NONE: readonly never[] = [];
const NO_SET: ReadonlySet<string> = new Set();

// The schema the current document is checked against, and the problems that
// result. Purely advisory: nothing here blocks or rewrites an edit — the
// document is validated on every change and the problems are just shown.
// With no schema loaded everything is empty, so the editor behaves exactly
// as it did before schemas existed.
@Injectable({ providedIn: 'root' })
export class SchemaService {
  private readonly _model = signal<SchemaModel | undefined>(undefined);
  private readonly _name = signal<string | undefined>(undefined);
  private readonly _origin = signal<string | undefined>(undefined);
  private readonly _error = signal<string | null>(null);
  private readonly data = signal<unknown>(undefined);

  readonly model = this._model.asReadonly();
  // Display name: the schema's title if it has one, else where it came from.
  readonly name = this._name.asReadonly();
  // Where the schema came from, in words: 'chosen file', 'IDE settings', a URL.
  readonly origin = this._origin.asReadonly();
  // Why the last attempt to load a schema failed, if it did.
  readonly error = this._error.asReadonly();

  readonly problems = computed(() => {
    const model = this._model();
    const data = this.data();
    return model && data !== undefined ? model.validate(data) : [];
  });

  readonly index = computed(() => new ProblemIndex(this.problems(), this.data()));

  // What the schema says about a node, looked up by its instance key (`uid`).
  // The table asks on every change-detection pass, so answers are memoised:
  // choices depend on the data (which variant applies), types only on the schema.
  private readonly choiceCache = computed(() => ({
    model: this._model(),
    data: this.data(),
    byKey: new Map<string, readonly Primitive[] | undefined>(),
    ghosts: new Map<string, readonly GhostKey[]>(),
    permits: new Map<string, boolean>(),
    meta: new Map<string, NodeMeta | undefined>(),
    required: new Map<string, ReadonlySet<string>>(),
    variantIndex: new Map<string, number | undefined>(),
    readOnly: new Map<string, boolean>(),
  }));
  private readonly typeCache = computed(() => ({
    model: this._model(),
    byKey: new Map<string, readonly JsonType[] | undefined>(),
    declared: new Map<string, readonly string[]>(),
    objectKeys: new Map<string, readonly string[]>(),
    variants: new Map<string, VariantInfo | undefined>(),
  }));

  /** The values the schema allows at this node, if it lists them all — what a dropdown offers. */
  choicesFor(key: string): readonly Primitive[] | undefined {
    const { model, data, byKey } = this.choiceCache();
    if (!model || data === undefined) return undefined;
    if (!byKey.has(key)) byKey.set(key, model.choicesAt(parsePathKey(key), data));
    return byKey.get(key);
  }

  /**
   * What the schema says about a node. With `narrow` (the default) the
   * current data picks the variant; without it every variant counts, which
   * is what a column shared by many rows needs.
   */
  metaFor(key: string, narrow = true): NodeMeta | undefined {
    const { model, data, meta } = this.choiceCache();
    if (!model || data === undefined) return undefined;
    const id = `${narrow ? 'n' : 'w'}:${key}`;
    if (!meta.has(id)) meta.set(id, model.metaAt(parsePathKey(key), narrow ? data : undefined));
    return meta.get(id);
  }

  /** Whether the schema makes this node, or one above it, read-only. */
  readOnlyFor(key: string): boolean {
    const { model, data, readOnly } = this.choiceCache();
    if (!model || data === undefined) return false;
    if (!readOnly.has(key)) readOnly.set(key, model.readOnlyAt(parsePathKey(key), data));
    return readOnly.get(key)!;
  }

  /** Declared keys the object at this node does not have yet. */
  ghostsFor(key: string): readonly GhostKey[] {
    const { model, data, ghosts } = this.choiceCache();
    if (!model || data === undefined) return NONE;
    if (!ghosts.has(key)) ghosts.set(key, model.ghostKeysAt(parsePathKey(key), data));
    return ghosts.get(key)!;
  }

  /** Whether `key` may be added to the object at `parentKey`; true when there is no schema to object. */
  permitsKey(parentKey: string, key: string): boolean {
    const { model, data, permits } = this.choiceCache();
    if (!model || data === undefined) return true;
    const id = `${parentKey}\u0000${key}`;
    if (!permits.has(id)) permits.set(id, model.permitsKey(parsePathKey(parentKey), data, key));
    return permits.get(id)!;
  }

  /** The keys the schema requires of the object at `key`, for the variant the data selects. */
  requiredFor(key: string): ReadonlySet<string> {
    const { model, data, required } = this.choiceCache();
    if (!model || data === undefined) return NO_SET;
    if (!required.has(key)) required.set(key, model.requiredAt(parsePathKey(key), data));
    return required.get(key)!;
  }

  /** The variants the object at `key` can be, when a discriminator tells them apart. */
  variantsFor(key: string): VariantInfo | undefined {
    const { model, variants } = this.typeCache();
    if (!model) return undefined;
    if (!variants.has(key)) variants.set(key, model.variantsAt(parsePathKey(key)));
    return variants.get(key);
  }

  /** Which of those variants the object currently is, if exactly one fits. */
  variantIndexFor(key: string): number | undefined {
    const { model, data, variantIndex } = this.choiceCache();
    if (!model || data === undefined) return undefined;
    if (!variantIndex.has(key)) variantIndex.set(key, model.variantIndexAt(parsePathKey(key), data));
    return variantIndex.get(key);
  }

  /** What choosing the variant with discriminator value `to` would do to the object at `key`. */
  switchVariantFor(key: string, to: unknown, drop = true): VariantSwitch | undefined {
    const model = this._model();
    const data = this.data();
    return model && data !== undefined ? model.switchVariant(parsePathKey(key), data, to, drop) : undefined;
  }

  /** Every non-deprecated key the schema declares for the object at `key`, in schema order. */
  declaredKeys(key: string): readonly string[] {
    const { model, objectKeys } = this.typeCache();
    if (!model) return NONE;
    if (!objectKeys.has(key)) objectKeys.set(key, model.declaredKeysAt(parsePathKey(key)));
    return objectKeys.get(key)!;
  }

  /** Every key the item schema of the array at `arrayKey` declares. Empty when the schema says nothing. */
  declaredItemKeys(arrayKey: string): readonly string[] {
    const { model, declared } = this.typeCache();
    if (!model) return NONE;
    if (!declared.has(arrayKey)) declared.set(arrayKey, model.declaredKeysAt([...parsePathKey(arrayKey), 0]));
    return declared.get(arrayKey)!;
  }

  /** A schema-shaped starting value for `schema`. */
  seed(schema: JsonSchema): unknown {
    return this._model()?.seed(schema);
  }

  /**
   * A schema-shaped starting value for a new `key` in the object at
   * `parentKey`, or undefined when the schema has nothing to say about it.
   */
  seedFor(parentKey: string, key: string): unknown {
    const model = this._model();
    const data = this.data();
    if (!model || data === undefined) return undefined;
    const node = model.nodesAt([...parsePathKey(parentKey), key], data)[0];
    return node ? model.seed(node) : undefined;
  }

  /** The JSON types the schema allows at this node, or undefined when it says nothing. */
  typesFor(key: string): readonly JsonType[] | undefined {
    const { model, byKey } = this.typeCache();
    if (!model) return undefined;
    if (!byKey.has(key)) byKey.set(key, model.typesAt(parsePathKey(key)));
    return byKey.get(key);
  }

  // Called by `App` whenever the document changes.
  setData(data: unknown): void {
    this.data.set(data);
  }

  load(text: string, source: string, origin?: string): boolean {
    const result = loadSchema(text);
    if ('error' in result) {
      this._error.set(result.error);
      return false;
    }
    const title = result.model.root.title;
    this._model.set(result.model);
    this._name.set(typeof title === 'string' && title ? title : source);
    this._origin.set(origin);
    this._error.set(null);
    return true;
  }

  // A failure to obtain a schema (a download that did not work, a missing file).
  fail(message: string): void {
    this._error.set(message);
  }

  clear(): void {
    this._model.set(undefined);
    this._name.set(undefined);
    this._origin.set(undefined);
    this._error.set(null);
  }
}
