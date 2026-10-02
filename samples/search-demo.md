# Search demo

Walkthrough of the search modes and collapse features, using `search-demo.json`.

**Setup:** run `npm start` and paste the contents of `search-demo.json` into the
app, or open the file in the IDE plugin. Type the search terms in the box at the
top left. The toolbar has two mode buttons, **Strict** and **Context**. A
one-line description of the active mode appears under the toolbar while you
search.

Search is case-insensitive and matches substrings in both names and values.
Changing the term or the mode resets any collapse/expand clicks you made.

## 0. Without a search: collapse anything

1. Clear the search box. Every table shows two small buttons above its top-left corner:
   the column menu and `▾`.
2. Click `▾` above `offices`. The whole node collapses to a chip like `▸ [ 3 ]`.
3. Click the chip to expand again. This works for any non-empty object or array, at any depth.

## Modes at a glance

| Mode | A matching name shows | A matching value shows | Around it |
|---|---|---|---|
| **Strict** | its value; a nested one collapsed (`▸ { n }`) | the value | only the parents, dimmed |
| **Context** | its whole value | the value | all its siblings in full; each parent's sibling attributes collapsed, but no other items of an array a parent sits in |

## 1. Strict: only what matched

| Term | What to look for |
|---|---|
| `zurich` | Only the Zurich row of `offices` remains, showing the value. Its column name `city` and the ancestors (`offices`) are **dimmed**: they are only there as the path. Geneva and Basel are gone. |
| `description` | This term is a *name* with a plain text value, so `widget` and `gadget` each show the highlighted `description` with its text, under a dimmed path. |
| `supplier` | Both `supplier` names show a collapsed chip `▸ { 2 }`, as the value is nested. Click one to expand it: everything inside then shows, even though nothing inside matches. |
| `9.5` | Only the price value is shown, with `9.5` highlighted. The name `price` is dimmed. |
| `germany` | The chain `products` → `widget` → `supplier` → `country` → `Germany`. No other product fields. |

## 2. Context: matches with their surroundings

Switch the mode to **Context**.

| Term | What to look for |
|---|---|
| `anna` | Anna Keller's whole row (`name`, `role`, `email`). Marco, in the same `staff` array, is not shown, nor are the Geneva and Basel offices. The Zurich office shows all its attributes: `city`, `country` and `notes` with their values, `address` as a collapsed chip. At the top, `company` shows its value; `products` and `settings` are collapsed chips. |
| `germany` | `country` with its sibling `name` (`Acme`). Up the path, the other attributes of `widget` show (`tags` collapsed), `gadget` is a collapsed chip, and so are `offices` and `settings`. |
| `small` | Two matches in `widget`: the `small` tag and the text of `description`. Both are shown with all their siblings, so `tags` shows `hardware` too, and the whole `widget` record (`supplier` included) is visible. |
| `price` | Both products show their **whole record**, as `price` is a sibling of every attribute. Names that did not match (`name`, `tags`, ...) are dimmed. |

## 3. Clicking to expand (any mode)

- Search `supplier` in **Strict** to get the collapsed `▸ { 2 }` chips, and click one. The whole node expands and shows all its content, including parts that don't match. The other chip stays collapsed.
- **Shift+click** a chip (or a `▾` button) applies the click to all *related* nodes: those with the same path, ignoring array positions, like the same column in every row of an array. Try it in **Context** with `.example`, which matches the staff email addresses: the Zurich and Geneva offices both show `address` as a collapsed chip. A plain click expands one address; a Shift+click expands both.
- Manual collapse works together with a search: with `price` in **Context**, use `▾` on a product's `supplier` to collapse just that node. The rest of the record stays visible.

## 4. Tips

- Try `true` (boolean values match too), `9.5` (numbers), and a term that isn't there, such as `xyz`, which leaves an empty result.
- Search terms that appear in both a name and a value, such as `email`, are the best way to see the difference between the modes.
- Transposing tables (click on a table) and hiding columns (column menu) still work while a search is active.
