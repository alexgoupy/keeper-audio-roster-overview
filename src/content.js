/* S4A Roster Totals
 * Appends a "Total" line under the artist rows on the Spotify for Artists roster
 * page, summing the Streams column for whichever period is selected.
 *
 * Spotify ships obfuscated class names, so nothing here targets them: the roster
 * is located structurally, the Streams column is identified by its header text
 * (with a geometric fallback), and the total line is a clone of a real row so it
 * inherits the page's own column widths, padding and theme.
 */
(() => {
  'use strict';

  const LOG = '[S4A Totals]';
  const FLAG = 'data-s4a-total';
  const DEBUG = /[?&]s4aDebug=1/.test(location.search);

  // Ordered by preference. The roster has several numeric columns
  // ("3 more", "2 tasks left"), so naming the right one matters.
  const METRICS = [
    { key: 'streams', label: 'streams', test: /stream|écoute|ecoute|reproduc|wiedergab|ascolt/i },
    { key: 'listeners', label: 'listeners', test: /listener|auditeur|oyente|hörer|horer/i },
    { key: 'followers', label: 'followers', test: /follower|abonn|seguidor|abbonat/i },
  ];

  const PERIOD = /^\s*\d+\s*(hours?|hrs?|days?|months?|heures?|jours?|mois|d[ií]as|tage|monate|mesi|giorni)\s*$/i;

  const debug = (...args) => { if (DEBUG) console.log(LOG, ...args); };

  /* ---------------------------------------------------------------- numbers */

  // "1,234,567" · "1.234.567" · "1 234 567" · "12.3K" · "4,5 M"
  function parseCount(input) {
    if (input == null) return null;
    let s = String(input).replace(/[   ]/g, ' ').trim();
    if (!s) return null;

    const suffix = s.match(/([kmb])\s*$/i);
    let multiplier = 1;
    if (suffix) {
      multiplier = { k: 1e3, m: 1e6, b: 1e9 }[suffix[1].toLowerCase()];
      s = s.slice(0, suffix.index).trim();
    }
    if (!/^\d[\d.,\s]*$/.test(s)) return null;

    s = s.replace(/\s/g, '');
    const hasDot = s.includes('.');
    const hasComma = s.includes(',');

    if (hasDot && hasComma) {
      const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      const thousands = decimal === '.' ? ',' : '.';
      s = s.split(thousands).join('').replace(decimal, '.');
    } else if (hasDot || hasComma) {
      const sep = hasDot ? '.' : ',';
      const parts = s.split(sep);
      const tail = parts[parts.length - 1];
      if (parts.length > 2 || (tail.length === 3 && multiplier === 1)) {
        s = parts.join('');
      } else {
        s = parts.slice(0, -1).join('') + '.' + tail;
      }
    }

    const value = Number(s);
    return Number.isFinite(value) ? Math.round(value * multiplier) : null;
  }

  const textOf = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');

  // The streams cell holds the count and a delta badge ("1,200,000" + "-9%"),
  // and innerText glues them together with no separator. So read the cell's text
  // nodes individually, in document order, and take the first that is a count
  // rather than a delta.
  const NUMBER_TOKEN = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+(?:[.,]\d+)*/g;

  function textNodesIn(el) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) !== null) nodes.push(node);
    return nodes;
  }

  function textPieces(el) {
    return textNodesIn(el)
      .map((node) => node.nodeValue.replace(/[\u00a0\u202f\u2009]/g, ' ').trim())
      .filter(Boolean);
  }

  function firstNumberIn(el) {
    for (const piece of textPieces(el)) {
      // "1,500,000 2%" in a single node: drop the trailing delta, keep the count.
      const cleaned = piece.replace(/\s[+-]?\d[\d.,]*\s*%/g, ' ').trim();
      if (!cleaned) continue;

      NUMBER_TOKEN.lastIndex = 0;
      let match;
      while ((match = NUMBER_TOKEN.exec(cleaned)) !== null) {
        const before = cleaned.slice(Math.max(0, match.index - 1), match.index);
        const after = cleaned.slice(match.index + match[0].length);
        if (/[+-]/.test(before)) continue;                 // "-9%"
        if (/^\s*%/.test(after)) continue;                 // "2%"
        const unit = after.match(/^\s*([KMB])\b/i);
        const value = parseCount(match[0] + (unit ? unit[1] : ''));
        if (value != null) return value;
      }
    }
    return null;
  }

  // The delta badge beside the count: "-9%" or "2%" (positive carries no sign;
  // direction is shown by colour and an arrow). Spotify splits it across text
  // nodes — ["1,200,000", "-9", "%"] — so the pieces are rejoined before
  // matching, with a space so the count cannot fuse onto the delta.
  function deltaIn(el) {
    const text = textPieces(el).join(' ');
    const matches = [...text.matchAll(/([+-]?)(\d+(?:[.,]\d+)?)\s*%/g)];
    if (!matches.length) return null;
    const [, sign, digits] = matches[matches.length - 1];
    const value = parseFloat(digits.replace(',', '.'));
    if (!Number.isFinite(value)) return null;
    return sign === '-' ? -value : value;
  }

  /* ------------------------------------------------------------ row finding */

  // Laid out at all: a display:none element measures 0 x 0, while a real row in
  // a zero-width viewport (a hidden or collapsed pane) still has height. Testing
  // both dimensions together would disable the feature in that case.
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function nameIn(row) {
    const link = row.querySelector('a[href*="artist"]') || row.querySelector('a');
    const img = row.querySelector('img');
    const candidates = [link && textOf(link), link && link.getAttribute('aria-label'), img && img.getAttribute('alt')];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const first = String(candidate).split('\n')[0].trim();
      if (first && parseCount(first) == null) return first;
    }
    for (const line of textOf(row).split('\n')) {
      const clean = line.trim();
      if (clean && parseCount(clean) == null) return clean;
    }
    return '(unnamed)';
  }

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  // Fallback when header cells aren't part of the row structure: find the
  // "Streams" label anywhere on the page and match it to the cell underneath it.
  function columnByGeometry(cellsPerRow, usableIndexes) {
    // Matching on an element's OWN text rather than requiring a leaf: the
    // Streams header carries an overflow button beside its label, which makes
    // the cell a non-leaf and used to hide it from this search entirely.
    const ownText = (el) => [...el.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.nodeValue)
      .join(' ')
      .trim();

    const labels = [...document.querySelectorAll('th, [role="columnheader"], span, div, button, p')]
      .filter((el) => !el.hasAttribute(FLAG) && isVisible(el))
      .map((el) => ({ el, text: ownText(el) }))
      .filter(({ text }) => text && text.length < 40 && METRICS.some((m) => m.test.test(text)));
    if (!labels.length) return null;

    const sample = cellsPerRow[0];
    for (const metric of METRICS) {
      const label = labels.find(({ text }) => metric.test.test(text));
      if (!label) continue;
      const headRect = label.el.getBoundingClientRect();
      let best = null;
      for (const index of usableIndexes) {
        const cell = sample[index];
        if (!cell) continue;
        const rect = cell.getBoundingClientRect();
        const overlap = Math.min(rect.right, headRect.right) - Math.max(rect.left, headRect.left);
        if (overlap > 0 && (!best || overlap > best.overlap)) best = { index, overlap };
      }
      if (best) {
        debug('column matched geometrically', { header: label.text, index: best.index });
        return { index: best.index, metric, headerText: label.text };
      }
    }
    return null;
  }

  function analyzeRows(rows, cellSel, headers) {
    if (rows.length < 2) return null;
    const cellsPerRow = rows.map((row) => [...row.querySelectorAll(cellSel)]);

    const hits = new Map();
    const samples = new Map();
    cellsPerRow.forEach((cells) => {
      cells.forEach((cell, index) => {
        const value = firstNumberIn(cell);
        if (value == null) return;
        hits.set(index, (hits.get(index) || 0) + 1);
        samples.set(index, [...(samples.get(index) || []), value]);
      });
    });
    if (!hits.size) return null;

    const threshold = Math.max(2, Math.floor(rows.length * 0.6));
    const usable = [...hits.entries()].filter(([, count]) => count >= threshold).map(([index]) => index);
    if (!usable.length) return null;

    let chosen = null;
    let metric = null;
    let headerText = '';

    for (const candidate of METRICS) {
      const index = usable.find((i) => headers[i] && candidate.test.test(headers[i]));
      if (index != null) { chosen = index; metric = candidate; headerText = headers[index]; break; }
    }

    if (chosen == null) {
      const geometric = columnByGeometry(cellsPerRow, usable);
      if (geometric) { chosen = geometric.index; metric = geometric.metric; headerText = geometric.headerText; }
    }

    if (chosen == null) {
      // Last resort: stream counts dwarf "3 more" / "2 tasks left".
      const ranked = [...usable].sort((a, b) => median(samples.get(b)) - median(samples.get(a)));
      chosen = ranked[0];
      metric = METRICS[0];
      headerText = headers[chosen] || '';
      debug('column chosen by magnitude', { index: chosen, medians: usable.map((i) => [i, median(samples.get(i))]) });
    }

    const parsed = [];
    let skipped = 0;
    cellsPerRow.forEach((cells, i) => {
      const value = firstNumberIn(cells[chosen]);
      if (value == null) { skipped += 1; return; }
      parsed.push({ name: nameIn(rows[i]), value, delta: deltaIn(cells[chosen]), el: rows[i] });
    });
    if (!parsed.length) return null;

    debug('parsed', { headers, column: chosen, headerText, rows: parsed, skipped });
    return {
      rows: parsed, metric, skipped, headerText, headers,
      cellSel, columnIndex: chosen,
      sampleRow: rows[rows.length - 1],
      lastRow: rows[rows.length - 1],
    };
  }

  function parseGrid(root, headerSel, rowSel, cellSel) {
    const headers = [...root.querySelectorAll(headerSel)].map(textOf);
    const rows = [...root.querySelectorAll(rowSel)].filter((row) => {
      if (row.hasAttribute(FLAG) || row.closest(`[${FLAG}]`)) return false;   // our own line
      if (row.querySelectorAll(headerSel).length >= 2) return false;          // header row
      if (row.querySelectorAll(cellSel).length < 2) return false;
      return isVisible(row);
    });
    return analyzeRows(rows, cellSel, headers);
  }

  // Div soup with obfuscated classes: the rows are the repeated siblings that
  // each contain exactly one artist link.
  function parseRepeated() {
    const links = [...document.querySelectorAll('a[href*="artist"]')].filter(isVisible);
    if (links.length < 2) return null;

    const groups = new Map();
    for (const link of links) {
      let node = link;
      for (let depth = 0; depth < 8 && node.parentElement; depth += 1) {
        node = node.parentElement;
        if (node.hasAttribute(FLAG)) break;
        if (node.querySelectorAll('a[href*="artist"]').length !== 1) break;
        const key = `${node.tagName}|${node.getAttribute('class') || ''}`;
        const siblings = [...node.parentElement.children].filter(
          (el) => `${el.tagName}|${el.getAttribute('class') || ''}` === key && !el.hasAttribute(FLAG)
        );
        if (siblings.length >= 2) {
          const current = groups.get(key);
          if (!current || siblings.length > current.length) groups.set(key, siblings);
          break;
        }
      }
    }
    if (!groups.size) return null;

    let rows = [...groups.values()]
      .sort((a, b) => b.length - a.length)[0]
      .filter((row) => row.querySelector('a[href*="artist"]') && isVisible(row));

    // A row may wrap its columns in a single container.
    if (rows[0] && rows[0].children.length < 2) {
      const unwrapped = rows.map((row) => row.firstElementChild).filter(Boolean);
      if (unwrapped[0] && unwrapped[0].children.length >= 2) rows = unwrapped;
    }

    debug('repeated-sibling rows', rows.length);
    return analyzeRows(rows, ':scope > *', []);
  }

  // Discovery walks every table and grid on the page and can fall back to
  // geometry, which reads hundreds of bounding boxes. The answer almost never
  // changes, so it is kept and reused while the container it found is still in
  // the document; only a real teardown forces the search again.
  let cached = null;

  function discover() {
    for (const table of document.querySelectorAll('table')) {
      const parsed = parseGrid(table, 'th', 'tbody tr, tr', 'td, th');
      if (parsed) return { ...parsed, source: 'table', root: table, args: ['th', 'tbody tr, tr', 'td, th'] };
    }
    for (const grid of document.querySelectorAll('[role="table"], [role="grid"], [role="treegrid"], [role="list"], ul, ol')) {
      const args = [
        '[role="columnheader"], th',
        '[role="row"], [role="listitem"], li',
        '[role="gridcell"], [role="cell"], [role="rowheader"], td, th',
      ];
      const parsed = parseGrid(grid, args[0], args[1], args[2]);
      if (parsed) return { ...parsed, source: 'grid', root: grid, args };
    }
    const repeated = parseRepeated();
    if (repeated) return { ...repeated, source: 'repeated', root: null, args: null };
    return null;
  }

  function collectRoster() {
    if (cached && cached.root && cached.root.isConnected) {
      const again = parseGrid(cached.root, cached.args[0], cached.args[1], cached.args[2]);
      if (again) return { ...again, source: cached.source, root: cached.root, args: cached.args };
    }
    cached = discover();
    if (cached) debug('discovered roster via', cached.source);
    return cached;
  }

  /* ------------------------------------------------------------ the period */

  function activePeriod() {
    const options = [...document.querySelectorAll('button, [role="tab"], [role="radio"], [role="option"], a')]
      .filter((el) => PERIOD.test(textOf(el)) && isVisible(el));
    if (options.length < 2) return null;

    const flagged = options.find((el) => (
      el.getAttribute('aria-pressed') === 'true' ||
      el.getAttribute('aria-selected') === 'true' ||
      el.getAttribute('aria-current') === 'true' ||
      el.dataset.active === 'true' ||
      /(^|[\s_-])(active|selected|current)([\s_-]|$)/i.test(el.className)
    ));
    if (flagged) return textOf(flagged).trim();

    // No ARIA state: the selected pill is the one styled differently.
    const counts = new Map();
    const styles = options.map((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      counts.set(bg, (counts.get(bg) || 0) + 1);
      return { el, bg };
    });
    const odd = styles.filter(({ bg }) => counts.get(bg) === 1);
    return odd.length === 1 ? textOf(odd[0].el).trim() : null;
  }

  /* ----------------------------------------------------------------- render */

  const formatNumber = (n) => new Intl.NumberFormat(undefined).format(n);

  /* --------------------------------------------------------------- royalty */

  // Spotify has no per-stream rate. It pools subscription and ad revenue per
  // market and divides each artist's share of streams into it, so the effective
  // rate moves with listener country, paid-vs-free mix, and the month's totals.
  //
  // The spread is wide and driven mostly by listener geography:
  //   India    ~EUR 0.0007      France  ~EUR 0.0033      UK      ~EUR 0.0039
  //   Brazil   ~EUR 0.0009      US      ~EUR 0.0034      Nordics ~EUR 0.0069
  // Free-tier streams pay a fraction of Premium ones, which is why markets with
  // low paid penetration sit at the bottom of that list. For reference, the
  // measured global blend in early 2026 was about EUR 0.0032; a roster with
  // reach in lower-paying markets lands under it.
  //
  // The default below is a working figure derived from a real distributor
  // statement rather than a published average, and it sits under the global
  // blend: an estimate that disappoints is better than one that flatters.
  //
  // Two things that statement made obvious, and that a published average hides.
  // Promotion programmes such as Discovery Mode are billed as a separate
  // negative line against streams you have already been paid for, so the rate
  // after them is materially lower than the rate on the stream lines alone.
  // And the territory mix moves the result more than anything else.
  //
  // So the reliable number is your own — take a distributor statement, divide
  // the Spotify revenue by the Spotify streams for the same period, net of any
  // promotion lines, and set that:
  //   localStorage.setItem('s4aRatePerStream', '0.0031')
  const DEFAULT_RATE_EUR = 0.0022;

  // The cut reaching the artist after the distributor's and label's shares.
  // Every deal differs, so this is a placeholder you should set to your own:
  //   localStorage.setItem('s4aArtistShare', '0.5')   // or '50'
  const DEFAULT_ARTIST_SHARE = 0.40;

  // The roster counts Spotify streams only, so the rest of the catalogue's
  // volume is inferred from Spotify's share of all streams. Measured on a real
  // statement, Spotify ran at about 89% of streams for one project and far less
  // for another, so this is the least stable input of the three. Set your own:
  //   localStorage.setItem('s4aSpotifyShare', '0.89')   // or '89'
  const DEFAULT_SPOTIFY_SHARE = 0.80;

  // The other stores pay more per stream than Spotify, so they get their own
  // rate rather than being assumed equivalent. Two statements from different
  // catalogues and distributors put the non-Spotify average at EUR 0.00287 and
  // EUR 0.00261 (EUR 0.00305 once a near-worthless social and locker volume was
  // excluded), which this sits in the middle of:
  //   localStorage.setItem('s4aOtherRatePerStream', '0.0038')
  const DEFAULT_OTHER_RATE_EUR = 0.0030;

  function royaltyRate() {
    try {
      const stored = Number(localStorage.getItem('s4aRatePerStream'));
      if (Number.isFinite(stored) && stored > 0) return stored;
    } catch (error) { /* storage unavailable; fall through to the default */ }
    return DEFAULT_RATE_EUR;
  }

  function artistShare() {
    try {
      const stored = Number(localStorage.getItem('s4aArtistShare'));
      // Accepts either a fraction (0.4) or a percentage (40).
      if (Number.isFinite(stored) && stored > 0) return stored > 1 ? stored / 100 : stored;
    } catch (error) { /* storage unavailable; fall through to the default */ }
    return DEFAULT_ARTIST_SHARE;
  }

  function otherRate() {
    try {
      const stored = Number(localStorage.getItem('s4aOtherRatePerStream'));
      if (Number.isFinite(stored) && stored > 0) return stored;
    } catch (error) { /* storage unavailable; fall through to the default */ }
    return DEFAULT_OTHER_RATE_EUR;
  }

  function spotifyShare() {
    try {
      const stored = Number(localStorage.getItem('s4aSpotifyShare'));
      // Accepts either a fraction (0.75) or a percentage (75).
      const value = stored > 1 ? stored / 100 : stored;
      if (Number.isFinite(value) && value > 0 && value <= 1) return value;
    } catch (error) { /* storage unavailable; fall through to the default */ }
    return DEFAULT_SPOTIFY_SHARE;
  }

  const formatPercent = (fraction) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(fraction * 100);

  const formatEuros = (amount) => new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: amount < 100 ? 2 : 0,
  }).format(amount);

  const formatRate = (rate) => new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(rate);

  // The Release column, so the estimate sits clear of the figures it derives
  // from. Falls back to the column just right of the streams one.
  function releaseColumnIndex(headers, cellCount, valueIndex) {
    const found = headers.findIndex((header) => header &&
      /release|sortie|lanzamiento|ver[oö]ffentlich|uscita/i.test(header) &&
      !/checklist|check-list|liste|aufgaben/i.test(header));
    if (found !== -1 && found !== valueIndex) return found;
    const next = valueIndex + 1;
    return next < cellCount ? next : -1;
  }

  // Amounts start hidden: the roster page gets shown in meetings and shared in
  // screenshots, and revenue is not something to put on screen by default. The
  // eye reveals them, and the choice holds until the page is reloaded.
  // One asterisk per digit, spaced apart, with the currency symbol and grouping
  // left in place: "€22,154" reads "€ * *, * * *".
  function maskAmount(text) {
    let out = '';
    for (const character of String(text)) {
      if (!/\d/.test(character)) { out += character; continue; }
      out += out ? ' *' : '*';
    }
    return out;
  }
  let amountsHidden = true;

  const EYE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';

  const EYE_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M17.9 17.9A10.1 10.1 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9m3.8-1.9A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2m-6.7-1.1a3 3 0 1 1-4.2-4.2"/>' +
    '<line x1="1" y1="1" x2="23" y2="23"/></svg>';

  // Repaints every amount in the line, and the tooltips, which quote the same
  // figures and would otherwise give them away on hover.
  function paintAmounts(root) {
    root.querySelectorAll('.s4a-total-royalty-value').forEach((el) => {
      const amount = el.dataset.amount || '';
      const masked = `≈ ${maskAmount(amount)}`;
      const plain = `≈ ${amount}`;

      // Pin the slot to whichever of the two is wider — the spaced mask is the
      // wider one — so revealing or hiding cannot shift the caption beside it.
      if (el.isConnected && !el.style.minWidth) {
        el.textContent = plain;
        const bare = el.getBoundingClientRect().width;
        el.textContent = masked;
        const hidden = el.getBoundingClientRect().width;
        const widest = Math.max(bare, hidden);
        if (widest) el.style.minWidth = `${Math.ceil(widest)}px`;
      }

      el.textContent = amountsHidden ? masked : plain;
    });
    root.querySelectorAll('.s4a-total-royalty').forEach((el) => {
      if (!el.dataset.detail) return;
      if (amountsHidden) el.removeAttribute('title');
      else el.setAttribute('title', el.dataset.detail);
    });
    const eye = root.querySelector('.s4a-total-eye');
    if (eye) {
      eye.innerHTML = amountsHidden ? EYE_OFF : EYE;   // struck through while hidden
      eye.setAttribute('aria-pressed', String(!amountsHidden));
      eye.setAttribute('aria-label', amountsHidden ? 'Show amounts' : 'Hide amounts');
      eye.setAttribute('title', amountsHidden ? 'Show amounts' : 'Hide amounts');
    }
  }

  // The overflow control at the right of the Streams column header. On the real
  // page it is an icon-only button, not text, so three ways of recognising it:
  // a run of dots written out, a control that names itself in aria-label, or an
  // icon button sitting in the header with no words at all.
  function headerEllipsis(root, nearX) {
    const scope = root && root.isConnected ? root : document;
    const head = scope.querySelector('thead') ||
      scope.querySelector('[role="rowgroup"]') ||
      scope;

    const ownText = (el) => [...el.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.nodeValue)
      .join('')
      .trim();

    const candidates = [...head.querySelectorAll('*')].filter((el) =>
      !el.hasAttribute(FLAG) && !el.closest(`[${FLAG}]`) && isVisible(el));

    // Nearest to the Streams column wins, so a header with several icon
    // buttons still resolves to the one beside the figures.
    const nearest = (list) => {
      if (!list.length) return null;
      if (!Number.isFinite(nearX)) return list[0];
      return list.reduce((best, el) => {
        const distance = Math.abs(el.getBoundingClientRect().left - nearX);
        return !best || distance < best.distance ? { el, distance } : best;
      }, null).el;
    };

    const dots = candidates.filter((el) =>
      /^[.\u00b7\u2022\u2026\u22ef]{2,}$/.test(ownText(el).replace(/\s+/g, '')));
    if (dots.length) return nearest(dots);

    const named = candidates.filter((el) =>
      /more|option|menu|column|colonne|param/i.test(
        `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`));
    if (named.length) return nearest(named);

    const iconOnly = candidates
      .filter((el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button')
      .filter((el) => !ownText(el) && !el.textContent.trim() && el.querySelector('svg'));
    return nearest(iconOnly);
  }

  // The eye takes no width of its own — the button is a zero-width box and the
  // icon is painted off it with a transform, which does not affect layout. That
  // way it can be placed anywhere along the row without dragging the figure
  // beside it, which a margin would.
  function positionEye(line, data) {
    const eye = line.querySelector('.s4a-total-eye');
    const icon = eye && eye.firstElementChild;
    if (!eye || !icon || !eye.isConnected) return;

    icon.style.transform = 'none';
    const from = icon.getBoundingClientRect();

    // The right edge of the Streams column, which is where that control sits.
    let nearX;
    if (data && data.sampleRow && data.cellSel) {
      const valueCell = [...data.sampleRow.querySelectorAll(data.cellSel)][data.columnIndex];
      if (valueCell) nearX = valueCell.getBoundingClientRect().right;
    }
    const target = headerEllipsis(data && data.root, nearX);
    const to = target ? target.getBoundingClientRect() : null;

    // Without a target, sit just left of the figure instead.
    const delta = to ? to.left - from.left : -(from.width + 7);
    icon.style.transform = `translateX(${Math.round(delta)}px)`;
  }

  function eyeToggle() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 's4a-total-eye';
    button.innerHTML = EYE_OFF;   // amounts start hidden
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      amountsHidden = !amountsHidden;
      const row = button.closest(`[${FLAG}]`);
      if (row) { paintAmounts(row); positionEye(row, lastData); }
    });
    return button;
  }

  function estimateNode(amount, caption, title) {
    const wrap = document.createElement('span');
    wrap.className = 's4a-total-royalty';
    wrap.dataset.detail = title;

    const value = document.createElement('span');
    value.className = 's4a-total-royalty-value';
    value.dataset.amount = formatEuros(amount);

    const note = document.createElement('span');
    note.className = 's4a-total-rate';
    note.textContent = ` ${caption}`;

    wrap.append(value, note);
    return wrap;
  }

  function grossNode(total, count) {
    const rate = royaltyRate();
    return estimateNode(
      total * rate,
      `@ ${formatRate(rate)}/stream`,
      `Estimated gross royalties for the selected period: ${formatNumber(total)} streams ` +
      `across ${count} artists x ${formatRate(rate)}. That default is the measured global ` +
      `blended rate (~$0.00363/stream, Jan 2026) converted to euros. Real rates run from ` +
      `~EUR 0.0007 (India) to ~EUR 0.0069 (Nordics) depending on where listeners are and ` +
      `whether they pay; a Western European audience sits nearer EUR 0.0033-0.0039. Gross to ` +
      `the rights holder, before the distributor's cut. For an accurate figure use your own: ` +
      `localStorage.setItem('s4aRatePerStream', '0.0031').`);
  }

  function shareNode(total) {
    const share = artistShare();
    const percent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(share * 100);
    return estimateNode(
      total * royaltyRate() * share,
      `artist share @ ${percent}%`,
      `Estimated artist share: ${percent}% of the gross estimate beside it, i.e. what ` +
      `reaches the artist after distributor and label cuts. This split is a placeholder — ` +
      `set your own with localStorage.setItem('s4aArtistShare', '0.5').`);
  }

  // Sits under the artist share and extends it. The roster only counts Spotify
  // streams, so the rest of the volume is inferred from Spotify's share of all
  // streams and paid at its own rate, which is higher than Spotify's.
  function allPlatformsNode(total) {
    const spotify = spotifyShare();
    const artist = artistShare();
    const onSpotify = total * royaltyRate();
    const elsewhereStreams = total * ((1 - spotify) / spotify);
    const elsewhere = elsewhereStreams * otherRate();
    const everywhere = (onSpotify + elsewhere) * artist;

    const node = estimateNode(
      everywhere,
      `all platforms (${formatPercent(spotify)}% Spotify, others @ ${formatRate(otherRate())}/stream)`,
      `Estimated artist income across every store, for the selected period. ` +
      `${formatNumber(total)} Spotify streams at ${formatRate(royaltyRate())} = ` +
      `${formatEuros(onSpotify)}. Spotify is taken as ${formatPercent(spotify)}% of all ` +
      `streams, implying ${formatNumber(Math.round(elsewhereStreams))} elsewhere at ` +
      `${formatRate(otherRate())} = ${formatEuros(elsewhere)}. The artist's ` +
      `${formatPercent(artist)}% of the combined ${formatEuros(onSpotify + elsewhere)} is ` +
      `${formatEuros(everywhere)}. Set your own with ` +
      `localStorage.setItem('s4aSpotifyShare', '0.89') and ` +
      `localStorage.setItem('s4aOtherRatePerStream', '0.0038').`);
    node.classList.add('s4a-total-everywhere');
    return node;
  }

  // The release column's trailing pill ("3 more"), taken from a real row.
  function trailingPill(row, cellSel, releaseIndex) {
    if (!row || releaseIndex === -1) return null;
    const cell = [...row.querySelectorAll(cellSel)][releaseIndex];
    if (!cell) return null;
    return [...cell.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && /^\s*\d+\s+\S+\s*$/.test(el.textContent || ''))
      .pop() || null;
  }

  // Line the stack up with that pill by measuring, not by arithmetic. Working
  // out a margin from the pill's offset means reasoning about which box the
  // offset was measured from and which box the margin applies to, and a cell's
  // padding lands squarely between the two. Reading back where the stack
  // actually rendered and correcting the difference sidesteps all of that.
  function alignStackToPill(line, data, releaseIndex) {
    const stack = line.querySelector('.s4a-total-stack');
    if (!stack || !stack.isConnected) return;
    const pill = trailingPill(data.sampleRow, data.cellSel, releaseIndex);
    if (!pill) return;

    const target = pill.getBoundingClientRect().left;
    const marker = stack.querySelector('.s4a-total-royalty-value') || stack;
    const current = marker.getBoundingClientRect().left;
    if (!target || !current) return;

    const margin = (parseFloat(stack.style.marginLeft) || 0) + (target - current);
    stack.style.marginLeft = `${Math.round(margin)}px`;
  }

  // The Release checklist column, right of the gross estimate.  // The Release checklist column, right of the gross estimate.
  function checklistColumnIndex(headers, cellCount, taken) {
    const found = headers.findIndex((header) => header &&
      /checklist|check-list|aufgaben|lista de tareas/i.test(header));
    if (found !== -1 && !taken.includes(found)) return found;
    const last = cellCount - 1;
    return taken.includes(last) ? -1 : last;
  }

  const formatDelta = (d) => `${d < 0 ? '-' : ''}${Math.abs(d).toFixed(1).replace(/\.0$/, '')}%`;

  // A percentage for the roster as a whole. Averaging the per-artist percentages
  // would be wrong: it weights a 26% swing on 229k the same as 4% on 5.5M. So
  // instead each artist's previous-period figure is recovered from its own delta
  // (value / (1 + delta)), those are summed, and the two totals compared. That is
  // the real change in combined streams.
  //
  // Precision: the page rounds each delta to a whole percent, so the recovered
  // figures carry that rounding. The result is accurate to roughly a tenth of a
  // percent, not exact. If any artist is missing a delta, or a delta implies a
  // previous value of zero, no percentage is shown at all rather than a wrong one.
  function aggregateChange(rows) {
    if (!rows.length || rows.some((row) => row.delta == null)) return null;
    let previous = 0;
    for (const row of rows) {
      const factor = 1 + row.delta / 100;
      if (!(factor > 0)) return null;
      previous += row.value / factor;
    }
    if (!(previous > 0)) return null;
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return (total / previous - 1) * 100;
  }

  // Clone a row whose delta points the same way as the total's, so the badge
  // arrives with the right colour and arrow already on it.
  function pickDonor(data, change) {
    if (change == null) return data.sampleRow;
    const want = Math.sign(Number(change.toFixed(1)));
    const match = data.rows.find((row) => row.el && row.delta != null && Math.sign(row.delta) === want);
    return (match && match.el) || data.sampleRow;
  }


  // The text node holding the count, as opposed to the delta badge beside it.
  function countNodeIn(cell) {
    for (const node of textNodesIn(cell)) {
      const text = node.nodeValue.trim();
      if (!text || text.includes('%')) continue;
      NUMBER_TOKEN.lastIndex = 0;
      const match = NUMBER_TOKEN.exec(text);
      if (match && parseCount(match[0]) != null) return node;
    }
    return null;
  }

  // Drop the cloned row's "-28%" badge without disturbing the count beside it.
  function stripDelta(cell, countNode) {
    for (const node of textNodesIn(cell)) {
      if (!node.nodeValue.includes('%')) continue;
      let el = node.parentElement;
      while (el && el.parentElement && el.parentElement !== cell &&
             !(countNode && el.parentElement.contains(countNode))) {
        el = el.parentElement;
      }
      if (el && el !== cell && !(countNode && el.contains(countNode))) el.remove();
      else node.nodeValue = '';
      return;
    }
  }

  // Cloning a real row means the total line inherits the page's grid template,
  // padding, borders and theme without us knowing any of its class names. The
  // value cell keeps its internal structure too — only the number and the badge
  // inside it are rewritten — so the total lands on the same alignment as the
  // column above it instead of sitting off to one side.
  function buildTotalRow(data, total, change) {
    const row = pickDonor(data, change).cloneNode(true);
    row.setAttribute(FLAG, '1');
    row.classList.add('s4a-total-row');
    row.removeAttribute('id');
    row.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    row.querySelectorAll('a').forEach((a) => a.removeAttribute('href'));

    const cells = [...row.querySelectorAll(data.cellSel)];
    const valueCell = cells[data.columnIndex];

    // Every other column is emptied; the value column is edited in place.
    cells.forEach((cell) => { if (cell !== valueCell) cell.textContent = ''; });

    const countNode = valueCell ? countNodeIn(valueCell) : null;

    if (countNode) {
      countNode.nodeValue = formatNumber(total);
      const holder = countNode.parentElement && countNode.parentElement !== row
        ? countNode.parentElement
        : valueCell;
      if (holder) holder.classList.add('s4a-total-value');
    } else if (valueCell) {
      valueCell.textContent = '';
      const value = document.createElement('span');
      value.className = 's4a-total-value';
      value.textContent = formatNumber(total);
      valueCell.appendChild(value);
    }

    if (valueCell) {
      if (change == null) {
        stripDelta(valueCell, countNode);
      } else {
        writeDelta(valueCell, countNode, change, data.rows.length);
      }
    }

    const label = document.createElement('span');
    label.className = 's4a-total-label';
    label.textContent = 'Roster Overview';

    const headers = data.headers || [];
    const releaseIndex = releaseColumnIndex(headers, cells.length, data.columnIndex);
    if (releaseIndex !== -1 && cells[releaseIndex] && cells[releaseIndex] !== valueCell) {
      cells[releaseIndex].classList.add('s4a-total-cell');
      const gross = grossNode(total, data.rows.length);
      gross.prepend(eyeToggle());   // hangs to the left; see the negative margin
      cells[releaseIndex].appendChild(gross);
    }

    // The two artist figures stack in one zero-width wrapper, so neither can
    // widen a column. They sit under the release column's trailing pill ("3
    // more") when one can be found — measured off a real row rather than
    // guessed — and fall back to the checklist column otherwise.
    const stack = document.createElement('span');
    stack.className = 's4a-total-stack';
    stack.append(shareNode(total), allPlatformsNode(total));

    const pill = trailingPill(data.sampleRow, data.cellSel, releaseIndex);
    const shareIndex = checklistColumnIndex(headers, cells.length, [data.columnIndex, releaseIndex]);

    if (pill && cells[releaseIndex]) {
      cells[releaseIndex].appendChild(stack);   // positioned after layout
    } else if (shareIndex !== -1 && cells[shareIndex] && cells[shareIndex] !== valueCell) {
      cells[shareIndex].classList.add('s4a-total-cell');
      cells[shareIndex].appendChild(stack);
    }

    const labelIndex = data.columnIndex === 0 ? Math.min(1, cells.length - 1) : 0;
    const labelCell = cells[labelIndex];
    if (labelCell && labelCell !== valueCell) {
      labelCell.classList.add('s4a-total-cell');
      labelCell.appendChild(label);
    } else if (valueCell) {
      valueCell.prepend(label, document.createTextNode(' '));
    }

    paintAmounts(row);
    return row;
  }

  // Rewrite the cloned badge's number in place. The number and the "%" usually
  // sit in different text nodes, so only the numeric one is replaced and the
  // sign character, arrow glyph and percent sign are all left untouched.
  function writeDelta(cell, countNode, change, artistCount) {
    const text = formatDelta(change);
    const nodes = textNodesIn(cell).filter((node) => node !== countNode);
    const percentIndex = nodes.findIndex((node) => node.nodeValue.includes('%'));

    if (percentIndex !== -1) {
      const percentNode = nodes[percentIndex];
      const numberNode = /\d/.test(percentNode.nodeValue)
        ? percentNode
        : nodes.slice(0, percentIndex).reverse().find((node) => /\d/.test(node.nodeValue));

      if (numberNode === percentNode) {
        percentNode.nodeValue = percentNode.nodeValue.replace(/[+-]?\d+(?:[.,]\d+)?\s*%/, text);
      } else if (numberNode) {
        numberNode.nodeValue = text.replace(/%$/, '');   // the "%" node stays put
      } else {
        percentNode.nodeValue = text;
      }

      const badge = (numberNode || percentNode).parentElement;
      if (badge && badge !== cell) {
        badge.classList.add('s4a-total-delta');
        badge.setAttribute('title',
          `Combined change across all ${artistCount} artists, weighted by stream volume`);
      }
      return;
    }

    // The donor had no badge: append a plain one.
    const badge = document.createElement('span');
    badge.className = 's4a-total-delta';
    badge.textContent = ` ${text}`;
    badge.setAttribute('title',
      `Combined change across all ${artistCount} artists, weighted by stream volume`);
    cell.appendChild(badge);
  }

  // Used when there is no row to clone.
  function buildFallback(data, total, change) {
    const box = document.createElement('div');
    box.setAttribute(FLAG, '1');
    box.className = 's4a-total-fallback';
    box.innerHTML = `<span class="s4a-total-label"></span><span class="s4a-total-value"></span>`;
    box.querySelector('.s4a-total-label').textContent = 'Roster Overview';
    box.querySelector('.s4a-total-value').textContent =
      formatNumber(total) + (change == null ? '' : `  ${formatDelta(change)}`);
    const grossBox = grossNode(total, data.rows.length);
    grossBox.prepend(eyeToggle());
    box.append(grossBox, shareNode(total), allPlatformsNode(total));
    paintAmounts(box);
    return box;
  }

  const CREDIT = '\u00a9 Keeper Audio';

  // A second, flagged element under the total. Flagged so that parsing skips it
  // and so that a re-render clears it along with the row it belongs to.
  function buildCredit(line, cellSel) {
    if (line.tagName === 'TR') {
      const row = document.createElement('tr');
      row.setAttribute(FLAG, 'credit');
      row.className = 's4a-total-credit-row';
      const cell = document.createElement('td');
      cell.colSpan = Math.max(1, line.querySelectorAll(cellSel).length);
      cell.className = 's4a-total-credit';
      cell.textContent = CREDIT;
      row.appendChild(cell);
      return row;
    }
    const box = document.createElement('div');
    box.setAttribute(FLAG, 'credit');
    box.className = 's4a-total-credit';
    box.textContent = CREDIT;
    return box;
  }

  // The roster has two tabs, Artists and Releases, and only the first one holds
  // the per-artist stream figures this line totals. The Releases tab has its own
  // URL, but it is reached by a client-side navigation, so the tab's own
  // aria-selected state is checked as well as the path.
  const ARTISTS_TAB = /^(artists?|artistes?|k[üu]nstler|artistas|artisti)$/i;
  const RELEASES_TAB = /^(releases?|sorties?|lanzamientos?|ver[oö]ffentlichungen|uscite)$/i;

  function isArtistsView() {
    const path = location.pathname;
    if (!/roster/i.test(path)) return false;
    if (/releases?\/?$/i.test(path)) return false;

    const selected = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
      .map((tab) => (tab.textContent || '').trim())
      .find((text) => ARTISTS_TAB.test(text) || RELEASES_TAB.test(text));

    return !(selected && RELEASES_TAB.test(selected));
  }

  let lastSignature = null;
  let lastData = null;

  let render = function render(force = false) {
    const existing = [...document.querySelectorAll(`[${FLAG}]`)];
    const clear = () => existing.forEach((node) => node.remove());

    if (!isArtistsView()) {
      clear();
      lastSignature = null;
      return;
    }

    const data = collectRoster();
    lastData = data;
    if (!data) {
      clear();
      lastSignature = null;
      debug('no roster rows found yet');
      return;
    }

    const total = data.rows.reduce((sum, row) => sum + row.value, 0);
    const change = aggregateChange(data.rows);
    const period = activePeriod();
    const signature = `${total}|${change}|${data.rows.length}|${period}|${data.columnIndex}`;
    if (!force && signature === lastSignature && existing.length &&
        existing.every((node) => node.isConnected)) return;
    lastSignature = signature;

    const line = data.sampleRow
      ? buildTotalRow(data, total, change)
      : buildFallback(data, total, change);
    clear();
    data.lastRow.insertAdjacentElement('afterend', line);
    line.insertAdjacentElement('afterend', buildCredit(line, data.cellSel));
    // Repaint now that the row is laid out: the widths behind the mask can only
    // be measured once the text has a box, and alignment reads the result.
    paintAmounts(line);
    positionEye(line, data);
    alignStackToPill(line, data, releaseColumnIndex(data.headers || [],
      line.querySelectorAll(data.cellSel).length, data.columnIndex));

    debug('total', total, 'change', change, 'period', period, 'metric', data.metric.key, 'skipped', data.skipped);
  };

  /* ------------------------------------------------------------- lifecycle */

  // Renders are cheap (a parse costs a fraction of a millisecond) but they are
  // triggered by the page's own DOM churn, so they are debounced. The first one
  // runs immediately: waiting 300ms just to show a row that is already
  // computable is latency the reader can see.
  let timer = null;
  let firstRun = true;
  let writing = false;

  function schedule() {
    if (firstRun) {
      firstRun = false;
      render();
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(render, 300);
  }

  // A flag is cheaper than asking every mutation record whether it came from our
  // own row: on a busy page that was a closest() call per record.
  const observer = new MutationObserver(() => { if (!writing) schedule(); });

  const guard = (fn) => function () {
    writing = true;
    try { return fn.apply(this, arguments); } finally {
      // Let the observer drain our own records before listening again.
      setTimeout(() => { writing = false; }, 0);
    }
  };
  render = guard(render);

  let watching = false;

  function watch() {
    if (watching) return;
    // Body-wide on purpose. Scoping this to the roster's own container looks
    // like a saving, but measured on the live page the whole document produces
    // about one mutation batch every three seconds at rest, and the Artists /
    // Releases tabs sit outside that container: scoping it meant a tab switch
    // that does not change the URL went unnoticed. aria-selected is the only
    // attribute worth hearing about, so it is filtered to that one.
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    });
    watching = true;
  }

  function unwatch() {
    if (!watching) return;
    observer.disconnect();
    watching = false;
  }

  function onLocation() {
    lastSignature = null;
    cached = null;

    if (!/roster/i.test(location.pathname)) {
      unwatch();
      const existing = document.querySelector(`[${FLAG}]`);
      if (existing) existing.remove();
      return;
    }

    // Both tabs live under the roster path, so stay subscribed across a switch
    // between them rather than unsubscribing per tab. The URL changes before
    // the tab markup catches up, so a check run now can still read the old tab
    // as selected; an observer that had been disconnected would never hear the
    // correction, and the line would stay missing until a reload. render()
    // decides whether the line belongs; this only decides whether to listen.
    firstRun = true;
    watch();
    schedule();
  }

  // The script matches every page on the host so that a client-side navigation
  // into the roster is caught, but off the roster it does nothing beyond
  // listening for that navigation.
  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    window.navigation.addEventListener('navigate', () => setTimeout(onLocation, 0));
  } else {
    let lastUrl = location.href;
    const poll = new MutationObserver(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      onLocation();
    });
    poll.observe(document.body, { childList: true, subtree: true });
  }

  // The stacked estimates are positioned from a measurement taken at render
  // time, so a width change leaves that measurement stale. Resizing redraws.
  addEventListener('resize', () => { lastSignature = null; schedule(); });

  onLocation();
  debug('loaded on', location.href);
})();
