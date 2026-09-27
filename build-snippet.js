/* Builds dist/console-snippet.js: the content script plus its stylesheet,
   as one self-contained paste-into-the-console block. */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')   // comments are for the source, not the page
  .replace(/\s+/g, ' ').trim();
const js = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');

const snippet = `/* S4A Roster Totals — paste into the console on artists.spotify.com/c/roster */
if (window.__s4aTotals) {
  console.log('[S4A Totals] already running on this page');
} else {
  window.__s4aTotals = true;
  const s4aStyle = document.createElement('style');
  s4aStyle.textContent = ${JSON.stringify(css)};
  document.head.appendChild(s4aStyle);
${js}
}
`;

fs.writeFileSync(path.join(root, 'dist/console-snippet.js'), snippet);
console.log('dist/console-snippet.js', fs.statSync(path.join(root, 'dist/console-snippet.js')).size, 'bytes');
