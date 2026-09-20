# Search demo

Walkthrough of the search modes and collapse features, using `search-demo.json`.

**Setup:** run `npm start` and paste the contents of `search-demo.json` into the
app, or open the file in the IDE plugin. Type the search terms in the box at the
top left. The toolbar has three mode buttons (**Matches**, **Path**,
**Context**) and a **Names only** checkbox. A one-line description of the
active mode appears under the toolbar while you search.

Search is case-insensitive and matches substrings. Changing the term, the mode
or **Names only** resets any collapse/expand clicks you made.

## 0. Without a search: collapse anything

1. Clear the search box. Every table shows two small buttons above its top-left corner:
   the column menu and `▾`.
2. Click `▾` above `offices`. The whole node collapses to a chip like `▸ [ 3 ]`.
3. Click the chip to expand again. This works for any non-empty object or array, at any depth.

## Modes at a glance

| Mode | A matching name shows | A matching value shows | Other names |
|---|---|---|---|
| **Matches** | collapsed chip `▸ …` / `▸ { n }` | the value | dimmed |
| **Path** | its whole value, sub-tree included | the value | normal |
| **Context** | its whole value, plus all siblings in full | the value, plus all siblings in full | non-matching ones dimmed |

## 1. Matches: only what matched

| Term | What to look for |
|---|---|
| `zurich` | Only the Zurich row of `offices` remains, showing the value. Its column name `city` and the ancestors (`offices`) are **dimmed**: they are only there as the path. Geneva and Basel are gone. |
| `description` | This term is a *name*, so `widget` and `gadget` each show a dimmed path and a collapsed chip `▸ …` in the `description` cell. Click a chip to reveal that value. |
| `supplier` | Both `supplier` names show a collapsed chip `▸ { 2 }`. Click one to expand it: everything inside then shows, even though nothing inside matches. |
| `9.5` | Only the price value is shown, with `9.5` highlighted. The name `price` is dimmed. |

## 2. Path: matches with their hierarchy

Switch the mode to **Path**.

| Term | What to look for |
|---|---|
| `zurich` | The Zurich row, with its `city` name shown normally (not dimmed) and `zurich` highlighted. |
| `description` | Now the description text is shown next to the matching name, and the name is highlighted. |
| `supplier` | Unlike Matches, each `supplier` shows its **whole content** (`name` and `country`) next to the highlighted name. A matching name always shows its full value. |
| `germany` | The chain `products` → `widget` → `supplier` → `country` → `Germany`. No other product fields. |
| `small` | Two matches in the same product: the `small` tag and the text of `description`. Other fields of `widget` (`name`, `price`) stay hidden. |

## 3. Context: matches with their surroundings

Switch the mode to **Context**.

| Term | What to look for |
|---|---|
| `price` | Both products show their **whole record**: `name`, `tags`, `description` and `supplier` with all sub-nodes. Names that did not match (`name`, `tags`, ...) are dimmed. `company`, `offices` and `settings` do not show up: ancestors show only the path. |
| `anna` | Compare with Path mode. Path shows only the `name` and `email` columns (the ones that matched). Context shows the whole row for Anna Keller, including `role`. |
| `acme` | The `supplier` object shows both `name` and `country`, not just the matching cell. |

## 4. Names only

The **Names only** checkbox ignores values, so only attribute names match.

1. Switch the mode to **Path** and search for `email`.
2. Unchecked, this matches three places: the `email` column of the staff tables, `settings.notifications.email`, and the value `"Please email the office first"` in the Geneva notes (highlighted).
3. Check **Names only**. The Geneva note disappears: only the `email` names remain.
4. Uncheck it again, then switch to **Matches**. The `email` cells of the staff tables now show collapsed `▸ …` chips: click one to see that address.

## 5. Clicking to expand (any mode)

- Search `supplier` in **Matches** to get the collapsed `▸ { 2 }` chips, and click one. The whole node expands and shows all its content, including parts that don't match. The other chip stays collapsed.
- **Shift+click** a chip (or a `▾` button) applies the click to all *related* nodes: those at the same structural position, like the same column in every row of an array. Try it in **Matches** with `email`: the staff `email` cells show `▸ …` chips. A plain click expands only that address; a Shift+click expands every staff `email` cell, in all offices.
- Manual collapse works together with a search: with `price` in **Context**, use `▾` on a product's `supplier` to collapse just that node. The rest of the record stays visible.

## 6. Tips

- Try `true` (boolean values match too), `9.5` (numbers), and a term that isn't there, such as `xyz`, which leaves an empty result.
- Search terms that appear in both a name and a value are the best way to see the difference between modes and **Names only**.
- Transposing tables (click on a table) and hiding columns (column menu) still work while a search is active.
