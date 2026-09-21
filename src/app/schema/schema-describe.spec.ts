import { describe, expect, it } from 'vitest';
import { describeConstraints, typeLabel } from './schema-describe';

describe('describeConstraints', () => {
  it('says nothing for a bare type', () => {
    expect(describeConstraints({ type: 'string' })).toEqual([]);
  });

  it('describes enums and consts, truncating long lists', () => {
    expect(describeConstraints({ enum: ['a', 'b', 3] })).toEqual(['one of: a, b, 3']);
    expect(describeConstraints({ const: 'x' })).toEqual(['must be "x"']);
    const long = describeConstraints({ enum: Array.from({ length: 20 }, (_, i) => `v${i}`) })[0];
    expect(long).toContain('v11');
    expect(long).not.toContain('v12');
    expect(long).toContain('20 in all');
  });

  it('describes numbers, strings, arrays and objects', () => {
    expect(describeConstraints({ minimum: 1, maximum: 65535 })).toEqual(['≥ 1', '≤ 65535']);
    expect(describeConstraints({ exclusiveMinimum: 0, exclusiveMaximum: 10, multipleOf: 5 })).toEqual(['> 0', '< 10', 'multiple of 5']);
    expect(describeConstraints({ minLength: 1, maxLength: 200, format: 'email', pattern: '^a' })).toEqual(['length ≥ 1', 'length ≤ 200', 'format: email', 'pattern: ^a']);
    expect(describeConstraints({ minItems: 1, maxItems: 3, uniqueItems: true })).toEqual(['items ≥ 1', 'items ≤ 3', 'unique items']);
    expect(describeConstraints({ required: ['id', 'name'], additionalProperties: false })).toEqual(['required: id, name', 'no other keys']);
    expect(describeConstraints({ unevaluatedProperties: false })).toEqual(['no other keys']);
  });

  it('keeps zero limits', () => {
    expect(describeConstraints({ minimum: 0, minLength: 0 })).toEqual(['≥ 0', 'length ≥ 0']);
  });
});

describe('typeLabel', () => {
  it('joins declared types', () => {
    expect(typeLabel({ type: 'integer' })).toBe('integer');
    expect(typeLabel({ type: ['string', 'null'] })).toBe('string | null');
  });

  it('collects the types of alternatives without repeats', () => {
    expect(typeLabel({ oneOf: [{ type: 'null' }, { type: 'object' }] })).toBe('null | object');
    expect(typeLabel({ oneOf: [{ type: 'string' }, { type: 'string' }, { type: 'boolean' }] })).toBe('string | boolean');
  });

  it('is empty when the schema does not say', () => {
    expect(typeLabel({})).toBe('');
    expect(typeLabel({ enum: [1] })).toBe('');
  });
});
