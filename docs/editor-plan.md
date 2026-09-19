# Editor feature — plan

Turning the read-only `app-json-explorer` viewer into an editor. This file
is the persistent record of the design decisions and progress, kept in the
repo (not machine-local Claude memory) so work can continue from any
machine on the `editor` branch.

## Decisions (locked in)

- **No JSON Schema.** Type stays purely structural (`typeOf()`), same as
  the viewer today.
- **Explicit type control**, not inference from typed text. Each editable
  primitive gets a type selector (string/number/boolean/null/object/array).
  Typing in the value field never changes its type; only the selector does.
  This is what makes `null` vs `""` vs "key deleted" unambiguous:
  - deleted key → key absent from the object entirely (JS/JSON has no
    `undefined` value, so "undefined" is not a type option — it's the
    delete action).
  - `null` → an explicit type-selector choice.
  - `""` → just the normal empty state of a string value.
- **Mutation model:** `app-json-table` gains `@Output() valueChange =
  new EventEmitter<unknown>()`. A leaf edit emits its new value; each
  ancestor's template handler (`onEntryChange`/`onItemChange`) rebuilds
  *its own* object/array immutably with that one child replaced, and
  re-emits `valueChange` itself. This bubbles to `App`, which does
  `data.set(newRoot)`. No index-paths needed — reuses the existing
  recursive structure. The structural `path` (with `*` wildcards) used by
  `FilterService`/`TableOrientationService`/`NodeVisibilityService` is
  untouched; it's a separate concern (view state) from data mutation.
- **Raw-text mode:** a global toggle (not per-subtree) at the `App` level.
  Dumps `JSON.stringify(data(), null, 2)` into a textarea (same look as
  the initial paste box); "Apply" re-parses and replaces `data`, reusing
  the existing `error` signal for invalid JSON.
- **Export:** titlebar gets "Copy JSON" (clipboard) and "Download JSON"
  (Blob + temp anchor) buttons once data is loaded. No autosave/
  localStorage for v1.
- **V1 scope = core CRUD:** edit primitive values, change a value's type
  (including switching to/from object `{}` / array `[]`), add/delete
  object keys, add/delete array items. Explicitly **deferred**: renaming
  an existing key, drag-to-reorder array items, undo/redo, localStorage
  autosave, per-subtree raw mode. (Rename is achievable today as
  delete+add, just clunkier.)
- **No FormsModule.** Commit edits on blur/Enter via template refs
  (`#input`, `(blur)="commit(input.value)"`), not `ngModel`, to avoid
  adding a new module for one input type — consistent with how the rest
  of the app wires `(input)` events directly today.

## Known, accepted limitations for v1

- Array items are still tracked by index in `@for` (`track $index` / `track i`,
  as today). Editing during an in-flight edit elsewhere in the same array
  could in theory shift which DOM node an in-progress edit is bound to,
  but since edits commit on blur (not per-keystroke), this is low-risk.
- Adding/removing a key can leave orphaned entries in
  `TableOrientationService`/`NodeVisibilityService`'s internal maps (keyed
  by structural path). Harmless — just unused map entries, no correctness
  or crash risk.
- Deleting a key from one object in an array-of-objects only affects that
  row (matches existing `hasCell`/union-of-keys rendering — other rows
  keep the key).

## Task breakdown

1. `src/app/json-explorer/json-edit.util.ts` — new file, pure helpers:
   `typeOf` (moved from json-table.component.ts), `withEntry`,
   `withoutEntry`, `withItem`, `withoutItemAt`, `withAppended`,
   `defaultForType`.
2. New `EditableValueComponent`
   (`src/app/json-explorer/editable-value/`) — type `<select>` +
   type-specific input (text/number/checkbox/nothing-for-null), emits
   `valueChange`.
3. `JsonTableComponent`: add `@Output() valueChange`; wire
   `onEntryChange`/`onEntryDelete`/`onAddEntry` (objects) and
   `onItemChange`/`onItemDelete`/`onAddItem` (arrays, incl.
   array-of-objects cells).
4. `json-table.component.html`: swap primitive `<span>` for
   `<app-editable-value>`; add per-key/per-item delete "×" buttons (both
   orientations); add "+ add key" (with inline key-name input) / "+ add
   item" affordances.
5. `JsonExplorerComponent`/html: forward `(valueChange)` from the root
   `app-json-table` up to `App`.
6. `App`: handle `data.set($event)` on `valueChange`; add Copy/Download
   buttons; add raw-text-mode toggle + textarea + Apply/Cancel.
7. CSS for all new controls, matching existing Tron theme (`.btn`,
   `.col-menu-btn` conventions).
8. Manual test pass via dev server across nested object/array
   combinations, all type switches, raw-text round trip, copy/download.
9. README update mentioning editing.

## Progress

- [x] 2026-09-12 — v1 implemented on the `editor` branch:
  - `json-edit.util.ts` with `typeOf`/`defaultForType`/`withEntry`/
    `withoutEntry`/`withItem`/`withoutItemAt`/`withAppended`.
  - `EditableValueComponent`: type `<select>` (all 6 types, so it also
    doubles as the "switch to/from object/array" control for container
    values) plus the type-specific input for primitives.
  - `JsonTableComponent` gained `@Output() valueChange`, wired through
    `onSelfChange`/`onEntryChange`/`onEntryDelete`/`addEntry`/
    `onItemChange`/`onItemDelete`/`addItem`/`onCellChange`/
    `onCellDelete`. `visibleArrItems` was replaced with
    `visibleArrItemIndices` so plain-array edits address the real index
    in `arr`, not the filtered position.
  - Template: delete "×" per key/item/cell (array-of-objects cell
    deletes only affect that row, as planned), "+" add-key (with inline
    name input) and add-item affordances, in both orientations.
  - `valueChange` bubbles `JsonTableComponent` → `JsonExplorerComponent`
    → `App`, which does `data.set($event)`.
  - `App`: Raw JSON toggle (textarea + Apply/Cancel, reusing `error`),
    Copy JSON (clipboard) and Download JSON (Blob) buttons in the
    titlebar.
  - Verified via a scripted Playwright pass against `ng serve` (no
    `chromium-cli` in this environment): primitive edit, type switches
    at both leaf and root level, key add/delete, array item add/delete,
    array-of-objects cell delete, raw-mode round trip, orientation
    toggle + filter still working, clipboard copy, and file download.
  - Bug caught and fixed during that pass: binding `[value]` directly on
    `<select>` raced with the `@for`-generated `<option>`s and always
    showed the first type ("string"); fixed by moving to `[selected]`
    on each `<option>` instead.
- [x] 2026-09-12 — View/Edit toggle added, so plain viewing isn't
  cluttered by editing controls:
  - New `EditModeService` (global signal, **defaults to `false`** —
    the app opens in the quiet read-only view; editing is opt-in).
  - `EditableValueComponent` renders the old read-only `<span class="val
    …">` markup when disabled, instead of the type-select + input.
  - `JsonTableComponent`'s template wraps every delete "×", add-row, and
    the array-of-objects action column in `@if (editMode.enabled())` —
    in view mode the table is pixel-equivalent to the original viewer.
  - Toggle button lives next to the filter box in
    `JsonExplorerComponent` (view-affecting, not a document-level action
    like Raw JSON/Copy/Download, which stay unaffected by this toggle).
    Labeled by the destination, not the current state — "Go to edit
    mode" / "Go to view mode" — so it reads as an action, not a status.
