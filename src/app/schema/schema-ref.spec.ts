import { describe, expect, it } from 'vitest';
import { isRemoteSchemaRef } from './schema-ref';

describe('isRemoteSchemaRef', () => {
  it('is true for http and https URLs, whatever the case or padding', () => {
    expect(isRemoteSchemaRef('https://json.schemastore.org/package.json')).toBe(true);
    expect(isRemoteSchemaRef('http://example.com/s.json')).toBe(true);
    expect(isRemoteSchemaRef('  HTTPS://example.com/s.json ')).toBe(true);
  });

  it('is false for files, relative paths and other schemes', () => {
    expect(isRemoteSchemaRef('../schemas/app.schema.json')).toBe(false);
    expect(isRemoteSchemaRef('/etc/schema.json')).toBe(false);
    expect(isRemoteSchemaRef('file:///etc/schema.json')).toBe(false);
    expect(isRemoteSchemaRef('ftp://example.com/s.json')).toBe(false);
    expect(isRemoteSchemaRef('')).toBe(false);
  });
});
