# S4A Roster Totals

A Chrome extension that adds a **Total** row to the bottom of the Spotify for Artists
roster table, summing the Streams column for the selected period and showing the
roster's combined percentage change.

Spotify shows per-artist figures but no roster-wide total. This fills that gap in
place, in the page's own styling.

> All figures in this repository — README and test fixtures alike — are invented
> placeholders. No real roster data is included.

## Who it's for

Label owners, managers and self-releasing artists with several projects on one S4A
account, who want a roster-level number without exporting to a spreadsheet. Installing
requires loading an unpacked extension, so some developer comfort is assumed.

## Install

```
chrome://extensions → Developer mode → Load unpacked → select this folder
```

Then open `artists.spotify.com/c/roster` and refresh. Any Chromium browser works
(Chrome, Edge, Brave, Arc).

Chrome loads unpacked extensions from a fixed path — moving the folder breaks the
install. After editing the source, hit **↻** on the extension card, then reload the
page.

## Use

The row appears under the last artist, aligned with the Streams column:

```
Total · N artists · <period>      <combined streams>   ▼ <combined change>
```

It recalculates on its own when you switch periods (24 hours / 7 days / 28 days /
12 months), sort, filter or navigate. Nothing to click.

Hovering the percentage explains what it measures.

## How it works

No permissions are requested, no network calls are made, and nothing leaves the page.
The extension is a single content script scoped to `artists.spotify.com`.

**Row discovery.** Spotify's class names are obfuscated and change without notice, so
none are referenced. Three strategies run in order: a real `<table>`; an ARIA grid
(`[role="table"]` / `[role="row"]` / `[role="cell"]`); then repeated sibling elements
each containing exactly one artist link, which covers plain `div` layouts.

**Column identification.** The roster has several numeric columns, so the right one is
found by matching header text (`stream`, `écoute`, `reproducciones`, `wiedergaben`,
`ascolti`, then listeners, then followers). Failing that, the "Streams" label is
located anywhere on the page and matched geometrically to the column beneath it.
Failing that, the column with the largest median wins, since stream counts dwarf
values like "3 more".

**Number parsing.** The streams cell holds a count and a delta badge, and the two
resist separation: `innerText` concatenates them with no delimiter, while the DOM
splits the delta's digits and its `%` into separate text nodes. Cells are therefore
read node by node for the count, and the rejoined text is used for the percentage.
Thousands separators (`,` `.` space) and `K`/`M`/`B` suffixes are handled.

**Percentage.** The combined change is derived, not averaged. Averaging per-artist
percentages weights a large swing on a small artist equally with a small swing on a
large one, which is simply wrong. Instead each artist's previous-period figure is
recovered as `value / (1 + delta)`, those are summed, and the two totals compared.

Two consequences. Spotify rounds each delta to a whole percent, so the recovered
figures inherit that rounding — the result is accurate to roughly a tenth of a percent,
not exact. And if any artist lacks a delta, the percentage is omitted entirely rather
than computed from partial data.

**Rendering.** The total row is a clone of a real row: other cells are emptied, but the
value cell is edited in place, so the row inherits the page's column widths, padding,
borders and theme (light and dark) without referencing any class. The badge is cloned
from a row whose delta points the same direction, so its colour and arrow are already
correct. The label is excluded from width calculation — it is wider than any artist
name, and a column sizes to its widest cell, which would otherwise push the Streams
column out of alignment. The row carries `data-s4a-total` and is skipped during
parsing, so it never counts itself.

**Lifecycle.** A debounced `MutationObserver` plus a URL watcher handle the SPA's
re-renders and client-side navigation.

## Layout

```
manifest.json        MV3, no permissions
src/content.js       parsing, math, rendering
src/styles.css       the row's own styling only
build-snippet.js     bundles the above into a console-pasteable block
test/*.html          fixtures, each loading src/content.js directly
```

## Development

```
npx serve -l 4599 .
```

Open the fixtures under `/test/`. They load the real content script, so what you test
is what ships. Between them they cover `<table>`, ARIA grid and `div` layouts,
English and French headers, abbreviated and European number formats, live period
switching, and a roster with no delta badges. Each fixture documents its expected
output in a comment.

`?s4aDebug=1` on any page logs the matched structure, headers, chosen column and
parsed rows to the console, prefixed `[S4A Totals]`.

## Without installing

`node build-snippet.js` writes `dist/console-snippet.js` — the script and its styles as
one self-contained block to paste into DevTools on the roster page. Chrome blocks the
first console paste until you type `allow pasting`. Lasts until reload.

## Limitations

- Reads only what the page renders; no API access, so no history and no data beyond
  the current view.
- Depends on the page's rendered structure. Spotify redesigns break DOM scrapers by
  nature; the layered fallbacks are meant to absorb that, not to guarantee immunity.
- Percentage precision is bounded by Spotify's rounding, as described above.
