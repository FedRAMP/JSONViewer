import { esc, wrapPage } from './htmlPreview';

// Raw-JSON view: the parsed document pretty-printed, with every object/array a
// native <details> so it collapses without script (the iframe is sandboxed).

function renderScalar(value) {
  if (value === null) return '<span class="json-null">null</span>';
  if (typeof value === 'string') return `<span class="json-string">${esc(JSON.stringify(value))}</span>`;
  if (typeof value === 'number') return `<span class="json-number">${esc(String(value))}</span>`;
  if (typeof value === 'boolean') return `<span class="json-boolean">${value}</span>`;
  return `<span class="json-null">${esc(String(value))}</span>`;
}

function renderNode(value, key, comma, depth, openFor) {
  const keyHtml = key === null ? '' : `<span class="json-key">${esc(JSON.stringify(key))}</span>: `;
  const tail = comma ? '<span class="json-punct">,</span>' : '';
  const isArray = Array.isArray(value);
  if (value === null || typeof value !== 'object') {
    return `<div class="json-line">${keyHtml}${renderScalar(value)}${tail}</div>`;
  }

  const entries = isArray ? value.map((v, i) => [null, v, i]) : Object.entries(value).map(([k, v], i) => [k, v, i]);
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  if (!entries.length) {
    return `<div class="json-line">${keyHtml}<span class="json-punct">${open}${close}</span>${tail}</div>`;
  }

  const count = `${entries.length} ${isArray ? (entries.length === 1 ? 'item' : 'items') : (entries.length === 1 ? 'key' : 'keys')}`;
  const children = entries
    .map(([k, v, i]) => renderNode(v, k, i < entries.length - 1, depth + 1, openFor))
    .join('');
  return `<details class="json-node"${openFor(depth) ? ' open' : ''}>`
    + `<summary>${keyHtml}<span class="json-punct">${open}</span>`
    + `<span class="json-folded"><span class="json-ellipsis">…</span><span class="json-punct">${close}</span>${tail}</span>`
    + `<span class="json-count">${count}</span></summary>`
    + `<div class="json-children">${children}</div>`
    + `<div class="json-line"><span class="json-punct">${close}</span>${tail}</div>`
    + '</details>';
}

// collapsed: only the root stays open; otherwise everything is open.
export function buildJsonHtml(data, options = {}) {
  const openFor = options.collapsed ? depth => depth === 0 : () => true;
  const body = `<div class="json-view">${renderNode(data, null, false, 0, openFor)}</div>`;
  return wrapPage(options.title || 'JSON', body, options.generatedAt);
}
