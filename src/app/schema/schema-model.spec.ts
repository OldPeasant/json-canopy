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

describe('choicesAt', () => {
  it('lists an enum', () => {
    const m = model('team');
    expect(m.choicesAt(['members', 0, 'role'])).toEqual(['engineer', 'researcher', 'lead', 'founder']);
    expect(model('app-config').choicesAt(['logging', 'level'])).toEqual(['trace', 'debug', 'info', 'warn', 'error']);
  });

  it('follows the variant the data selects', () => {
    const m = model('filters-demo');
    const board = load('plugin-demo/filters-demo.json');
    expect(m.choicesAt(['items', 0, 'status'], board)).toEqual(['todo', 'in-progress', 'done']);
    expect(m.choicesAt(['items', 1, 'status'], board)).toEqual(['open', 'fixed', 'wontfix']);
    expect(m.choicesAt(['items', 3, 'status'], board)).toEqual(['n/a']);
  });

  it('offers every variant for the discriminator itself', () => {
    const board = load('plugin-demo/filters-demo.json');
    expect(model('filters-demo').choicesAt(['items', 1, 'type'], board)).toEqual(['todo', 'bug', 'note', 'event']);
    const db = { database: { driver: 'postgres' } };
    expect(model('app-config').choicesAt(['database', 'driver'], db)).toEqual(['sqlite', 'postgres']);
  });

  it('is undefined where the schema does not enumerate', () => {
    const m = model('team');
    expect(m.choicesAt(['members', 0, 'name'])).toBeUndefined();
    expect(m.choicesAt(['members', 0, 'contact'])).toBeUndefined();
    expect(m.choicesAt(['nope'])).toBeUndefined();
  });

  it('unions enumerated alternatives and refuses non-scalar values', () => {
    const m = new SchemaModel({
      properties: { a: { oneOf: [{ const: 'x' }, { enum: ['y', 3] }] }, b: { oneOf: [{ const: 'x' }, { type: 'string' }] }, c: { enum: [{ o: 1 }] } },
    });
    expect(m.choicesAt(['a'])).toEqual(['x', 'y', 3]);
    expect(m.choicesAt(['b'])).toBeUndefined();
    expect(m.choicesAt(['c'])).toBeUndefined();
  });
});

describe('ghostKeysAt', () => {
  it('lists absent declared keys of the object at a path', () => {
    const team = model('team');
    const data = load('team.json');
    expect(team.ghostKeysAt(['members', 1], data).map((g) => g.key)).toEqual(['notes', 'reports', 'patents', 'awards']);
    expect(team.ghostKeysAt(['members', 1, 'contact'], data).map((g) => g.key)).toEqual(['phone', 'website']);
  });

  it('leaves out deprecated keys', () => {
    const cfg = model('app-config');
    const keys = cfg.ghostKeysAt([], { server: { port: 1 }, database: { driver: 'sqlite', file: 'x' } }).map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining(['name', 'environment', 'logging', 'features', 'cache']));
    expect(keys).not.toContain('cacheTtl');
  });

  it('follows the variant and returns nothing for a non-object', () => {
    const board = load('plugin-demo/filters-demo.json');
    const items = model('filters-demo');
    expect(items.ghostKeysAt(['items', 4], board).map((g) => g.key)).toEqual(['description']);
    expect(items.ghostKeysAt(['items', 5], board)).toEqual([]);
    expect(items.ghostKeysAt(['items', 5, 'title'], board)).toEqual([]);
  });
});

describe('metaAt', () => {
  it('summarises a node', () => {
    const cfg = model('app-config');
    expect(cfg.metaAt(['server', 'port'])).toMatchObject({
      type: 'integer', hasDefault: true, default: 8080, deprecated: false, readOnly: false, constraints: ['≥ 1', '≤ 65535'],
    });
    expect(cfg.metaAt(['server', 'timeoutMs'])?.description).toBe('0 disables the timeout.');
    expect(cfg.metaAt(['name'])?.examples).toEqual(['billing-api']);
  });

  it('reports the types of alternatives and required keys', () => {
    const team = model('team');
    expect(team.metaAt(['members', 0, 'contact'])?.type).toBe('null | object');
    expect(team.metaAt(['members', 0])?.constraints).toEqual(expect.arrayContaining(['required: id, name, role', 'no other keys']));
  });

  it('flags deprecated and write-only nodes', () => {
    const cfg = model('app-config');
    expect(cfg.metaAt(['cacheTtl'])).toMatchObject({ deprecated: true, description: 'Use cache.ttlSeconds.' });
    expect(cfg.metaAt(['database', 'password'], { database: { driver: 'postgres' } })?.writeOnly).toBe(true);
    expect(model('filters-demo').metaAt(['archive'])?.deprecated).toBe(true);
  });

  it('inherits readOnly from ancestors', () => {
    const team = model('team');
    expect(team.metaAt(['members', 0, 'id'])?.readOnly).toBe(true);
    expect(team.metaAt(['metadata', 'stats'])?.readOnly).toBe(true);
    expect(team.metaAt(['metadata', 'stats', 'totalMembers'])?.readOnly).toBe(true);
    expect(team.metaAt(['metadata', 'tags'])?.readOnly).toBe(false);
  });

  it('is undefined where the schema says nothing', () => {
    expect(model('team').metaAt(['members', 0, 'nope'])).toBeUndefined();
  });
});

describe('declaredKeysAt', () => {
  it('lists declared keys in schema order', () => {
    expect(model('team').declaredKeysAt(['members', 0])).toEqual(
      ['id', 'name', 'role', 'active', 'skills', 'contact', 'certifications', 'notes', 'reports', 'patents', 'awards'],
    );
  });

  it('unions the keys of all variants', () => {
    const keys = model('filters-demo').declaredKeysAt(['items', 0]);
    expect(keys).toEqual(expect.arrayContaining(['id', 'type', 'title', 'assignee', 'notes', 'date']));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves out deprecated keys and unknown paths', () => {
    expect(model('app-config').declaredKeysAt([])).not.toContain('cacheTtl');
    expect(model('team').declaredKeysAt(['nowhere'])).toEqual([]);
  });
});

describe('variants', () => {
  const board = load('plugin-demo/filters-demo.json');
  const items = model('filters-demo');
  const cfg = model('app-config');

  it('lists the variants a discriminator tells apart', () => {
    expect(items.variantsAt(['items', 0])).toEqual({
      property: 'type',
      variants: [
        { label: 'To-do', values: ['todo'] },
        { label: 'Bug', values: ['bug'] },
        { label: 'Note', values: ['note'] },
        { label: 'Event', values: ['event'] },
      ],
    });
    expect(cfg.variantsAt(['database'])?.variants.map((v) => v.label)).toEqual(['SQLite', 'PostgreSQL']);
    expect(model('team').variantsAt(['members', 0])).toBeUndefined();
    expect(model('team').variantsAt(['members', 0, 'contact'])).toBeUndefined();
  });

  it('says which variant an object is', () => {
    expect(items.variantIndexAt(['items', 1], board)).toBe(1);
    expect(items.variantIndexAt(['items', 5], board)).toBe(3);
    expect(items.variantIndexAt(['items', 0], { items: [{ type: 'nope' }] })).toBeUndefined();
  });

  it('reshapes a to-do into an event', () => {
    const r = items.switchVariant(['items', 0], board, 'event')!;
    expect(r.dropped).toEqual(['assignee']);
    expect(r.reset).toEqual(['status']);
    expect(r.added).toEqual(['date']);
    expect(r.value).toEqual({ id: 1, type: 'event', title: 'Write hero copy', status: 'scheduled', description: 'Draft the headline and subhead for the new homepage hero.', date: '' });
  });

  it('keeps what the new variant also declares, and only resets what no longer fits', () => {
    const r = items.switchVariant(['items', 0], board, 'bug')!;
    expect(r.dropped).toEqual([]);
    expect(r.reset).toEqual(['status']);
    expect(r.value).toMatchObject({ type: 'bug', assignee: 'Alex', status: 'open' });
  });

  it('can leave the leftovers in place instead of dropping them', () => {
    const r = items.switchVariant(['items', 0], board, 'event', false)!;
    expect(r.dropped).toEqual([]);
    expect(r.value['assignee']).toBe('Alex');
    expect(r.added).toEqual(['date']);
  });

  it('switches a config block and adds what the variant requires', () => {
    const data = { database: { driver: 'postgres', host: 'h', name: 'n', port: 5432 } };
    const r = cfg.switchVariant(['database'], data, 'sqlite')!;
    expect(r.dropped).toEqual(['host', 'name', 'port']);
    expect(r.value).toEqual({ driver: 'sqlite', file: '' });
    expect(r.added).toEqual(['file']);
  });

  it('keeps the position of the discriminator among the keys', () => {
    const r = items.switchVariant(['items', 3], board, 'todo')!;
    expect(Object.keys(r.value).slice(0, 3)).toEqual(['id', 'type', 'title']);
  });

  it('refuses a value that names no variant, and objects without variants', () => {
    expect(items.switchVariant(['items', 0], board, 'nope')).toBeUndefined();
    expect(model('team').switchVariant(['members', 0], load('team.json'), 'x')).toBeUndefined();
  });

  it('does not touch the data it was given', () => {
    const copy = structuredClone(board);
    items.switchVariant(['items', 0], board, 'event');
    expect(board).toEqual(copy);
  });
});

describe('requiredAt', () => {
  it('lists the required keys of an object', () => {
    expect([...model('team').requiredAt(['members', 0])]).toEqual(['id', 'name', 'role']);
    expect([...model('team').requiredAt([])]).toEqual(['team', 'members']);
  });

  it('follows the variant the data selects', () => {
    const board = load('plugin-demo/filters-demo.json');
    const m = model('filters-demo');
    expect(m.requiredAt(['items', 1], board).has('assignee')).toBe(true);
    expect(m.requiredAt(['items', 0], board).has('assignee')).toBe(false);
    expect(m.requiredAt(['items', 5], board).has('date')).toBe(true);
  });

  it('is empty where the schema says nothing', () => {
    expect(model('team').requiredAt(['nowhere']).size).toBe(0);
  });
});

describe('permitsKey', () => {
  it('refuses keys a closed object does not declare', () => {
    const team = model('team');
    const data = load('team.json');
    expect(team.permitsKey(['members', 0], data, 'notes')).toBe(true);
    expect(team.permitsKey(['members', 0], data, 'hobby')).toBe(false);
  });

  it('checks the row\'s own variant', () => {
    const board = load('plugin-demo/filters-demo.json');
    const m = model('filters-demo');
    expect(m.permitsKey(['items', 0], board, 'assignee')).toBe(true);
    expect(m.permitsKey(['items', 0], board, 'date')).toBe(false);
    expect(m.permitsKey(['items', 5], board, 'date')).toBe(true);
  });

  it('allows anything in open objects and where the schema is silent', () => {
    expect(model('search-demo').permitsKey(['settings'], load('search-demo.json'), 'anything')).toBe(true);
    expect(model('team').permitsKey(['nowhere'], {}, 'x')).toBe(true);
  });

  it('allows any key that a map admits', () => {
    const cfg = model('app-config');
    expect(cfg.permitsKey(['features'], load('config/app-config.json'), 'newFlag')).toBe(true);
  });
});

describe('seed', () => {
  const team = model('team');
  const cfg = model('app-config');
  const at = (m: SchemaModel, ...path: Array<string | number>) => m.seed(m.nodesAt(path)[0]);

  it('prefers default, then const, then the first enum value', () => {
    expect(at(team, 'members', 0, 'skills')).toEqual([]);
    expect(at(team, 'members', 0, 'active')).toBe(true);
    expect(at(team, 'members', 0, 'role')).toBe('engineer');
    expect(at(cfg, 'server', 'port')).toBe(8080);
  });

  it('falls back to the empty value of the type, respecting a minimum', () => {
    expect(at(team, 'members', 0, 'name')).toBe('');
    expect(at(team, 'members', 0, 'id')).toBe(1);
    expect(at(team, 'members', 0, 'patents')).toBe(0);
    expect(at(team, 'members', 0, 'notes')).toBe('');
    expect(at(team, 'members', 0, 'awards')).toEqual([]);
  });

  it('seeds the required keys of an object', () => {
    expect(at(cfg, 'server', 'tls')).toEqual({ certFile: '', keyFile: '' });
    expect(at(team, 'members', 0)).toEqual({ id: 1, name: '', role: 'engineer' });
  });

  it('takes the first real alternative, preferring a value to null', () => {
    expect(at(team, 'members', 0, 'contact')).toEqual({ email: '' });
    expect(at(cfg, 'features', 'x')).toBe(false);
    expect(at(cfg, 'database')).toEqual({ driver: 'sqlite', file: '' });
  });

  it('does not recurse forever through required self-references', () => {
    const m = new SchemaModel({ $defs: { n: { type: 'object', required: ['child'], properties: { child: { $ref: '#/$defs/n' } } } }, $ref: '#/$defs/n' });
    expect(() => m.seed(m.root)).not.toThrow();
  });

  it("returns a copy, never the schema's own default", () => {
    const m = new SchemaModel({ default: { a: [1] } });
    const first = m.seed(m.root) as { a: number[] };
    first.a.push(2);
    expect(m.seed(m.root)).toEqual({ a: [1] });
  });
});

describe('typesAt', () => {
  it('reads the types allowed at a path, whatever the value is now', () => {
    const team = model('team');
    expect(team.typesAt(['members', 0, 'contact'])).toEqual(['null', 'object']);
    expect(team.typesAt(['founded'])).toEqual(['number']);
    expect(team.typesAt(['members', 0, 'skills'])).toEqual(['array']);
  });

  it('is undefined where the schema says nothing', () => {
    expect(model('team').typesAt(['members', 0, 'nope'])).toBeUndefined();
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

describe('the $schema key', () => {
  it('is not an unknown key just because the schema is closed', () => {
    const team = { ...load('team.json'), $schema: '../schemas/team.schema.json' };
    expect(model('team').validate(team)).toEqual([]);
  });

  it('is still checked where the schema declares it', () => {
    const schema = { properties: { $schema: { type: 'string' } }, additionalProperties: false };
    expect(new SchemaModel(schema).validate({ $schema: 3 }).map((p) => p.keyword)).toEqual(['type']);
  });

  it('does not excuse other unknown keys', () => {
    const team = { ...load('team.json'), $schema: 'x', nope: 1 };
    expect(model('team').validate(team).map((p) => p.path.join('.'))).toEqual(['nope']);
  });
});

describe('errors for alternatives', () => {
  const describeAll = (m: SchemaModel, data: unknown) => m.validate(data).map((p) => `${p.path.join('.')} :: ${p.message}`);

  it('reports only the variant a value looks like', () => {
    const lines = describeAll(model('app-config'), load('config/app-config-invalid.json'));
    expect(lines).toEqual(expect.arrayContaining([
      "database.host :: must have required property 'host'",
      "database.name :: must have required property 'name'",
      'database.file :: must NOT have additional properties',
      "features.newCheckout.enabled :: must have required property 'enabled'",
      'features.newCheckout.rolloutPercent :: must be <= 100',
    ]));
    expect(lines.filter((l) => l.includes('oneOf') || l.includes('constant'))).toEqual([]);
  });

  it('keeps errors that do not come from the alternatives', () => {
    const lines = describeAll(model('app-config'), load('config/app-config-invalid.json'));
    expect(lines).toEqual(expect.arrayContaining(['server.port :: must be <= 65535', 'unknownSection :: must NOT have additional properties']));
  });

  it('boils a switched work item down to what is actually wrong', () => {
    const board = load('plugin-demo/filters-demo.json');
    const m = model('filters-demo');
    board.items[0] = m.switchVariant(['items', 0], board, 'event', false)!.value;
    expect(describeAll(m, board)).toEqual([
      'items.0.date :: must match format "date"',
      'items.0.assignee :: must NOT have unevaluated properties',
    ]);
  });

  it('names the closest variant when the value looks like none', () => {
    const board = load('plugin-demo/filters-demo.json');
    board.items[1].type = 'gizmo';
    const lines = describeAll(model('filters-demo'), board).filter((l) => l.startsWith('items.1'));
    expect(lines[0]).toBe('items.1 :: fits none of the options (To-do, Bug, Note, Event); closest is Bug');
    expect(lines).toContain('items.1.type :: must be equal to constant');
  });

  it('does the same for alternatives that are not told apart by a discriminator', () => {
    const lines = describeAll(model('pipeline'), load('config/pipeline-invalid.json'));
    expect(lines).toContain('jobs.test.steps.0 :: fits none of the options (Run command, Use action); closest is Run command');
    expect(lines.filter((l) => l.includes('exactly one schema'))).toEqual([]);
  });

  it('says so when a value fits more than one option', () => {
    const m = new SchemaModel({ oneOf: [{ type: 'string' }, { minLength: 1 }] });
    expect(m.validate('abc').map((p) => p.message)).toEqual(['fits more than one option (string, option 2); it must fit exactly one']);
  });

  it('leaves valid documents valid', () => {
    expect(model('app-config').validate(load('config/app-config.json'))).toEqual([]);
    expect(model('filters-demo').validate(load('plugin-demo/filters-demo.json'))).toEqual([]);
  });

  it('falls back to the raw errors when a variant cannot be checked on its own', () => {
    // The first variant points into the middle of the root, which cannot be compiled alone.
    const m = new SchemaModel({
      properties: {
        a: { type: 'object' },
        b: { oneOf: [{ type: 'object', properties: { q: { $ref: '#/properties/a' } } }, { type: 'number' }] },
      },
    });
    const problems = m.validate({ b: true });
    expect(problems.map((p) => p.keyword)).toContain('oneOf');
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
