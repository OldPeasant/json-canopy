import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { CollapseService } from './collapse.service';
import { FilterMode, FilterService } from './filter.service';

function search(term: string, mode: FilterMode): FilterService {
  const filter = Injector.create({ providers: [FilterService, CollapseService] }).get(FilterService);
  filter.setMode(mode);
  filter.set(term);
  return filter;
}

describe('FilterService, strict mode', () => {
  it('shows a plain value next to a matching name, and collapses a nested one', () => {
    const filter = search('supplier', 'strict');
    expect(filter.collapsedByFilter('supplier', 'Acme')).toBe(false);
    expect(filter.collapsedByFilter('supplier', { name: 'Acme' })).toBe(true);
  });

  it('keeps a nested value open when something inside matches', () => {
    expect(search('acme', 'strict').collapsedByFilter('supplier', { name: 'Acme' })).toBe(false);
  });

  it('never widens to siblings and dims the path', () => {
    const filter = search('zurich', 'strict');
    expect(filter.widens([['city', 'Zurich'], ['staff', []]])).toBe(false);
    expect(filter.groupMatch([['city', 'Zurich']])).toBe(false);
    expect(filter.keyDim('offices', [{ city: 'Zurich' }])).toBe(true);
  });

  it('matches values too', () => {
    expect(search('zur', 'strict').valueMatch('Zurich')).toBe(true);
  });
});

describe('FilterService, context mode', () => {
  const office = { city: 'Zurich', staff: [{ name: 'Anna' }], notes: { open: true } };

  it('shows every attribute of an object on the way to a match', () => {
    const filter = search('anna', 'context');
    expect(filter.widens(Object.entries(office))).toBe(true);
    expect(filter.widens([['city', 'Basel']])).toBe(false);
  });

  it('collapses the nested siblings of a parent, but not the path or plain values', () => {
    const filter = search('anna', 'context');
    expect(filter.collapsedByFilter('notes', office.notes)).toBe(true);
    expect(filter.collapsedByFilter('city', 'Zurich')).toBe(false);
    expect(filter.collapsedByFilter('staff', office.staff)).toBe(false);
  });

  it('shows a match in full, with all its siblings, array items included', () => {
    const filter = search('a', 'context');
    expect(filter.forces('tags', ['a', 'b'])).toBe(true);
    expect(filter.groupMatch([[null, 'a'], [null, 'b']])).toBe(true);
    expect(search('zz', 'context').groupMatch([[null, 'a'], [null, 'b']])).toBe(false);
  });
});
