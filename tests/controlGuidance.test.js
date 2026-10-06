import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildControlGuidanceHtml,
  controlTitle,
  extractControlRuleMap,
  toGuidanceControlId,
} from '../src/utils/controlGuidance.js';

const PUBLIC = resolve(import.meta.dirname, '../public');
const readJson = file => JSON.parse(readFileSync(resolve(PUBLIC, file), 'utf8'));
const FIXED_DATE = new Date('2026-07-15T12:00:00Z');

describe('toGuidanceControlId', () => {
  it('converts OSCAL-style ids to the guidance file keys', () => {
    expect(toGuidanceControlId('at-2')).toBe('AT-02');
    expect(toGuidanceControlId('at-2.2')).toBe('AT-02 (02)');
    expect(toGuidanceControlId('sc-12')).toBe('SC-12');
    expect(toGuidanceControlId('ac-6.10')).toBe('AC-06 (10)');
  });

  it('returns null for unrecognized ids', () => {
    expect(toGuidanceControlId('AC-02 (01)')).toBeNull();
    expect(toGuidanceControlId('nonsense')).toBeNull();
  });
});

describe('extractControlRuleMap', () => {
  const frmr = {
    FRR: { AFC: { data: { all: { CSO: {
      'AFC-CSO-INB': { name: 'Security Inbox', force: 'MUST', statement: 'Providers MUST ...', controls: ['si-5'] },
      'AFC-CSO-XYZ': { name: 'Per class', controls: ['si-5', 'si-5'], varies_by_class: {
        b: { statement: 'B text', force: 'MUST' }, a: { statement: 'A text', force: 'SHOULD' },
      } },
      'AFC-CSO-NOC': { name: 'No controls', statement: 'x' },
    } } } } },
    KSI: { CED: { indicators: { 'KSI-CED-RAT': { name: 'Reviewing All Training', statement: 'Training ...', controls: ['at-2', 'at-2.2'] } } } },
  };
  const map = extractControlRuleMap(frmr);

  it('maps each rule to its normalized controls, sorted and deduped', () => {
    expect(Object.keys(map).sort()).toEqual(['AT-02', 'AT-02 (02)', 'SI-05']);
    expect(map['SI-05'].map(r => r.id)).toEqual(['AFC-CSO-INB', 'AFC-CSO-XYZ']);
    expect(map['AT-02 (02)'][0].name).toBe('Reviewing All Training');
  });

  it('captures per-class statements and force', () => {
    const rule = map['SI-05'][1];
    expect(rule.force).toBe('A: SHOULD · B: MUST');
    expect(rule.statements).toEqual([
      { label: 'Class A', text: 'A text' },
      { label: 'Class B', text: 'B text' },
    ]);
  });

  it('matches most guidance controls against the real FRMR file', () => {
    const real = extractControlRuleMap(readJson('fedramp-consolidated-rules.json'));
    const guidance = readJson('AgencyControlGuidance.controls.merged.json');
    const ids = Object.values(guidance.controls).flatMap(f => Object.keys(f));
    expect(ids.filter(id => real[id]).length).toBeGreaterThan(200);
  });
});

describe('buildControlGuidanceHtml', () => {
  const guidance = {
    controls: {
      AT: {
        'AT-02': { parts: {
          a: { agency_actions: 'Do <the> thing', fedramp_guidance: 'Guidance A', notes: null },
          b: { agency_actions: 'Second', fedramp_guidance: 'Guidance B', notes: 'A note' },
        } },
        'AT-03': { parts: { _: { agency_actions: 'Solo', fedramp_guidance: 'G', notes: null } } },
      },
    },
  };
  const rules = {
    'AT-02': [{ id: 'KSI-CED-RAT', name: 'Reviewing All Training', force: 'MUST', statements: [{ label: null, text: '**Bold** text' }], followingInformation: [] }],
  };
  const html = buildControlGuidanceHtml(guidance, rules, { generatedAt: FIXED_DATE });

  it('groups controls under a named NIST family', () => {
    expect(html).toContain('<span class="group-code">AT</span><span class="group-name">Awareness and Training</span>');
    expect(html).toMatch(/<details class="group-section" open>/);
  });

  it('renders each part with labels, escaping text and skipping null notes', () => {
    expect(html).toContain('<div class="part-label">Part a</div>');
    expect(html).toContain('Do &lt;the&gt; thing');
    expect(html).toContain('<th>Notes</th><td>A note</td>');
    expect((html.match(/<th>Notes<\/th>/g) || []).length).toBe(1);
    expect(html).not.toContain('Part _');
  });

  it('adds a mapped-rules subsection with each rule, its force, and markdown statement', () => {
    expect(html).toContain('Mapped FedRAMP Rules (1)');
    expect(html).toContain('<span class="enum-title">(Reviewing All Training)</span>');
    expect(html).toContain('<span class="force-badge force-must" title="Force of rule">MUST</span>');
    expect(html).toContain('<strong>Bold</strong> text');
    expect(html).toContain('<span class="rule-count">1 rule</span>');
    expect(html).toContain('no mapped rules');
  });

  it('starts control and rule cards closed by default and opens all when expanded', () => {
    expect(html).not.toMatch(/<details class="item-details[^"]*" open>/);
    const expanded = buildControlGuidanceHtml(guidance, rules, { generatedAt: FIXED_DATE, expanded: true });
    expect(expanded).not.toMatch(/<details[^>]*class="[^"]*"(?! open)>/);
    const collapsed = buildControlGuidanceHtml(guidance, rules, { generatedAt: FIXED_DATE, collapsed: true });
    expect(collapsed).not.toMatch(/ open>/);
  });
});

describe('buildControlGuidanceHtml with an SDR', () => {
  const guidance = { controls: { AT: { 'AT-02': { parts: { _: { agency_actions: 'A', fedramp_guidance: 'G', notes: null } } } } } };
  const rules = {
    'AT-02': [
      { id: 'KSI-CED-RAT', name: 'Reviewing All Training', force: null, statements: [], followingInformation: [] },
      { id: 'KSI-CED-XYZ', name: 'Other', force: null, statements: [], followingInformation: [] },
    ],
  };

  it('embeds the SDR card for rules it covers and notes the ones it does not', () => {
    const html = buildControlGuidanceHtml(guidance, rules, {
      generatedAt: FIXED_DATE,
      sdr: { label: 'my-sdr.json', cards: { 'KSI-CED-RAT': '<div class="CARD">sdr card</div>' } },
    });
    expect(html).toContain('<div class="sdr-entry"><div class="part-label">In my-sdr.json</div><div class="CARD">sdr card</div></div>');
    expect(html).toContain('<p class="sdr-missing">Not in my-sdr.json</p>');
    expect(html).toContain('Mapped rules include their entries from <strong>my-sdr.json</strong>.');
  });

  it('prompts to open an SDR when none is loaded', () => {
    const html = buildControlGuidanceHtml(guidance, rules, { generatedAt: FIXED_DATE });
    expect(html).toContain('Open an SDR in the FedRAMP view');
    expect(html).not.toContain('sdr-entry');
  });
});

describe('control titles', () => {
  const titles = { 'AC-02': 'Account Management', 'AC-02 (01)': 'Automated System Account Management', 'XX-09 (01)': 'Orphan' };

  it('prefixes enhancement titles with the base control title', () => {
    expect(controlTitle('AC-02', titles)).toBe('Account Management');
    expect(controlTitle('AC-02 (01)', titles)).toBe('Account Management | Automated System Account Management');
    expect(controlTitle('XX-09 (01)', titles)).toBe('Orphan');
    expect(controlTitle('AC-99', titles)).toBeNull();
  });

  it('shows the title in the control card header', () => {
    const guidance = { controls: { AC: { 'AC-02 (01)': { parts: { _: { agency_actions: 'A', fedramp_guidance: 'G', notes: null } } } } } };
    const html = buildControlGuidanceHtml(guidance, {}, { generatedAt: FIXED_DATE, controlTitles: titles });
    expect(html).toMatch(/AC-02 \(01\)<\/span><span class="enum-title">Account Management \| Automated System Account Management<\/span>/);
  });

  it('has a title for every control in the guidance file', () => {
    const real = readJson('nist-800-53-rev5-control-titles.json');
    const ids = Object.values(readJson('AgencyControlGuidance.controls.merged.json').controls).flatMap(f => Object.keys(f));
    expect(ids.filter(id => !real[id])).toEqual([]);
  });
});

describe('buildControlGuidanceHtml controlFilter', () => {
  const guidance = {
    controls: {
      AT: {
        'AT-02': { parts: { _: { agency_actions: 'A', fedramp_guidance: 'G', notes: null } } },
        'AT-03': { parts: { _: { agency_actions: 'B', fedramp_guidance: 'G', notes: null } } },
      },
      SI: { 'SI-05': { parts: { _: { agency_actions: 'C', fedramp_guidance: 'G', notes: null } } } },
    },
  };

  it('shows only the filtered controls, recounts families and drops empty ones', () => {
    const html = buildControlGuidanceHtml(guidance, {}, { generatedAt: FIXED_DATE, controlFilter: new Set(['AT-02']) });
    expect(html).toContain('>AT-02<');
    expect(html).not.toContain('>AT-03<');
    expect(html).not.toContain('>SI-05<');
    expect(html).toContain('<span class="group-count">1</span>');
  });

  it('says so when nothing matches', () => {
    const html = buildControlGuidanceHtml(guidance, {}, { generatedAt: FIXED_DATE, controlFilter: new Set() });
    expect(html).toContain('No controls in the guidance file match this baseline.');
  });
});
