import { describe, it, expect } from 'vitest';
import { buildJsonHtml } from '../src/utils/jsonView.js';

const FIXED_DATE = new Date('2026-07-15T12:00:00Z');
const body = html => html.slice(html.indexOf('<div class="json-view">'));

describe('buildJsonHtml', () => {
  const data = { name: 'A <b>', count: 2, ok: true, none: null, tags: ['x'], empty: {}, nested: { deep: [1, 2] } };

  it('renders every value type with escaping', () => {
    const html = body(buildJsonHtml(data, { title: 'f.json', generatedAt: FIXED_DATE }));
    expect(html).toContain('<span class="json-key">&quot;name&quot;</span>: <span class="json-string">&quot;A &lt;b&gt;&quot;</span>');
    expect(html).toContain('<span class="json-number">2</span>');
    expect(html).toContain('<span class="json-boolean">true</span>');
    expect(html).toContain('<span class="json-null">null</span>');
    expect(html).toContain('<span class="json-punct">{}</span>');
    expect(html).not.toContain('<b>');
  });

  it('makes every non-empty object/array collapsible, open by default', () => {
    const html = body(buildJsonHtml(data));
    // root, tags, nested, nested.deep
    expect(html.match(/<details class="json-node" open>/g)).toHaveLength(4);
    expect(html).toContain('<span class="json-count">1 item</span>');
    expect(html).toContain('<span class="json-count">7 keys</span>');
  });

  it('keeps only the root open when collapsed', () => {
    const html = body(buildJsonHtml(data, { collapsed: true }));
    expect(html.match(/<details class="json-node" open>/g)).toHaveLength(1);
    expect(html.match(/<details class="json-node">/g)).toHaveLength(3);
  });

  it('places commas between siblings but not after the last', () => {
    const html = body(buildJsonHtml([1, 2]));
    expect(html).toContain('<span class="json-number">1</span><span class="json-punct">,</span>');
    expect(html).toContain('<span class="json-number">2</span></div>');
  });

  it('renders a scalar root', () => {
    expect(body(buildJsonHtml('hi'))).toContain('<span class="json-string">&quot;hi&quot;</span>');
  });
});
