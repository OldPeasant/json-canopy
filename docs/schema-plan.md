# Schema feature — plan

Making the editor schema-aware and giving schema-described files a
visual presentation that explains the file. This file is the persistent
record of the design decisions and progress, kept in the repo so work can
continue from any machine on the `schema` branch.

This **supersedes** the "No JSON Schema" decision in `editor-plan.md`.
Without a schema the editor behaves exactly as it does today.

## Goal

The editor knows what fits and what doesn't because of a schema, and it
shows the file in a way that makes the file understandable, not just
editable. Two kinds of users must both be served:

- **Data files** (teams, inventories, work items): lists of similar
  records. Table-first display works well.
- **Configuration files** (app config, pipelines): trees of small
  objects with few repeated rows. Labelled fields and inline docs work
  better.

## Decisions (locked in)

- **One core, two interchangeable layouts.** A **Tables** layout (the
  existing one) and a **Form** layout (new). A toggle in the titlebar
  switches at any time. Both render the same schema model; the layout is a
  presentation choice and never changes the data.
- **Focus and errors survive the toggle.** The focused path and the error
  list are shared state, so switching layout does not lose the user's place.
- **Hybrid form.** In Form layout, objects render as labelled fields and
  arrays of objects render as tables inside the form. Large arrays never
  render as N expanded forms.
- **Default layout.** With no schema: Tables (today's behaviour). With a
  schema: Tables when the document is essentially a list of records (it is
  an array, or its own properties hold an array of two or more objects),
  otherwise Form. Lists nested deeper do not count, since the form shows
  them as tables. The user's choice always wins for that document; it is
  not yet remembered across documents.
- **Standard JSON Schema keywords only.** No `discriminator` (OpenAPI, and
  Ajv rejects it) and no `x-*` extensions at first. The editor infers a
  discriminator as a property that is a `const` in every `oneOf` variant.
- **Validation is warn-and-annotate.** Never block an edit; always show
  the error. Errors appear on the node, in the schema bar count, and in a
  list. For `oneOf`, report the closest variant instead of Ajv's raw
  errors.
- **Schema sources.**
  - `$schema` in the file, with relative paths resolved against the file.
  - In the IntelliJ plugin, also the IDE's own JSON Schema mappings.
  - In the standalone app, a "Choose schema…" action (paste or pick).
  - Remote `$schema` URLs are not fetched without explicit user consent.
- **Docs panel.** A collapsible side panel in Form layout shows
  `description`, `examples`, constraints and `default` for the focused
  field. In Tables layout the same content is an `ⓘ` hover popover.
- **Validation engine:** Ajv (draft 2020-12) plus ajv-formats. Resolving
  `$ref`, merging `allOf` and mapping paths to schema nodes for the UI
  is our own code.

## Keyword coverage

| UI models these (v1) | Validated by Ajv but not modelled in the UI |
|---|---|
| `type`, `properties`, `required`, `enum`, `const`, `items`, `$ref`/`$defs`, `additionalProperties`, `patternProperties`, `propertyNames`, `oneOf`, `anyOf`, `allOf` (merge), `default`, `title`, `description`, `examples`, `readOnly`, `writeOnly`, `deprecated`, `format`, numeric and length limits | `if/then/else`, `dependentSchemas`, `unevaluatedProperties`, `$dynamicRef` |

Anything unmodelled degrades gracefully: the value is still editable, and
Ajv still reports violations. Widen coverage based on real schemas.

## UI vocabulary (shared by both layouts)

| Element | Meaning |
|---|---|
| `*` after a name | required |
| dim ghost row `⊕ key` | optional key that is absent; click to add it with its default |
| dropdown | `enum` / `const` value |
| `⚠` / red | validation error; message on hover and in the list |
| `ⓘ` | schema documentation |
| locked | `readOnly` |
| struck-through | `deprecated` |
| schema bar | always visible: schema name, source, problem count |

### Tables layout additions
- Columns come from the schema, not from the data. Core fields are always
  shown; optional fields used by only some rows collapse into an
  "Optional columns" chip row with usage counts (click to add a column).
- Enum cells are dropdowns. The type dropdown offers only allowed types.
- A `null | object` alternative shows a small type toggle.

### Form layout
- Three regions: outline (navigation with error markers), editor (fields
  in schema order, absent optional fields show their default dimmed), docs.
- `oneOf` with a discriminator renders as a variant picker. Switching
  variants lists the keys that would be dropped.
- `oneOf`/`anyOf` without a discriminator (for example boolean or object,
  array or object) renders as a small type toggle.
- Maps (`additionalProperties` or `patternProperties`) render as a list
  with "Add entry", and the key is validated live against
  `propertyNames`/`patternProperties`.

## Test bed

Schemas in `samples/schemas/`, samples in `samples/` and
`samples/config/`. Verified with Ajv 2020: valid samples pass, invalid
ones fail.

| Schema | Valid sample | Invalid sample | Covers |
|---|---|---|---|
| `team.schema.json` | `team.json` | `team-invalid.json` | enum, `null \| object`, closed objects, optional keys, `readOnly`, `$ref` |
| `filters-demo.schema.json` | `plugin-demo/filters-demo.json` | — | discriminated `oneOf`, per-variant enums and required, `deprecated` |
| `search-demo.schema.json` | `search-demo.json` | — | keyed map, fixed objects, `propertyNames` |
| `app-config.schema.json` | `config/app-config.json` | `config/app-config-invalid.json` | `oneOf` by `driver`, `patternProperties`, map of enums, `if/then`, `deprecated`, `writeOnly`, defaults |
| `pipeline.schema.json` | `config/pipeline.json` | `config/pipeline-invalid.json` | array-or-object `oneOf`, keyed jobs, step alternatives |

`plugin-demo/pagination-demo.json` (500 KB) is the performance check:
schema mapping and validation must stay fast on it.

## Phases

0. **Schema core.** A pure TypeScript service with no UI: load a schema,
   resolve `$ref`, map a data path to its schema node(s), infer
   discriminators, validate with Ajv, list ghost keys. Unit-tested against
   the test bed. Includes a timing check on `pagination-demo.json`.
1. **Tables with schema.** Schema bar, error markers, enum dropdowns,
   restricted type dropdown, ghost rows, optional-columns chips, `ⓘ`
   popover.
2. **Form layout.** Outline, fields in schema order, hybrid arrays, docs
   panel, the layout toggle with shared focus and errors, default-layout
   rule and its persistence.
3. **Variants and alternatives.** Variant picker, type toggle, closest-
   variant error messages, dropped-keys preview.
4. **Plugin integration.** Schema from IDE mappings and `$schema`
   resolution against the file path, remote-URL consent, bridge messages.

## Open questions

- Per-file or per-schema persistence of the layout choice, and where it is
  stored (webview storage versus IDE settings in the plugin).
- Semantic checks beyond the schema (for example `needs` and `reports`
  refer to existing ids). Out of scope for now; revisit after phase 3.
- Whether schemas may later carry layout hints, which would need an
  extension keyword. Deferred until standard keywords prove insufficient.

## Progress

- [x] Direction and decisions agreed
- [x] Test-bed schemas and samples drafted and verified
- [x] Phase 0: schema core (`src/app/schema/`, `npm test`; 8,000 rows validate in ~9 ms)
- [x] Phase 1: tables with schema
  - [x] Schema bar: choose/remove a schema, problem count and list
  - [x] Error markers on nodes, chips and rows
  - [x] Jump from a problem in the list to its node (clears search, expands, unhides, reveals, scrolls)
  - [x] Deprecated (struck through) and readOnly (locked, inherited) styling
  - [x] Enum dropdowns and restricted type dropdown
  - [x] Ghost keys: chips under objects, dim columns in tables of records, schema-seeded values
  - [ ] Optional-columns chips (collapse sparse columns) — deferred; ghost columns cover "what can I add"
  - [x] `ⓘ` popover with descriptions, constraints, default and examples
- [ ] Phase 2: form layout
  - [x] First slice: Tables/Form toggle, default rule, objects as fields in schema order, ghost fields, collapsible groups, arrays as embedded tables, problems, jump, editing
  - [ ] Outline panel, docs panel, search in the form, remembered choice, variant picker (phase 3)
- [~] Phase 3: variants and alternatives
  - [x] Variant picker in the form (chips, inline confirmation listing what is removed, reset or added)
  - [x] Switching from a table cell: non-destructive (adds required keys, resets values that no longer fit)
  - [x] Closest-variant error messages
  - [x] Type toggle for non-discriminated alternatives (the restricted type dropdown)
  - [ ] Variant picker for tables (rows) — the table has no place to ask before removing keys
- [ ] Phase 4: plugin integration
