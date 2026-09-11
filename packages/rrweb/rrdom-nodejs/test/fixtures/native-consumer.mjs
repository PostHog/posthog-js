import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Run outside Vitest's module loader, against either dist or an installed package.
const [format, entry = 'rrdom-nodejs', performanceMode] = process.argv.slice(2);
if (performanceMode === 'without-performance') delete globalThis.performance;
const { RRDocument } =
  format === 'import'
    ? await import(entry)
    : createRequire(import.meta.url)(entry);

assert.equal(typeof globalThis.performance.now, 'function');
assert.equal(typeof globalThis.window, 'undefined');
assert.ok(globalThis.document instanceof RRDocument);

const document = new RRDocument();
const html = document.createElement('html');
const body = document.createElement('body');
const container = document.createElement('div');
const first = document.createElement('span');
const second = document.createElement('span');
document.appendChild(html);
html.appendChild(body);
body.appendChild(container);
container.setAttribute('id', 'container');
first.setAttribute('class', 'item selected');
first.setAttribute('data-value', 'first');
second.setAttribute('class', 'item');
container.appendChild(first);
container.appendChild(second);

assert.deepEqual(document.querySelectorAll('#container'), [container]);
assert.deepEqual(document.querySelectorAll('.item'), [first, second]);
assert.deepEqual(
  document.querySelectorAll('#container > span.selected[data-value="first"]'),
  [first],
);
assert.deepEqual(container.querySelectorAll('.item'), [first, second]);
assert.deepEqual(container.querySelectorAll('.missing'), []);
container.removeChild(first);
assert.deepEqual(document.querySelectorAll('.item'), [second]);

second.setAttribute('style', 'color: red;');
assert.equal(second.style.color, 'red');
const style = document.createElement('style');
style.appendChild(document.createTextNode('.item { color: blue; }'));
body.appendChild(style);
assert.equal(style.sheet.cssRules[0].selectorText, '.item');
assert.equal(style.sheet.cssRules[0].style.color, 'blue');

console.log(
  `${format}: selectors, styles and polyfills passed (${performanceMode})`,
);
