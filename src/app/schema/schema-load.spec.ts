import { describe, expect, it } from 'vitest';
import { loadSchema } from './schema-load';

describe('loadSchema', () => {
  it('returns a model for a valid schema', () => {
    const r = loadSchema('{"type":"object"}');
    expect('model' in r && r.model.validate({})).toEqual([]);
  });

  it('rejects text that is not JSON', () => {
    expect(loadSchema('{nope')).toMatchObject({ error: expect.stringContaining('Not valid JSON') });
  });

  it('rejects JSON that is not an object', () => {
    expect(loadSchema('[]')).toEqual({ error: 'A schema must be a JSON object.' });
    expect(loadSchema('3')).toEqual({ error: 'A schema must be a JSON object.' });
    expect(loadSchema('null')).toEqual({ error: 'A schema must be a JSON object.' });
  });

  it('rejects a schema Ajv cannot compile', () => {
    expect(loadSchema('{"type":"nonsense"}')).toMatchObject({ error: expect.stringContaining('Unusable schema') });
    expect(loadSchema('{"$ref":"#/$defs/missing"}')).toMatchObject({ error: expect.stringContaining('Unusable schema') });
  });
});
