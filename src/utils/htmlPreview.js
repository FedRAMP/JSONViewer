import { marked } from 'marked';
import { resolveLocalRef } from './schemaRefs';
import previewCss from './htmlPreview.css?inline';

const MARKDOWN_MARKER = 'May use Markdown for formatting.';

export function esc(val) {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isEmptyValue(v) {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

// "fedRampId" -> "FedRAMP Id": camelCase/snake_case to words, splitting an
// acronym run from the word after it ("RAMPId" -> "RAMP Id"), with FedRAMP
// always spelled as one word.
function humanize(key) {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\bfed\s*ramp\b/gi, 'FedRAMP')
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

function labelFor(key, prop) {
  return prop?.title || humanize(key);
}

// Deterministic string -> HSL color, so ID-shaped enum values (e.g. "KSI-CNA-01")
// get a stable per-category accent without a hardcoded category->color table.
export function colorForCategory(value) {
  const match = /^[A-Z]+-([A-Z]+)-/.exec(value);
  const seed = match ? match[1] : value;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 40%)`;
}

// enumNames for requirement/KSI IDs read "KSI-CED-RAT – Reviewing All Training"
// (the editor's dropdown needs the ID in the label). The value is already shown
// in its own badge, so drop the repeated "<value> – " prefix here.
function stripValuePrefix(title, value) {
  const v = String(value);
  if (!title.startsWith(v)) return title;
  const rest = title.slice(v.length).replace(/^\s*[–—-]\s*/, '');
  return rest || title;
}

// FRR and KSI IDs show their title in parentheses: "KSI-CED-RAT (Reviewing All Training)".
const RULE_ID_KEYS = new Set(['frrID', 'frId', 'FR_ID', 'ksiId']);

function renderEnum(prop, value, key) {
  const { enum: enumValues, enumNames } = prop;
  const hasNames = Array.isArray(enumNames) && enumNames.length === enumValues.length;
  const i = enumValues.indexOf(value);
  const title = hasNames && i > 0 ? stripValuePrefix(enumNames[i], value) : null;
  const badge = `<span class="enum-value" style="border-left-color:${colorForCategory(value)}">${esc(value)}</span>`;
  if (title && title !== value) {
    const text = RULE_ID_KEYS.has(key) ? `(${title})` : title;
    return `${badge}<span class="enum-title">${esc(text)}</span>`;
  }
  return badge;
}

function renderString(prop, value) {
  if (prop.description?.includes(MARKDOWN_MARKER)) {
    return `<div class="markdown-body">${marked.parse(String(value), { breaks: true })}</div>`;
  }
  if (prop.format === 'uri') {
    return `<a href="${esc(value)}" target="_blank" rel="noopener">${esc(value)}</a>`;
  }
  if (prop.format === 'email') {
    return `<a href="mailto:${esc(value)}">${esc(value)}</a>`;
  }
  if (prop.format === 'date' || prop.format === 'date-time') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return esc(prop.format === 'date' ? d.toLocaleDateString() : d.toLocaleString());
    }
  }
  // pre-wrap keeps the line breaks and spacing typed into the source file.
  return `<span class="text-value">${esc(value)}</span>`;
}

// ` open` on every <details> unless buildPreviewHtml was asked to start fully
// collapsed. Set once per (synchronous) buildPreviewHtml call.
let openAttr = ' open';
// Same, for item cards inside a family group (requirements, KSIs, controls):
// closed by default so a family reads as a list of ID/title/status headers.
let groupedItemOpenAttr = '';
// Optional { prefix: name } lookup for family group headings (options.groupNames).
let groupNames = {};
// Optional { ruleId: forceLabel } lookup (options.ruleForces), e.g. "MUST" or
// "A: SHOULD · B–D: MUST", shown as a badge in item summaries.
let ruleForces = {};
// Optional { ruleId: { statements, followingInformation } } (options.ruleTexts):
// the FRMR rule text, shown as a collapsible section at the top of item cards.
let ruleTexts = {};
// ` open` on those rule-text sections: closed unless everything is expanded.
let ruleTextOpenAttr = '';

function isScalarType(prop) {
  return prop.enum || ['string', 'number', 'integer', 'boolean'].includes(prop.type);
}

function renderObjectBody(prop, value, root, depth, omitKeys = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(prop.properties || {}).filter(([key]) => !omitKeys.has(key));
  const rows = [];
  const subSections = [];

  for (const [key, rawChild] of entries) {
    const child = resolveLocalRef(root, rawChild);
    if (!child) continue;
    const childValue = value?.[key];
    if (isEmptyValue(childValue)) continue;

    const isMarkdown = child.type === 'string' && child.description?.includes(MARKDOWN_MARKER);
    if (isScalarType(child) && !isMarkdown) {
      const html = renderField(child, childValue, root, key, depth);
      if (html) rows.push(`<tr><th>${esc(labelFor(key, child))}</th><td>${html}</td></tr>`);
    } else {
      const html = renderField(child, childValue, root, key, depth + 1);
      if (html) subSections.push(`<details class="sub-section"${openAttr}><summary class="sub-label">${esc(labelFor(key, child))}</summary><div class="sub-body">${html}</div></details>`);
    }
  }

  const extra = undeclaredFields(prop.properties, value);
  const extraBody = extra && renderObjectBody(inferSchema(extra), extra, root, depth + 1);
  if (extraBody) {
    subSections.push(`<details class="sub-section additional-fields"${openAttr}><summary class="sub-label" title="${esc(ADDITIONAL_NOTE)}">Additional Fields</summary><div class="sub-body">${extraBody}</div></details>`);
  }

  if (!rows.length && !subSections.length) return null;
  const table = rows.length ? `<table class="info-table"><tbody>${rows.join('')}</tbody></table>` : '';
  return table + subSections.join('');
}

function isStatusField(key, prop) {
  return Boolean(prop?.enum) && /status$/i.test(key);
}

// Colour by the strongest keyword present, so a per-class label like
// "A: SHOULD · B–D: MUST" reads as MUST.
export function forceClass(force) {
  if (/MUST NOT|SHOULD NOT/.test(force)) return 'force-not';
  if (/MUST/.test(force)) return 'force-must';
  if (/SHOULD/.test(force)) return 'force-should';
  return 'force-may';
}

function statusClass(value) {
  const v = String(value).toLowerCase();
  if (v.startsWith('not')) return 'status-no';
  if (v.startsWith('partial')) return 'status-partial';
  if (v === 'implemented') return 'status-yes';
  return 'status-other';
}

// Picks the field that identifies an array item for its <summary>. Prefers an
// enum field with a genuine looked-up title (e.g. frrID -> its FRMR title) over
// one whose enumNames just repeat the raw value (e.g. controlId, or a plain
// status enum like "Implemented") — the latter is no more identifying than any
// other short string field on the item. Status fields are never the label.
function itemLabel(items, item) {
  const props = Object.entries(items.properties || {});
  for (const [key, rawChild] of props) {
    const v = item?.[key];
    if (rawChild?.enum && !isStatusField(key, rawChild) && !isEmptyValue(v)) {
      const { enum: enumValues, enumNames } = rawChild;
      const hasNames = Array.isArray(enumNames) && enumNames.length === enumValues.length;
      const i = enumValues.indexOf(v);
      if (hasNames && i > 0 && enumNames[i] !== v) return { key, html: renderEnum(rawChild, v, key) };
    }
  }
  for (const [key, rawChild] of props) {
    const v = item?.[key];
    if (isStatusField(key, rawChild)) continue;
    if (typeof v === 'string' && v && v.length <= 60 && !rawChild?.description?.includes(MARKDOWN_MARKER)) {
      return { key, html: esc(v) };
    }
  }
  return null;
}

// Builds an array item's <summary> content: its identifying label plus any
// status badge(s). Returns the keys it consumed so the item body can omit
// them — an ID-style key (…Id/…ID) and status fields are shown only here; any
// other label field (e.g. a service name) stays in the body too.
function itemSummary(items, item, index) {
  const omit = new Set();
  const label = itemLabel(items, item);
  if (label && /id$/i.test(label.key)) omit.add(label.key);

  const statuses = [];
  const ruleId = label && /id$/i.test(label.key) ? item[label.key] : null;
  const force = typeof ruleId === 'string' ? ruleForces[ruleId] : null;
  if (force) {
    statuses.push(`<span class="force-badge ${forceClass(force)}" title="Force of rule">${esc(force)}</span>`);
  }
  for (const [key, rawChild] of Object.entries(items.properties || {})) {
    const v = item?.[key];
    if (isStatusField(key, rawChild) && !isEmptyValue(v)) {
      omit.add(key);
      statuses.push(`<span class="status-badge ${statusClass(v)}" title="${esc(labelFor(key, rawChild))}">${esc(v)}</span>`);
    }
  }

  const labelHtml = `<span class="item-label">${label ? label.html : `Item ${index + 1}`}</span>`;
  const statusHtml = statuses.length ? `<span class="item-status">${statuses.join('')}</span>` : '';
  return { html: labelHtml + statusHtml, omit };
}

const ID_SHAPE = /^[A-Z0-9]+(-[A-Z0-9]+)+$/i;

// Groups array items by the family prefix of their ID: the first ID segment
// (e.g. "MKT", "AFC", "AC"), or the first two when every ID shares the first
// (e.g. "KSI-CED", "KSI-CMT"). Returns null — render ungrouped — unless every
// item has a hyphenated ID and that yields at least two groups.
function groupByFamily(items, value) {
  const ids = value.map(item => {
    const label = itemLabel(items, item);
    const id = label && /id$/i.test(label.key) ? item[label.key] : null;
    return typeof id === 'string' && ID_SHAPE.test(id) ? id.split('-') : null;
  });
  if (ids.some(segments => !segments)) return null;

  const sharedFirst = ids.every(segments => segments[0] === ids[0][0]);
  const depth = sharedFirst && ids.every(segments => segments.length > 2) ? 2 : 1;

  const groups = new Map();
  value.forEach((item, i) => {
    const prefix = ids[i].slice(0, depth).join('-');
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(i);
  });
  if (groups.size < 2) return null;
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

// Rule statement(s) (labelled per certification class when they vary) plus any
// "following information" list, as used by both item cards and the control
// guidance view's rule cards.
export function renderRuleText({ statements = [], followingInformation = [] }) {
  const text = statements.map(({ label, text: statement }) => (
    `<div class="rule-statement">${label ? `<div class="part-label">${esc(label)}</div>` : ''}<div class="markdown-body">${marked.parse(statement)}</div></div>`
  )).join('');
  const following = followingInformation.length
    ? `<ul class="bullet-list">${followingInformation.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
    : '';
  return text + following;
}

function renderRuleTextSection(items, item) {
  const label = itemLabel(items, item);
  const id = label && /id$/i.test(label.key) ? item?.[label.key] : null;
  const rule = typeof id === 'string' ? ruleTexts[id] : null;
  if (!rule) return '';
  const html = renderRuleText(rule);
  if (!html) return '';
  return `<details class="sub-section rule-text"${ruleTextOpenAttr}><summary class="sub-label">FedRAMP Rule</summary><div class="sub-body">${html}</div></details>`;
}

function renderArrayItem(items, item, i, root, depth, open = openAttr) {
  if (isEmptyValue(item)) return '';
  const summary = itemSummary(items, item, i);
  const ruleText = renderRuleTextSection(items, item);
  const fields = renderObjectBody(items, item, root, depth + 1, summary.omit);
  const body = ruleText + (fields || '');
  if (!body) {
    return `<div class="item-details item-leaf"><div class="item-summary">${summary.html}</div></div>`;
  }
  return `<details class="item-details"${open}><summary class="item-summary">${summary.html}</summary><div class="item-body">${body}</div></details>`;
}

function renderArrayBody(prop, value, root, key, depth) {
  if (!Array.isArray(value)) return null;
  const items = resolveLocalRef(root, prop.items);
  if (!items) return null;

  if (items.type === 'object' || items.properties) {
    const groups = groupByFamily(items, value);
    if (groups) {
      const blocks = groups.map(([prefix, indexes]) => {
        const inner = indexes.map(i => renderArrayItem(items, value[i], i, root, depth, groupedItemOpenAttr)).join('');
        if (!inner) return '';
        const name = groupNames[prefix];
        const heading = `<span class="group-code">${esc(prefix)}</span>${name ? `<span class="group-name">${esc(name)}</span>` : ''}`;
        return `<details class="group-section"${openAttr}><summary class="group-summary">${heading}<span class="group-count">${indexes.length}</span></summary><div class="group-body">${inner}</div></details>`;
      }).filter(Boolean);
      return blocks.length ? blocks.join('') : null;
    }
    const blocks = value.map((item, i) => renderArrayItem(items, item, i, root, depth)).filter(Boolean);
    return blocks.length ? blocks.join('') : null;
  }

  const lis = value
    .filter(v => !isEmptyValue(v))
    .map(v => `<li>${renderField(items, v, root, key, depth)}</li>`);
  return lis.length ? `<ul class="bullet-list">${lis.join('')}</ul>` : null;
}

function renderField(rawProp, value, root, key, depth) {
  const prop = resolveLocalRef(root, rawProp);
  if (!prop || isEmptyValue(value)) return null;

  if (prop.enum) return renderEnum(prop, value, key);

  switch (prop.type) {
    case 'object':
      return renderObjectBody(prop, value, root, depth);
    case 'array':
      return renderArrayBody(prop, value, root, key, depth);
    case 'boolean':
      return `<span class="badge" style="background:${value ? '#059669' : '#6b7280'}">${value ? 'Yes' : 'No'}</span>`;
    case 'number':
    case 'integer':
      return esc(String(value));
    case 'string':
    default:
      return renderString(prop, value);
  }
}

// collapsed: everything closed; expanded: everything open; neither: all open
// except grouped item cards.
function applyRenderOptions(options) {
  openAttr = options.collapsed ? '' : ' open';
  groupedItemOpenAttr = options.expanded ? ' open' : '';
  groupNames = options.groupNames || {};
  ruleForces = options.ruleForces || {};
  ruleTexts = options.ruleTexts || {};
  ruleTextOpenAttr = options.expanded ? ' open' : '';
}

export function buildPreviewHtml(schema, formData, options = {}) {
  const title = options.title || 'Document Preview';
  const generatedAt = options.generatedAt || new Date();
  applyRenderOptions(options);

  const sections = Object.entries(schema.properties || {}).map(([key, rawProp]) => {
    const prop = resolveLocalRef(schema, rawProp);
    if (!prop) return '';
    const body = renderField(prop, formData?.[key], schema, key, 1);
    if (!body) return '';
    return `<details class="top-section"${openAttr}><summary>${esc(labelFor(key, prop))}</summary><div class="top-section-body">${body}</div></details>`;
  }).join('');

  const bodyHtml = (sections + renderAdditionalFields(schema, formData))
    || '<p class="empty-note">No data entered yet.</p>';
  return wrapPage(title, bodyHtml, generatedAt);
}

const URI_SHAPE = /^https?:\/\/\S+$/i;
const DATE_TIME_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

// A schema describing a value the document schema doesn't, so it can go
// through the same renderers: objects keep their keys, arrays of objects get
// the union of their items' keys, and strings shaped like a URL or ISO
// date-time get that format.
function inferSchema(value) {
  if (Array.isArray(value)) {
    const present = value.filter(v => !isEmptyValue(v));
    const objects = present.filter(v => typeof v === 'object' && !Array.isArray(v));
    if (objects.length && objects.length === present.length) {
      const merged = Object.assign({}, ...objects.slice().reverse());
      return { type: 'array', items: inferSchema(merged) };
    }
    return { type: 'array', items: present.length ? inferSchema(present[0]) : {} };
  }
  if (value !== null && typeof value === 'object') {
    return { type: 'object', properties: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inferSchema(v)])) };
  }
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'string') {
    if (URI_SHAPE.test(value)) return { type: 'string', format: 'uri' };
    if (DATE_TIME_SHAPE.test(value)) return { type: 'string', format: 'date-time' };
  }
  return { type: 'string' };
}

const ADDITIONAL_NOTE = "Fields in this file that the selected document type's schema doesn't define.";

// { key: value } for the non-empty keys of an object value that its schema
// doesn't declare (other than $schema), or null if there are none. Rendered
// via inferSchema so nothing in the file is silently dropped; inferred schemas
// declare every key, so this never recurses into its own output.
function undeclaredFields(declared = {}, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value)
    .filter(([key, v]) => key !== '$schema' && !(key in declared) && !isEmptyValue(v));
  return entries.length ? Object.fromEntries(entries) : null;
}

// The document's own undeclared top-level keys, as a final top section.
// (Nested ones get an "Additional Fields" sub-section in renderObjectBody.)
function renderAdditionalFields(schema, formData) {
  const extra = undeclaredFields(schema.properties, formData);
  const body = extra && renderObjectBody(inferSchema(extra), extra, schema, 1);
  if (!body) return '';
  const note = `<p class="additional-note">${esc(ADDITIONAL_NOTE)}</p>`;
  return `<details class="top-section additional-fields"${openAttr}><summary>Additional Fields</summary><div class="top-section-body">${note}${body}</div></details>`;
}

// { itemId: cardHtml } for every top-level array item in formData that's
// identified by an ID-style field (e.g. an SDR's frrID / ksiId / controlId
// entries) — the same cards the document view renders, so other views can
// embed them. Cards start closed like grouped cards, open when `expanded`.
export function buildItemCardIndex(schema, formData, options = {}) {
  applyRenderOptions(options);
  const index = {};
  for (const [key, rawProp] of Object.entries(schema?.properties || {})) {
    const prop = resolveLocalRef(schema, rawProp);
    const value = formData?.[key];
    if (prop?.type !== 'array' || !Array.isArray(value)) continue;
    const items = resolveLocalRef(schema, prop.items);
    if (!items?.properties) continue;
    value.forEach((item, i) => {
      const label = itemLabel(items, item);
      const id = label && /id$/i.test(label.key) ? item?.[label.key] : null;
      if (typeof id !== 'string' || index[id]) return;
      const card = renderArrayItem(items, item, i, schema, 1, groupedItemOpenAttr);
      if (card) index[id] = card;
    });
  }
  return index;
}

// Standalone HTML page shell (header + inlined preview CSS) shared by every
// view the viewer renders into its sandboxed iframe.
export function wrapPage(title, bodyHtml, generatedAt = new Date()) {
  const generatedLabel = generatedAt.toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>${previewCss}</style>
</head>
<body>
<div class="page">
  <div class="page-header">
    <h1>${esc(title)}</h1>
    <p class="subtitle">Generated ${esc(generatedLabel)}</p>
  </div>
  ${bodyHtml}
</div>
</body>
</html>`;
}
