import { SchemaModel } from './schema-model';
import type { JsonSchema } from './schema.types';

export type SchemaLoad = { model: SchemaModel } | { error: string };

/**
 * Turns schema text into a ready SchemaModel, or says why it cannot be
 * used. Compiles the validator up front, so a schema Ajv rejects is
 * reported here and never surfaces later while validating a document.
 */
export function loadSchema(text: string): SchemaLoad {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `Not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'A schema must be a JSON object.' };
  }
  const model = new SchemaModel(parsed as JsonSchema);
  try {
    model.validate(null);
  } catch (e) {
    return { error: `Unusable schema: ${e instanceof Error ? e.message : e}` };
  }
  return { model };
}
