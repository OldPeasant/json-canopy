import { describe, expect, it } from 'vitest';
import { decode, encode } from './bridge';

describe('decode', () => {
  it('reads the three messages the page sends', () => {
    expect(decode('{"type":"READY","payload":{}}')).toEqual({ type: 'READY', payload: {} });
    expect(decode('{"type":"DOCUMENT_CHANGED","payload":{"text":"{}"}}')).toEqual({
      type: 'DOCUMENT_CHANGED',
      payload: { text: '{}' },
    });
    expect(decode('{"type":"FETCH_SCHEMA","payload":{"url":"https://x/s.json"}}')).toEqual({
      type: 'FETCH_SCHEMA',
      payload: { url: 'https://x/s.json' },
    });
  });

  it('drops anything else', () => {
    for (const raw of [
      undefined,
      { type: 'READY' },
      'not json',
      'null',
      '{"type":"UNKNOWN","payload":{}}',
      '{"type":"DOCUMENT_CHANGED","payload":{}}',
      '{"type":"FETCH_SCHEMA","payload":{"url":42}}',
    ]) {
      expect(decode(raw)).toBeNull();
    }
  });
});

describe('encode', () => {
  it('produces the envelope the page dispatches', () => {
    const json = encode({ type: 'EXTERNAL_RELOAD', payload: { text: '[1]' } });
    expect(JSON.parse(json)).toEqual({ type: 'EXTERNAL_RELOAD', payload: { text: '[1]' } });
  });
});
