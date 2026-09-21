/** A path into a JSON document: object keys and array indices. */
export type Path = ReadonlyArray<string | number>;

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
