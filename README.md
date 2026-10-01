# Keeper Audio - Roster Overview

Chrome extension (Manifest V3) that adds a summary line under the artist rows on the
Spotify for Artists roster page, `artists.spotify.com/c/roster`. Spotify shows
per-artist figures but no roster-wide total; this fills that gap in place.

```
Roster Overview   <streams>  ▼ <change>   ≈ € *, * * * @ €0.0022/stream
                                        👁  ≈ € *, * * * artist share @ 40%
                                            ≈ € *, * * * all platforms (80% Spotify, others @ €0.0030/stream)
                                                                                    © Keeper Audio
```

Amounts are hidden by default — the roster gets shown in meetings and pasted into
screenshots. The eye, aligned under the header's overflow control, reveals them. The
mask runs one asterisk per digit so a hidden figure holds the same space as the real
one, and they hide again on the next page load.

All figures in this README and in the test fixtures are placeholders.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked**, and select this folder
4. Open the roster page and refresh

Works in any Chromium browser. Requests no permissions, makes no network calls, and runs
only on `artists.spotify.com`.

Chrome loads unpacked extensions from a fixed path, so moving this folder breaks the
install. After editing the source, press **↻** on the extension card, then reload the
page.

## What the line shows

| Field | Meaning |
|---|---|
| Streams | Sum of the Streams column for the selected period |
| Change | Combined change against the previous period, weighted by volume |
| Gross | Estimated royalties: streams × the per-stream rate |
| Artist share | Estimated share of that gross reaching the artist |
| All platforms | The artist share scaled up to every store, stacked under it |
| 👁 | Reveals the amounts, hidden by default |

It recalculates on its own when you switch period (24 hours / 7 days / 28 days /
12 months), sort or filter. It appears on the **Artists** tab only — the Releases tab
lists releases, not per-artist streams.

## Settings

Both inputs are assumptions, so both are adjustable. Run these in the console on the
roster page; values persist per browser.

| Key | Default | Meaning |
|---|---|---|
| `s4aRatePerStream` | `0.0022` | Euro per stream |
| `s4aArtistShare` | `0.4` | Fraction reaching the artist; `40` also accepted |
| `s4aSpotifyShare` | `0.8` | Spotify's fraction of all streams; `80` also accepted |
| `s4aOtherRatePerStream` | `0.003` | Euro per stream on every other store |

```js
localStorage.setItem('s4aRatePerStream', '0.0018')
localStorage.setItem('s4aArtistShare', '0.5')
localStorage.setItem('s4aSpotifyShare', '0.89')
localStorage.setItem('s4aOtherRatePerStream', '0.0038')
```

## How it works

**Finding the roster.** Spotify's class names are obfuscated and change without notice,
so none are referenced. Three strategies run in order: a real `<table>`; an ARIA grid;
then repeated sibling elements each holding exactly one artist link, which covers plain
`div` layouts.

**Picking the column.** The roster has several numeric columns, so the Streams column is
identified by header text (`stream`, `écoute`, `reproducciones`, `wiedergaben`,
`ascolti`, then listeners, then followers). Failing that, the header label is matched
geometrically to the column beneath it; failing that, the column with the largest median
wins.

**Reading the numbers.** The streams cell holds a count and a delta badge, and the two
resist separation: `innerText` concatenates them with no delimiter, while the DOM splits
the delta's digits from its `%` sign. Cells are therefore read text node by text node
for the count, and the rejoined text is used for the percentage. Thousands separators
(`,` `.` space) and `K`/`M`/`B` suffixes are handled.

**The percentage** is derived, not averaged. Averaging per-artist percentages weights a
large swing on a small artist equally with a small swing on a large one. Instead each
artist's previous-period figure is recovered as `value / (1 + delta)`, those are summed,
and the two totals compared. Spotify rounds each delta to a whole percent, so the result
is good to roughly a tenth of a percent. If any artist lacks a delta, the percentage is
omitted rather than computed from partial data.

**The royalty figures** are estimates, not earnings. Spotify has no per-stream rate: it
pools revenue per market and divides it by share of streams, so the effective rate moves
with listener geography and paid-versus-free mix, ranging from a fraction of the default
to several times it. The default is a working figure taken from a real distributor
statement rather than a published average; for reference the measured global blend in
early 2026 was about €0.0032. Watch for promotion programmes such as Discovery Mode:
they bill as a separate negative line against streams already paid for, so the rate
after them is lower than the stream lines alone suggest. Gross is what reaches the rights holder before distributor and label
splits; the artist share multiplies a second assumption on top of that. For an accurate
figure, divide Spotify revenue by Spotify streams on a distributor statement covering
the same period, and set that as the rate.

**The all-platform line** extends the artist share: that figure covers Spotify alone, so
dividing it by Spotify's fraction of all streams gives the artist's income everywhere,
on the assumption that the other stores pay roughly the same per stream. Both halves are rough. The share varies widely by catalogue — two
real statements put Spotify at 59% and 78% of revenue — and the other stores generally
pay *more* per stream than Spotify, so the result reads as a floor rather than a
midpoint. A distributor report broken down by store gives you the real share.

**Rendering.** The line is a clone of a real roster row: other cells are emptied, but the
value cell is edited in place, so it inherits the page's column widths, padding, borders
and theme without referencing any class. The label is excluded from width calculation,
since a column sizes itself to its widest cell and would otherwise push the Streams
column out of alignment. The line and its credit are both marked `data-s4a-total`, so
parsing skips them and a re-render clears both together.

**Lifecycle.** The first render is immediate; later ones are debounced behind a
`MutationObserver`. There is no polling timer — client-side navigation comes through the
Navigation API, with a mutation-based fallback. The observer watches the whole body,
with attributes filtered to `aria-selected`: the page produces about one mutation batch
every three seconds at rest, and the tab controls sit outside the roster container, so
scoping it narrower broke tab detection. Discovery is cached against the container it
found; a repeat parse costs roughly 0.1ms.

## Layout

```
manifest.json        MV3, no permissions
src/content.js       parsing, math, rendering
src/styles.css       the line's own styling
build-snippet.js     bundles the above into a console-pasteable block
test/*.html          fixtures, each loading src/content.js directly
```

## Tests

```
npx serve -l 4599 .
```

Open the fixtures under `/test/`. They load the real content script, so what you test is
what ships. Between them they cover `<table>`, ARIA grid and `div` layouts, English and
French headers, abbreviated and European number formats, live period switching, an
Artists/Releases round trip, and a roster with no delta badges. Each fixture documents
its expected output in a comment.

## Troubleshooting

Add `?s4aDebug=1` to the URL and open the console. The script logs which structure it
matched, the headers it saw, the chosen column and every parsed row, prefixed
`[S4A Totals]`.

## Without installing

`node build-snippet.js` writes `dist/console-snippet.js`: the script and its styles as
one self-contained block to paste into DevTools on the roster page. Chrome blocks the
first console paste until you type `allow pasting`. It lasts until the page reloads.

## Limitations

- Reads only what the page renders. No API access, so no history and no data beyond the
  current view.
- Depends on the page's rendered structure. Redesigns break DOM scrapers by nature; the
  layered fallbacks absorb that rather than prevent it.
- Royalty figures rest on assumed inputs and are not reported earnings.
