import { colorForCategory, esc, forceClass, renderRuleText, wrapPage } from './htmlPreview';
import { ruleForce, ruleStatements } from './frmr';

// NIST SP 800-53 Rev 5 control family names, for the family group headings.
export const NIST_FAMILY_NAMES = {
  AC: 'Access Control',
  AT: 'Awareness and Training',
  AU: 'Audit and Accountability',
  CA: 'Assessment, Authorization, and Monitoring',
  CM: 'Configuration Management',
  CP: 'Contingency Planning',
  IA: 'Identification and Authentication',
  IR: 'Incident Response',
  MA: 'Maintenance',
  MP: 'Media Protection',
  PE: 'Physical and Environmental Protection',
  PL: 'Planning',
  PM: 'Program Management',
  PS: 'Personnel Security',
  PT: 'PII Processing and Transparency',
  RA: 'Risk Assessment',
  SA: 'System and Services Acquisition',
  SC: 'System and Communications Protection',
  SI: 'System and Information Integrity',
  SR: 'Supply Chain Risk Management',
};

const RULE_ID = /^[A-Z]+-[A-Z]+-[A-Z]+$/;
const OSCAL_CONTROL = /^([a-z]{2})-(\d+)(?:\.(\d+))?$/i;

// FRMR cites controls OSCAL-style ("at-2", "at-2.2"); the guidance file keys
// them "AT-02" / "AT-02 (02)". Returns null for anything else.
export function toGuidanceControlId(oscalId) {
  const m = OSCAL_CONTROL.exec(String(oscalId).trim());
  if (!m) return null;
  const [, family, num, enh] = m;
  const base = `${family.toUpperCase()}-${String(Number(num)).padStart(2, '0')}`;
  return enh ? `${base} (${String(Number(enh)).padStart(2, '0')})` : base;
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

// { "AT-02 (02)": [{ id, name, force, statements, followingInformation }] }
// for every FRR requirement / KSI in FRMR that lists `controls`.
export function extractControlRuleMap(frmrData) {
  const map = {};
  function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isPlainObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (RULE_ID.test(key) && isPlainObject(value)) {
        if (!Array.isArray(value.controls)) continue;
        const rule = {
          id: key,
          name: typeof value.name === 'string' ? value.name : '',
          force: ruleForce(value),
          statements: ruleStatements(value),
          followingInformation: Array.isArray(value.following_information) ? value.following_information : [],
        };
        for (const control of new Set(value.controls.map(toGuidanceControlId).filter(Boolean))) {
          (map[control] ||= []).push(rule);
        }
      } else {
        walk(value);
      }
    }
  }
  walk(frmrData?.FRR);
  walk(frmrData?.KSI);
  for (const rules of Object.values(map)) rules.sort((a, b) => a.id.localeCompare(b.id));
  return map;
}

function idBadge(id) {
  return `<span class="enum-value" style="border-left-color:${colorForCategory(id)}">${esc(id)}</span>`;
}

function renderPart(key, part) {
  const rows = [
    ['Agency Actions', part?.agency_actions],
    ['FedRAMP Guidance', part?.fedramp_guidance],
    ['Notes', part?.notes],
  ]
    .filter(([, text]) => typeof text === 'string' && text.trim())
    .map(([label, text]) => `<tr><th>${label}</th><td>${esc(text)}</td></tr>`);
  if (!rows.length) return '';
  const heading = key === '_' ? '' : `<div class="part-label">Part ${esc(key)}</div>`;
  return `<div class="control-part">${heading}<table class="info-table"><tbody>${rows.join('')}</tbody></table></div>`;
}

// sdr: null (no document loaded) or { label, cards: { ruleId: cardHtml } }.
function renderSdrEntry(rule, sdr) {
  if (!sdr) return '';
  const card = sdr.cards[rule.id];
  if (!card) return `<p class="sdr-missing">Not in ${esc(sdr.label)}</p>`;
  return `<div class="sdr-entry"><div class="part-label">In ${esc(sdr.label)}</div>${card}</div>`;
}

function renderRule(rule, open, sdr) {
  const force = rule.force
    ? `<span class="force-badge ${forceClass(rule.force)}" title="Force of rule">${esc(rule.force)}</span>`
    : '';
  const summary = `<span class="item-label">${idBadge(rule.id)}${rule.name ? `<span class="enum-title">${esc(rule.name)}</span>` : ''}</span>${force ? `<span class="item-status">${force}</span>` : ''}`;
  const body = renderRuleText(rule) + renderSdrEntry(rule, sdr);
  if (!body) return `<div class="item-details item-leaf"><div class="item-summary">${summary}</div></div>`;
  return `<details class="item-details"${open}><summary class="item-summary">${summary}</summary><div class="item-body">${body}</div></details>`;
}

// "AC-02" -> "Account Management"; enhancements follow NIST's convention of
// prefixing the base control's title: "AC-02 (01)" -> "Account Management |
// Automated System Account Management". Null when the title is unknown.
export function controlTitle(controlId, titles = {}) {
  const own = titles[controlId];
  if (!own) return null;
  const base = /^([A-Z]{2}-\d{2}) \(\d{2}\)$/.exec(controlId)?.[1];
  return base && titles[base] ? `${titles[base]} | ${own}` : own;
}

function renderControl(controlId, control, rules, attrs, sdr, titles) {
  const parts = Object.entries(control?.parts || {}).map(([key, part]) => renderPart(key, part)).join('');
  const ruleCount = rules.length
    ? `<span class="rule-count">${rules.length} rule${rules.length === 1 ? '' : 's'}</span>`
    : '<span class="rule-count rule-count-none">no mapped rules</span>';
  const mapped = rules.length
    ? `<details class="sub-section"${attrs.section}><summary class="sub-label">Mapped FedRAMP Rules (${rules.length})</summary><div class="sub-body">${rules.map(r => renderRule(r, attrs.rule, sdr)).join('')}</div></details>`
    : '';
  const title = controlTitle(controlId, titles);
  const titleHtml = title ? `<span class="enum-title">${esc(title)}</span>` : '';
  return `<details class="item-details control-card"${attrs.control}><summary class="item-summary"><span class="item-label">${idBadge(controlId)}${titleHtml}</span><span class="item-status">${ruleCount}</span></summary><div class="item-body">${parts}${mapped}</div></details>`;
}

// Renders the agency control guidance file ({ controls: { FAMILY: { "AC-02": {
// parts: { a: { agency_actions, fedramp_guidance, notes } } } } } }) as a
// standalone page: NIST family groups -> control cards -> parts, plus each
// FRR/KSI mapped to that control. By default families are open and control /
// rule cards closed; `expanded` / `collapsed` open or close everything.
export function buildControlGuidanceHtml(guidance, controlRules = {}, options = {}) {
  const title = options.title || 'Agency Control Guidance';
  // options.sdr: { label, cards } from buildItemCardIndex for the document
  // open in the Document view, embedded under each mapped rule.
  const sdr = options.sdr || null;
  // options.controlTitles: { "AC-02": "Account Management", ... } from
  // public/nist-800-53-rev5-control-titles.json (bun run sync:titles).
  const controlTitles = options.controlTitles || {};
  const all = options.expanded ? ' open' : '';
  const attrs = {
    family: options.collapsed ? '' : ' open',
    control: all,
    section: options.collapsed ? '' : ' open',
    rule: all,
  };

  const families = Object.entries(guidance?.controls || {}).map(([family, controls]) => {
    const cards = Object.entries(controls || {})
      .map(([id, control]) => renderControl(id, control, controlRules[id] || [], attrs, sdr, controlTitles))
      .join('');
    if (!cards) return '';
    const name = NIST_FAMILY_NAMES[family];
    const count = Object.keys(controls).length;
    return `<details class="group-section"${attrs.family}><summary class="group-summary"><span class="group-code">${esc(family)}</span>${name ? `<span class="group-name">${esc(name)}</span>` : ''}<span class="group-count">${count}</span></summary><div class="group-body">${cards}</div></details>`;
  }).join('');

  const banner = sdr
    ? `<p class="guidance-note">Mapped rules include their entries from <strong>${esc(sdr.label)}</strong>.</p>`
    : '<p class="guidance-note">Open an SDR in the Document view to see its entry for each mapped rule here.</p>';
  const body = families
    ? `<div class="guidance-body">${banner}${families}</div>`
    : '<p class="empty-note">No controls found in the guidance file.</p>';
  return wrapPage(title, body, options.generatedAt);
}
