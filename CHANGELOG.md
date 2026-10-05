# Changelog

All notable changes to JSON Canopy. The IntelliJ plugin and the VS Code
extension share version numbers from 0.3.0 on; this file is the source of
both the IntelliJ change notes and the VS Code Marketplace changelog.

Format: one `## <version>` heading per release, then `- ` bullets
(`**bold**` and `` `code` `` are allowed; a bullet may continue on
indented lines).

## 0.3.1

- **Fix (IntelliJ):** **Choose schema…** and **Change…** did nothing when
  clicked; they now open the IDE's file chooser.

## 0.3.0

- **New: VS Code extension.** The same editor as a VS Code custom editor:
  open a `.json` file with **Open With… → JSON Canopy**, the table icon
  in the editor title bar or the Explorer context menu. Edits go into VS
  Code's own document (undo, redo and save work as usual), and the page
  follows your colour theme.
- **JSON Schema support.** Problems are marked on the values and listed
  in the schema bar (click one to jump to it); enums become dropdowns, the
  type dropdown offers only what fits, absent optional keys are offered,
  `readOnly` and `deprecated` are shown, and the `ⓘ` shows descriptions,
  constraints, defaults and examples. The schema advises, it never blocks.
- **The schema is found for you.** A local `$schema` in the file first;
  then, in IntelliJ, whatever the IDE's JSON Schema support applies (your
  mappings, SchemaStore), and in VS Code your `json.schemas` setting. A
  remote schema is never downloaded without asking.
- **Form layout.** A Tables | Form toggle: the form shows objects as
  labelled fields in schema order, with an outline, a docs panel for the
  field in focus, and a variant picker for `oneOf`/`anyOf` that asks
  before it removes anything. The choice is remembered per schema.
- **Simpler search: Strict and Context.** Strict shows only what matched,
  under dimmed parents; Context shows a match with all its siblings. The
  Path mode and the "Names only" option are gone.
- Fix: adding an item to a list of records added a bare `""` you could
  not fill in. The new item is now a record shaped by the schema, or like
  the other items when there is no schema.
- Fix: a row or key just added to a short array or object could be
  hidden behind paging.
- Fix: a new key added in the Tables view started as `""` instead of the
  schema's starting value.
- Fix: a small array could show only some of its items after a search.

## 0.2.2

- New plugin icon, matching the JSON Canopy web app.

## 0.2.1

- Fix: the JSON Canopy tab showed "Your file couldn't be accessed" on some
  IDEs (seen on IntelliJ IDEA 2026.2 as a Flatpak). The page is now loaded
  from a temporary file.
- New icon for the standalone web app.

## 0.2.0

- New search: Matches, Path and Context modes, a "Names only" option,
  match highlighting and dimmed context, with a description of the active
  mode.
- Collapse and expand any object or array; Shift+click applies to all
  related nodes.
- The field selector closes with Esc or a click outside.
