import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SchemaModel, schemaRefOf, type JsonSchema, type Problem } from './index';

const SAMPLES = new URL('../../../samples/', import.meta.url);
const load = (file: string) => JSON.parse(readFileSync(new URL(file, SAMPLES), 'utf8'));
const model = (schema: string) => new SchemaModel(load(`schemas/${schema}.schema.json`));
const paths = (problems: Problem[]) => problems.map((p) => p.path.join('.'));

describe('resolve', () => {
  it('follows $ref and merges allOf', () => {
    const m = model('filters-demo');
    const todo = m.resolve({ $ref: '#/$defs/todo' });
    expect(Object.keys(todo.properties!)).toEqual(['id', 'title', 'description', 'type', 'status', 'assignee']);
    expect(todo.required).toEqual(['id', 'type', 'title', 'status']);
    expect(todo.title).toBe('To-do');
  });

  it('lets local keywords win over the referenced ones', () => {
    const m = new SchemaModel({ $defs: { a: { type: 'string', title: 'A' } } });
    expect(m.resolve({ $ref: '#/$defs/a', title: 'Mine' })).toMatchObject({ type: 'string', title: 'Mine' });
  });

  it('keeps both constraints when allOf parts share a property', () => {
    const m = new SchemaModel({});
    const s = m.resolve({ allOf: [{ properties: { x: { type: 'string' } } }, { properties: { x: { minLength: 1 } } }] });
    expect(m.resolve(s.properties!['x'])).toMatchObject({ type: 'string', minLength: 1 });
  });

  it('survives circular and unresolvable references', () => {
    const m = new SchemaModel({ $defs: { loop: { $ref: '#/$defs/loop' } } });
    expect(() => m.resolve({ $ref: '#/$defs/loop' })).not.toThrow();
    expect(m.resolve({ $ref: 'https://example.com/other.json' })).toEqual({});
    expect(m.warnings).toEqual(['circular $ref #/$defs/loop', 'unsupported $ref https://example.com/other.json']);
  });
});

describe('nodesAt', () => {
  const m = model('team');
  const team = load('team.json');

  it('maps data paths to property schemas', () => {
    expect(m.nodesAt(['members', 0, 'role'])[0].enum).toEqual(['engineer', 'researcher', 'lead', 'founder']);
    expect(m.nodesAt(['members', 1, 'contact', 'email'], team)[0].format).toBe('email');
  });

  it('narrows null | object using the data', () => {
    expect(m.nodesAt(['members', 2, 'contact'], team)[0].type).toBe('null');
    expect(m.nodesAt(['members', 0, 'contact'], team)[0].required).toEqual(['email']);
  });

  it('offers every alternative when there is no data', () => {
    expect(m.nodesAt(['members', 0, 'contact', 'email']).length).toBe(1);
    expect(m.nodesAt(['members', 0, 'contact'])[0].oneOf).toHaveLength(2);
  });

  it('reads map values through additionalProperties and patternProperties', () => {
    expect(model('search-demo').nodesAt(['products', 'widget', 'price'])[0].minimum).toBe(0);
    const cfg = model('app-config');
    expect(cfg.nodesAt(['logging', 'loggers', 'http.client'])[0].enum).toContain('warn');
    expect(cfg.nodesAt(['features', 'darkMode'])[0].oneOf).toHaveLength(2);
  });

  it('returns nothing for keys the schema does not allow', () => {
    expect(m.nodesAt(['members', 0, 'nope'])).toEqual([]);
  });
});

describe('variants', () => {
  const items = model('filters-demo');
  const board = load('plugin-demo/filters-demo.json');
  const itemsSchema = () => items.nodesAt(['items'])[0].items as JsonSchema;

  it('infers the discriminator from const properties', () => {
    const d = items.discriminatorOf(itemsSchema());
    expect(d).toEqual({ property: 'type', values: [['todo'], ['bug'], ['note'], ['event']] });
    expect(model('app-config').discriminatorOf(model('app-config').nodesAt(['database'])[0])).toEqual({
      property: 'driver',
      values: [['sqlite'], ['postgres']],
    });
  });

  it('finds no discriminator for plain alternatives', () => {
    const team = model('team');
    expect(team.discriminatorOf(team.nodesAt(['members', 0, 'contact'])[0])).toBeUndefined();
    const pipe = model('pipeline');
    expect(pipe.discriminatorOf(pipe.nodesAt(['jobs', 'x', 'steps', 0])[0])).toBeUndefined();
  });

  it('narrows to the variant selected by the discriminator', () => {
    const bug = items.nodesAt(['items', 1], board)[0];
    expect(bug.title).toBe('Bug');
    expect(items.nodesAt(['items', 1, 'status'], board)[0].enum).toEqual(['open', 'fixed', 'wontfix']);
    expect(items.nodesAt(['items', 5, 'date'], board)[0].format).toBe('date');
  });

  it('tells run steps from use steps by required keys', () => {
    const pipe = model('pipeline');
    const cfg = load('config/pipeline.json');
    expect(pipe.nodesAt(['jobs', 'build', 'steps', 0], cfg)[0].title).toBe('Use action');
    expect(pipe.nodesAt(['jobs', 'build', 'steps', 1], cfg)[0].title).toBe('Run command');
  });

  it('stays ambiguous when several variants fit', () => {
    const pipe = model('pipeline');
    const both = { jobs: { j: { steps: [{ run: 'x', uses: 'a/b@c' }] } } };
    expect(pipe.nodesAt(['jobs', 'j', 'steps', 0], both)[0].oneOf).toHaveLength(2);
  });
});

describe('ghostKeys', () => {
  it('lists declared properties the data lacks', () => {
    const team = model('team');
    const data = load('team.json');
    const member = team.nodesAt(['members', 1], data)[0];
    const keys = team.ghostKeys(member, data.members[1]).map((g) => g.key);
    expect(keys).toEqual(['notes', 'reports', 'patents', 'awards']);
    expect(team.ghostKeys(member, data.members[1]).find((g) => g.key === 'notes')).toMatchObject({ required: false });
  });

  it('follows the selected variant and reports defaults', () => {
    const cfg = model('app-config');
    const db = { driver: 'postgres', host: 'h', name: 'n' };
    const ghosts = cfg.ghostKeys(cfg.nodesAt(['database'])[0], db);
    expect(ghosts.map((g) => g.key)).toEqual(['port', 'user', 'password', 'passwordEnv', 'pool']);
    expect(ghosts[0]).toMatchObject({ hasDefault: true, default: 5432 });
  });

  it('marks absent required keys', () => {
    const team = model('team');
    const ghosts = team.ghostKeys(team.nodesAt(['members', 0])[0], { id: 1 });
    expect(ghosts.filter((g) => g.required).map((g) => g.key)).toEqual(['name', 'role']);
  });
});

describe('allowedTypes', () => {
  it('follows type, enum and const', () => {
    const m = model('team');
    expect(m.allowedTypes({ type: 'integer' })).toEqual(['number']);
    expect(m.allowedTypes({ enum: ['a', 1] })).toEqual(['string', 'number']);
    expect(m.allowedTypes({ const: null })).toEqual(['null']);
  });

  it('unions alternatives and allows anything when unconstrained', () => {
    const m = model('team');
    expect(m.allowedTypes(m.nodesAt(['members', 0, 'contact'])[0])).toEqual(['null', 'object']);
    expect(m.allowedTypes({})).toEqual(['string', 'number', 'boolean', 'null', 'object', 'array']);
  });
});

describe('validate', () => {
  const cases: Array<[string, string]> = [
    ['team', 'team.json'],
    ['filters-demo', 'plugin-demo/filters-demo.json'],
    ['search-demo', 'search-demo.json'],
    ['app-config', 'config/app-config.json'],
    ['pipeline', 'config/pipeline.json'],
  ];
  it.each(cases)('accepts %s with %s', (schema, file) => {
    expect(model(schema).validate(load(file))).toEqual([]);
  });

  it('places errors on the offending nodes', () => {
    const problems = model('team').validate(load('team-invalid.json'));
    expect(paths(problems)).toEqual(
      expect.arrayContaining(['founded', 'members.0.role', 'members.0.contact.email', 'members.0.contact.fax', 'members.1.name', 'members.1.hobby', 'members.2.name']),
    );
  });

  it('points missing keys at the absent key', () => {
    const problems = model('team').validate(load('team-invalid.json'));
    expect(problems.find((p) => p.keyword === 'required' && p.path[1] === 2)?.path).toEqual(['members', 2, 'name']);
  });

  it('flags config problems', () => {
    const p = paths(model('app-config').validate(load('config/app-config-invalid.json')));
    expect(p).toEqual(expect.arrayContaining(['environment', 'server.port', 'server.tls.keyFile', 'logging.level', 'features.Dark_Mode', 'unknownSection']));
  });

  it('flags pipeline problems', () => {
    const p = paths(model('pipeline').validate(load('config/pipeline-invalid.json')));
    expect(p).toEqual(expect.arrayContaining(['on', 'jobs.test.timeoutMinutes', 'jobs.Build']));
  });

  it('does not throw on data of the wrong shape', () => {
    expect(model('team').validate(42).length).toBeGreaterThan(0);
  });

  it('honours a draft-07 schema', () => {
    const m = new SchemaModel({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', required: ['a'] });
    expect(paths(m.validate({}))).toEqual(['a']);
  });
});

describe('schemaRefOf', () => {
  it('reads $schema from an object document', () => {
    expect(schemaRefOf(load('config/app-config.json'))).toBe('../schemas/app-config.schema.json');
    expect(schemaRefOf(load('team.json'))).toBeUndefined();
    expect(schemaRefOf([])).toBeUndefined();
    expect(schemaRefOf({ $schema: 3 })).toBeUndefined();
  });
});

describe('performance on pagination-demo.json (500 KB)', () => {
  const data = load('plugin-demo/pagination-demo.json');
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      inventory: { type: 'array', items: { type: 'object', required: ['id', 'code'], properties: { id: { type: 'integer' }, code: { type: 'string', minLength: 1 } } } },
    },
  };

  it('validates and resolves paths quickly', () => {
    const m = new SchemaModel(schema);
    const t0 = performance.now();
    const problems = m.validate(data);
    const t1 = performance.now();
    for (let i = 0; i < data.inventory.length; i++) m.nodesAt(['inventory', i, 'code'], data);
    const t2 = performance.now();
    console.log(`rows=${data.inventory.length} validate=${(t1 - t0).toFixed(0)}ms nodesAt(all rows)=${(t2 - t1).toFixed(0)}ms`);
    expect(problems).toEqual([]);
    expect(t1 - t0).toBeLessThan(1000);
    expect(t2 - t1).toBeLessThan(1000);
  });
});
