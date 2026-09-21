import { describe, expect, it } from 'vitest';
import { KeyValueStore, LayoutMemory } from './layout-memory';

const mapStore = (): KeyValueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe('LayoutMemory', () => {
  it('remembers a layout per schema', () => {
    const store = mapStore();
    const memory = new LayoutMemory(() => store);
    memory.set('https://a/x.json', 'form');
    memory.set('b', 'tables');
    expect(memory.get('https://a/x.json')).toBe('form');
    expect(memory.get('b')).toBe('tables');
    expect(memory.get('never-seen')).toBeUndefined();
  });

  it('ignores a stored value that is not a layout', () => {
    const store = mapStore();
    store.map.set('canopy.layout.x', 'sideways');
    expect(new LayoutMemory(() => store).get('x')).toBeUndefined();
  });

  it('survives storage that is missing or throws', () => {
    const missing = new LayoutMemory(() => undefined);
    expect(() => missing.set('x', 'form')).not.toThrow();
    expect(missing.get('x')).toBeUndefined();
    const blocked = new LayoutMemory(() => {
      throw new Error('SecurityError');
    });
    expect(() => blocked.set('x', 'form')).not.toThrow();
    expect(blocked.get('x')).toBeUndefined();
    const full: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(() => new LayoutMemory(() => full).set('x', 'form')).not.toThrow();
  });
});
