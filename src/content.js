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
    const labels = [...document.querySelectorAll('th, [role="columnheader"], span, div, button, p')]
      .filter((el) => !el.hasAttribute(FLAG) && el.children.length === 0 && isVisible(el))
      .map((el) => ({ el, text: textOf(el) }))
      .filter(({ text }) => text.length < 40 && METRICS.some((m) => m.test.test(text)));
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

  function collectRoster() {
    for (const table of document.querySelectorAll('table')) {
      const parsed = parseGrid(table, 'th', 'tbody tr, tr', 'td, th');
      if (parsed) return { ...parsed, source: 'table' };
    }
    for (const grid of document.querySelectorAll('[role="table"], [role="grid"], [role="treegrid"], [role="list"], ul, ol')) {
      const parsed = parseGrid(
        grid,
        '[role="columnheader"], th',
        '[role="row"], [role="listitem"], li',
        '[role="gridcell"], [role="cell"], [role="rowheader"], td, th'
      );
      if (parsed) return { ...parsed, source: 'grid' };
    }
    const repeated = parseRepeated();
    if (repeated) return { ...repeated, source: 'repeated' };
    return null;
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

  // Spotify has no fixed per-stream rate: it pools revenue and divides it by
  // share of streams, so the effective rate moves with listener market,
  // subscription tier and the month's totals. Published averages sit around
  // $0.003-$0.005 per stream (~$0.004), which at EUR/USD ~1.138 (Sept 2026) is
  // about EUR 0.0035. That is the default here.
  //
  // It is an estimate of GROSS revenue to the rights holder, before distributor
  // and label splits, and before Spotify's 1,000-stream-per-track annual
  // threshold. Override it for your own catalogue from the console:
  //   localStorage.setItem('s4aRatePerStream', '0.0031')
  const DEFAULT_RATE_EUR = 0.0035;

  // The cut reaching the artist after the distributor's and label's shares.
  // Every deal differs, so this is a placeholder you should set to your own:
  //   localStorage.setItem('s4aArtistShare', '0.5')   // or '50'
  const DEFAULT_ARTIST_SHARE = 0.40;

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

  function estimateNode(amount, caption, title) {
    const wrap = document.createElement('span');
    wrap.className = 's4a-total-royalty';

    const value = document.createElement('span');
    value.className = 's4a-total-royalty-value';
    value.textContent = `≈ ${formatEuros(amount)}`;

    const note = document.createElement('span');
    note.className = 's4a-total-rate';
    note.textContent = ` ${caption}`;

    wrap.append(value, note);
    wrap.setAttribute('title', title);
    return wrap;
  }

  function grossNode(total, count) {
    const rate = royaltyRate();
    return estimateNode(
      total * rate,
      `est. @ ${formatRate(rate)}/stream`,
      `Estimated gross royalties for the selected period: ${formatNumber(total)} streams ` +
      `across ${count} artists x ${formatRate(rate)}. Spotify pays no fixed rate — published ` +
      `averages are roughly $0.003-$0.005 per stream, converted here at EUR/USD ~1.14. ` +
      `Before distributor and label splits. Override with ` +
      `localStorage.setItem('s4aRatePerStream', '0.0031').`);
  }

  function shareNode(total) {
    const share = artistShare();
    const percent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(share * 100);
    return estimateNode(
      total * royaltyRate() * share,
      `artist share (${percent}%)`,
      `Estimated artist share: ${percent}% of the gross estimate beside it, i.e. what ` +
      `reaches the artist after distributor and label cuts. This split is a placeholder — ` +
      `set your own with localStorage.setItem('s4aArtistShare', '0.5').`);
  }

  // The Release checklist column, right of the gross estimate.
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
  function buildTotalRow(data, total, change, period) {
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
    label.textContent = `Total · ${data.rows.length} artists${period ? ` · ${period}` : ''}`;

    const headers = data.headers || [];
    const releaseIndex = releaseColumnIndex(headers, cells.length, data.columnIndex);
    if (releaseIndex !== -1 && cells[releaseIndex] && cells[releaseIndex] !== valueCell) {
      cells[releaseIndex].classList.add('s4a-total-cell');
      cells[releaseIndex].appendChild(grossNode(total, data.rows.length));
    }

    const shareIndex = checklistColumnIndex(headers, cells.length, [data.columnIndex, releaseIndex]);
    if (shareIndex !== -1 && cells[shareIndex] && cells[shareIndex] !== valueCell) {
      cells[shareIndex].classList.add('s4a-total-cell');
      cells[shareIndex].appendChild(shareNode(total));
    }

    const labelIndex = data.columnIndex === 0 ? Math.min(1, cells.length - 1) : 0;
    const labelCell = cells[labelIndex];
    if (labelCell && labelCell !== valueCell) {
      labelCell.classList.add('s4a-total-cell');
      labelCell.appendChild(label);
    } else if (valueCell) {
      valueCell.prepend(label, document.createTextNode(' '));
    }

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
  function buildFallback(data, total, change, period) {
    const box = document.createElement('div');
    box.setAttribute(FLAG, '1');
    box.className = 's4a-total-fallback';
    box.innerHTML = `<span class="s4a-total-label"></span><span class="s4a-total-value"></span>`;
    box.querySelector('.s4a-total-label').textContent =
      `Total · ${data.rows.length} artists${period ? ` · ${period}` : ''}`;
    box.querySelector('.s4a-total-value').textContent =
      formatNumber(total) + (change == null ? '' : `  ${formatDelta(change)}`);
    box.append(grossNode(total, data.rows.length), shareNode(total));
    return box;
  }

  const isRosterPage = () => /roster/i.test(location.pathname);

  let lastSignature = null;

  function render(force = false) {
    const existing = document.querySelector(`[${FLAG}]`);

    if (!isRosterPage()) {
      if (existing) existing.remove();
      lastSignature = null;
      return;
    }

    const data = collectRoster();
    if (!data) {
      if (existing) existing.remove();
      lastSignature = null;
      debug('no roster rows found yet');
      return;
    }

    const total = data.rows.reduce((sum, row) => sum + row.value, 0);
    const change = aggregateChange(data.rows);
    const period = activePeriod();
    const signature = `${total}|${change}|${data.rows.length}|${period}|${data.columnIndex}`;
    if (!force && signature === lastSignature && existing && existing.isConnected) return;
    lastSignature = signature;

    const line = data.sampleRow
      ? buildTotalRow(data, total, change, period)
      : buildFallback(data, total, change, period);
    if (existing) existing.remove();
    data.lastRow.insertAdjacentElement('afterend', line);

    debug('total', total, 'change', change, 'period', period, 'metric', data.metric.key, 'skipped', data.skipped);
  }

  /* ------------------------------------------------------------- lifecycle */

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => render(), 300);
  };

  const observer = new MutationObserver((mutations) => {
    const ours = mutations.every((m) => {
      const node = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      return node && node.closest && node.closest(`[${FLAG}]`);
    });
    if (!ours) schedule();
  });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    lastSignature = null;
    schedule();
  }, 600);

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
  debug('loaded on', location.href);
})();
