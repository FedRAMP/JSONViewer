import { describe, it, expect } from 'vitest';
import { buildItemCardIndex, buildPreviewHtml } from '../src/utils/htmlPreview.js';

const FIXED_DATE = new Date('2026-07-15T12:00:00Z');

describe('buildPreviewHtml', () => {
  it('renders markdown fields via marked', () => {
    const schema = {
      properties: {
        notes: { type: 'string', title: 'Notes', description: 'May use Markdown for formatting.' },
      },
    };
    const html = buildPreviewHtml(schema, { notes: '**bold** text' }, { generatedAt: FIXED_DATE });
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders both the raw enum value and its enumNames title, and skips the sentinel value', () => {
    const schema = {
      properties: {
        frrID: {
          type: 'string',
          title: 'Requirement ID',
          enum: ['', 'KSI-CNA-01'],
          enumNames: ['— Select a requirement —', 'KSI-CNA-01 – Cloud Native Architecture'],
        },
      },
    };
    const html = buildPreviewHtml(schema, { frrID: 'KSI-CNA-01' }, { generatedAt: FIXED_DATE });
    expect(html).toContain('KSI-CNA-01');
    expect(html).toContain('<span class="enum-title">Cloud Native Architecture</span>');
    expect(html).not.toContain('KSI-CNA-01 – Cloud Native Architecture');

    const emptyHtml = buildPreviewHtml(schema, { frrID: '' }, { generatedAt: FIXED_DATE });
    expect(emptyHtml).not.toContain('Requirement ID');
  });

  it('keeps an enum title untouched when it does not start with the value', () => {
    const schema = {
      properties: { code: { type: 'string', enum: ['', 'X1'], enumNames: ['—', 'Extra Large'] } },
    };
    const html = buildPreviewHtml(schema, { code: 'X1' }, { generatedAt: FIXED_DATE });
    expect(html).toContain('<span class="enum-title">Extra Large</span>');
  });

  it('fully skips a field with no value, including its label', () => {
    const schema = {
      properties: {
        filled: { type: 'string', title: 'Filled Field' },
        empty: { type: 'string', title: 'Empty Field' },
      },
    };
    const html = buildPreviewHtml(schema, { filled: 'present' }, { generatedAt: FIXED_DATE });
    expect(html).toContain('Filled Field');
    expect(html).not.toContain('Empty Field');
  });

  it('HTML-escapes a non-markdown string field, neutralizing injected markup', () => {
    const schema = {
      properties: {
        title: { type: 'string', title: 'Title' },
      },
    };
    const html = buildPreviewHtml(schema, { title: '<img src=x onerror=alert(1)>' }, { generatedAt: FIXED_DATE });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('renders one item block per entry in an array of objects', () => {
    const schema = {
      properties: {
        contacts: {
          type: 'array',
          title: 'Contacts',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', title: 'Name' },
              email: { type: 'string', title: 'Email', format: 'email' },
            },
          },
        },
      },
    };
    const html = buildPreviewHtml(schema, {
      contacts: [{ name: 'Alice' }, { name: 'Bob' }],
    }, { generatedAt: FIXED_DATE });
    expect((html.match(/class="item-details"/g) || []).length).toBe(2);
    expect(html).toContain('Alice');
    expect(html).toContain('Bob');
  });

  it('resolves $ref items and skips schema-level $refs', () => {
    const schema = {
      $defs: {
        contact: {
          type: 'object',
          properties: { name: { type: 'string', title: 'Name' } },
        },
      },
      properties: {
        contacts: {
          type: 'array',
          title: 'Contacts',
          items: { $ref: '#/$defs/contact' },
        },
      },
    };
    const html = buildPreviewHtml(schema, { contacts: [{ name: 'Carol' }] }, { generatedAt: FIXED_DATE });
    expect(html).toContain('Carol');
  });

  describe('array item summaries', () => {
    const schema = {
      properties: {
        reqs: {
          type: 'array',
          title: 'Requirements',
          items: {
            type: 'object',
            properties: {
              reqId: { type: 'string', title: 'Requirement ID' },
              reqStatus: { type: 'string', title: 'Implementation Status', enum: ['Implemented', 'Not Implemented', 'Partially Implemented'] },
              notes: { type: 'string', title: 'Notes' },
            },
          },
        },
      },
    };
    const itemOf = html => html.slice(html.indexOf('class="item-details"'));

    it('puts the ID and a status badge in the summary and drops both rows from the body', () => {
      const html = itemOf(buildPreviewHtml(schema, {
        reqs: [{ reqId: 'KSI-CNA-01', reqStatus: 'Partially Implemented', notes: 'Some notes' }],
      }, { generatedAt: FIXED_DATE }));
      const summary = html.slice(0, html.indexOf('</summary>'));
      const body = html.slice(html.indexOf('class="item-body"'));
      expect(summary).toContain('KSI-CNA-01');
      expect(summary).toContain('<span class="status-badge status-partial" title="Implementation Status">Partially Implemented</span>');
      expect(body).not.toContain('Requirement ID');
      expect(body).not.toContain('Implementation Status');
      expect(body).toContain('Some notes');
    });

    it('adds a force-of-rule badge for IDs with a known force', () => {
      const html = buildPreviewHtml(schema, {
        reqs: [{ reqId: 'CDS-CSO-AVR', reqStatus: 'Implemented' }, { reqId: 'CDS-CSO-XYZ' }],
      }, { generatedAt: FIXED_DATE, ruleForces: { 'CDS-CSO-AVR': 'A: SHOULD · B–D: MUST' } });
      expect(html).toContain('<span class="force-badge force-must" title="Force of rule">A: SHOULD · B–D: MUST</span>');
      expect((html.match(/class="force-badge/g) || []).length).toBe(1);
    });

    it('adds a collapsed FedRAMP Rule section with the rule text at the top of the body', () => {
      const ruleTexts = {
        'CDS-CSO-AVR': {
          statements: [{ label: 'Class A', text: 'Providers **SHOULD** report.' }, { label: 'Class B', text: 'Providers MUST report.' }],
          followingInformation: ['FedRAMP ID'],
        },
      };
      const html = itemOf(buildPreviewHtml(schema, {
        reqs: [{ reqId: 'CDS-CSO-AVR', reqStatus: 'Implemented', notes: 'Some notes' }],
      }, { generatedAt: FIXED_DATE, ruleTexts }));
      const body = html.slice(html.indexOf('<div class="item-body">') + '<div class="item-body">'.length);
      expect(body.startsWith('<details class="sub-section rule-text"><summary class="sub-label">FedRAMP Rule</summary>')).toBe(true);
      expect(body).toContain('<div class="part-label">Class A</div>');
      expect(body).toContain('<strong>SHOULD</strong>');
      expect(body).toContain('<li>FedRAMP ID</li>');
      expect(body.indexOf('FedRAMP Rule')).toBeLessThan(body.indexOf('Some notes'));

      const expanded = buildPreviewHtml(schema, { reqs: [{ reqId: 'CDS-CSO-AVR' }] }, { generatedAt: FIXED_DATE, ruleTexts, expanded: true });
      expect(expanded).toContain('<details class="sub-section rule-text" open>');
    });

    it('gives an item with only an ID and rule text a body for the rule section', () => {
      const html = buildPreviewHtml(schema, { reqs: [{ reqId: 'X-Y-Z', reqStatus: 'Implemented' }] }, {
        generatedAt: FIXED_DATE,
        ruleTexts: { 'X-Y-Z': { statements: [{ label: null, text: 'Rule.' }], followingInformation: [] } },
      });
      expect(html).not.toContain('item-leaf');
      expect(html).toContain('FedRAMP Rule');
    });

    it('omits the rule section when no rule text is known for the ID', () => {
      const html = buildPreviewHtml(schema, { reqs: [{ reqId: 'X-Y-Z', notes: 'n' }] }, { generatedAt: FIXED_DATE, ruleTexts: {} });
      expect(html).not.toContain('rule-text');
    });

    it('never uses the status as the item label', () => {
      const html = buildPreviewHtml(schema, { reqs: [{ reqStatus: 'Implemented', notes: 'n' }] }, { generatedAt: FIXED_DATE });
      expect(html).toContain('<span class="item-label">n</span>');
    });

    it('keeps a non-ID label field in the body', () => {
      const html = buildPreviewHtml(schema, { reqs: [{ notes: 'Only notes' }] }, { generatedAt: FIXED_DATE });
      expect(html.slice(html.indexOf('class="item-body"'))).toContain('Only notes');
    });

    it('renders an item with nothing left for its body as a non-collapsible row', () => {
      const html = buildPreviewHtml(schema, { reqs: [{ reqId: 'X-1', reqStatus: 'Implemented' }] }, { generatedAt: FIXED_DATE });
      expect(html).toContain('class="item-details item-leaf"');
      expect(html).not.toContain('class="item-body"');
    });
  });

  describe('family grouping', () => {
    const schema = {
      properties: {
        reqs: {
          type: 'array',
          title: 'Requirements',
          items: { type: 'object', properties: { reqId: { type: 'string' }, notes: { type: 'string' } } },
        },
      },
    };
    const render = (ids, opts = {}) => buildPreviewHtml(
      schema, { reqs: ids.map(reqId => ({ reqId, notes: `n-${reqId}` })) }, { generatedAt: FIXED_DATE, ...opts },
    );
    const groupCodes = html => [...html.matchAll(/<span class="group-code">([^<]+)<\/span>/g)].map(m => m[1]);

    it('groups by the first ID segment, alphabetically, with counts and FRMR names', () => {
      const html = render(['SDR-CSO-MTD', 'AFC-CSO-INB', 'SDR-CSX-KSI', 'MKT-CSO-WEB'], {
        groupNames: { AFC: 'Addressing FedRAMP Communication' },
      });
      expect(groupCodes(html)).toEqual(['AFC', 'MKT', 'SDR']);
      expect(html).toContain('<span class="group-name">Addressing FedRAMP Communication</span>');
      const sdr = html.slice(html.indexOf('<span class="group-code">SDR</span>'));
      expect(sdr).toContain('<span class="group-count">2</span>');
      expect(sdr.indexOf('SDR-CSO-MTD')).toBeLessThan(sdr.indexOf('SDR-CSX-KSI'));
    });

    it('starts grouped item cards closed but groups open, unless expanded', () => {
      const html = render(['AFC-CSO-INB', 'MKT-CSO-WEB']);
      expect(html).toMatch(/<details class="group-section" open>/);
      expect(html).not.toMatch(/<details class="item-details" open>/);
      expect(render(['AFC-CSO-INB', 'MKT-CSO-WEB'], { expanded: true })).toMatch(/<details class="item-details" open>/);
    });

    it('groups by the first two segments when every ID shares the first', () => {
      expect(groupCodes(render(['KSI-CNA-MAT', 'KSI-CED-RAT', 'KSI-CNA-RNT']))).toEqual(['KSI-CED', 'KSI-CNA']);
    });

    it('does not group when only one family results', () => {
      expect(render(['MKT-CSO-WEB', 'MKT-CSO-ABC'])).not.toContain('group-section');
    });

    it('does not group when any item lacks a hyphenated ID', () => {
      expect(render(['AFC-CSO-INB', 'oddball'])).not.toContain('group-section');
    });
  });

  it('makes nested object/array sub-sections collapsible', () => {
    const schema = {
      properties: {
        outer: {
          type: 'object',
          title: 'Outer',
          properties: { inner: { type: 'object', title: 'Inner', properties: { leaf: { type: 'string', title: 'Leaf' } } } },
        },
      },
    };
    const html = buildPreviewHtml(schema, { outer: { inner: { leaf: 'v' } } }, { generatedAt: FIXED_DATE });
    expect(html).toContain('<details class="sub-section" open><summary class="sub-label">Inner</summary>');
  });

  it('renders every level closed when collapsed is set', () => {
    const schema = {
      properties: {
        list: { type: 'array', title: 'List', items: { type: 'object', properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } },
      },
    };
    const data = { list: [{ name: 'a', tags: ['t'] }] };
    const open = buildPreviewHtml(schema, data, { generatedAt: FIXED_DATE });
    const closed = buildPreviewHtml(schema, data, { generatedAt: FIXED_DATE, collapsed: true });
    expect((open.match(/<details[^>]* open>/g) || []).length).toBe(3);
    expect(closed).not.toMatch(/<details[^>]* open>/);
    // The flag must not leak into the next call.
    expect(buildPreviewHtml(schema, data, { generatedAt: FIXED_DATE })).toBe(open);
  });

  it('shows the empty-note when nothing in formData is renderable', () => {
    const schema = { properties: { title: { type: 'string', title: 'Title' } } };
    const html = buildPreviewHtml(schema, {}, { generatedAt: FIXED_DATE });
    expect(html).toContain('No data entered yet.');
  });

  it('uses the provided title and generatedAt in the document header', () => {
    const schema = { properties: {} };
    const html = buildPreviewHtml(schema, {}, { title: 'My Document', generatedAt: FIXED_DATE });
    expect(html).toContain('<title>My Document</title>');
    expect(html).toContain('My Document');
  });
});

describe('buildItemCardIndex', () => {
  const schema = {
    properties: {
      reqs: {
        type: 'array',
        items: { type: 'object', properties: {
          reqId: { type: 'string' },
          reqStatus: { type: 'string', enum: ['Implemented', 'Not Implemented'] },
          notes: { type: 'string', title: 'Notes' },
        } },
      },
      contacts: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
    },
  };
  const data = {
    reqs: [{ reqId: 'KSI-CED-RAT', reqStatus: 'Implemented', notes: 'Trained' }],
    contacts: [{ name: 'Alice' }],
  };

  it('indexes ID-identified items by ID, closed by default', () => {
    const index = buildItemCardIndex(schema, data);
    expect(Object.keys(index)).toEqual(['KSI-CED-RAT']);
    expect(index['KSI-CED-RAT']).toMatch(/^<details class="item-details">/);
    expect(index['KSI-CED-RAT']).toContain('Trained');
    expect(index['KSI-CED-RAT']).toContain('status-yes');
  });

  it('opens cards when expanded', () => {
    expect(buildItemCardIndex(schema, data, { expanded: true })['KSI-CED-RAT']).toMatch(/^<details class="item-details" open>/);
  });
});
