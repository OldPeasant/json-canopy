/** A path into a JSON document: object keys and array indices. */
export type Path = ReadonlyArray<string | number>;

/** A JSON value that is not an object or array. */
export type Primitive = string | number | boolean | null;

/** The six JSON value types as the editor's type dropdown knows them. */
export type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

/** The keywords the UI models (see docs/schema-plan.md), plus an open index for the rest. */
export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  patternProperties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  propertyNames?: JsonSchema;
  required?: string[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  items?: boolean | JsonSchema;
  prefixItems?: JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  title?: string;
  description?: string;
  examples?: unknown[];
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  [keyword: string]: unknown;
}

/** A validation error, normalised from Ajv so the UI can place it on a node. */
export interface Problem {
  /** The node the problem belongs to (for a missing key: the absent key's path). */
  path: Path;
  keyword: string;
  message: string;
  /** Where in the schema the failing keyword lives. */
  schemaPath: string;
}

/** A declared property that is absent from the data: a "ghost" row or column. */
export interface GhostKey {
  key: string;
  /** The property's schema, resolved. */
  schema: JsonSchema;
  required: boolean;
  hasDefault: boolean;
  default?: unknown;
}

/** A property whose value selects the variant of a oneOf/anyOf. */
export interface Discriminator {
  property: string;
  /** Per variant (same order as the alternatives), the values that select it. */
  values: unknown[][];
}

/** What the schema says about one node, in a form the UI can show. */
export interface NodeMeta {
  /** The types the node may have, as one line: `integer`, `null | object`. Empty when unconstrained. */
  type: string;
  title?: string;
  description?: string;
  examples?: unknown[];
  hasDefault: boolean;
  default?: unknown;
  deprecated: boolean;
  /** Inherited: true when the node or any ancestor is read-only. */
  readOnly: boolean;
  writeOnly: boolean;
  /** Plain-words constraints: `≥ 1`, `one of: a, b`, `required: id, name`. */
  constraints: string[];
}

/** The variants of a oneOf/anyOf that a discriminator property tells apart. */
export interface VariantInfo {
  property: string;
  variants: Array<{ label: string; values: unknown[] }>;
}

/** What choosing another variant does to an object. */
export interface VariantSwitch {
  /** The reshaped object. */
  value: Record<string, unknown>;
  /** Keys the new variant does not allow; absent from `value` when the switch drops them. */
  dropped: string[];
  /** Keys kept but given a fresh value because the old one does not fit the new variant. */
  reset: string[];
  /** Required keys of the new variant that the object lacked. */
  added: string[];
}
