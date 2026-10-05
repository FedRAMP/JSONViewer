import { patchEnumField } from './schemaPatch';

export function patchFRMRSchema(schema, requirements) {
  if (!requirements.length) return;
  // New 2026-06-24 SDR: frrID directly on each item
  const frrIDField = schema?.properties?.fedRampRequirements?.items?.properties?.frrID;
  // Old CR26 SDR: frId in $defs
  const frIdField = schema?.$defs?.fedRAMPRequirement?.properties?.frId;
  // Even older 20x schema
  const FR_IDField = schema?.$defs?.fedRAMP_requirement?.properties?.FR_ID;

  const enumValues = ['', ...requirements.map(r => r.id)];
  const enumNames = ['— Select a requirement —', ...requirements.map(r => r.title)];
  for (const field of [frrIDField, frIdField, FR_IDField]) {
    if (field) {
      patchEnumField(field, enumValues, enumNames);
      delete field.example;
    }
  }
  // Viewer-only (the editor keeps ksiId free-text): give KSI IDs their FRMR
  // titles too, so the rendered document shows e.g. "KSI-CED-RAT – Reviewing
  // All Training".
  const ksiIdField = schema?.properties?.keySecurityIndicators?.items?.properties?.ksiId;
  const ksis = requirements.filter(r => r.id.startsWith('KSI-'));
  if (ksiIdField && ksis.length) {
    patchEnumField(ksiIdField, ['', ...ksis.map(r => r.id)], ['— Select a KSI —', ...ksis.map(r => r.title)]);
  }
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function extractFRMRRequirements(frmrData) {
  const pattern = /^[A-Z]+-[A-Z]+-[A-Z]+$/;
  const collected = {};

  function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (pattern.test(key) && value && typeof value === 'object') {
        if ('affects' in value) {
          const a = value.affects;
          const hits = Array.isArray(a) ? a.includes('Providers') : String(a).includes('Providers');
          if (hits) collected[key] = value;
        } else {
          collected[key] = value;
        }
      } else {
        walk(value);
      }
    }
  }
  walk(frmrData);

  const ids = [];
  for (const [reqId, req] of Object.entries(collected)) {
    // A single statement, or one statement per certification class (Class A/B/C/D)
    // under varies_by_class — either way the requirement is cited by its plain ID.
    if (typeof req.name === 'string' && (typeof req.statement === 'string' || isPlainObject(req.varies_by_class))) {
      ids.push({ id: reqId, title: `${reqId} – ${req.name}` });
    } else if (typeof req.name === 'string' && req.varies_by_level && typeof req.varies_by_level === 'object') {
      for (const [levelId, level] of Object.entries(req.varies_by_level)) {
        if (level && typeof level.statement === 'string') {
          ids.push({ id: `${reqId}-${levelId}`, title: `${reqId}-${levelId} – ${req.name} (${levelId})` });
        }
      }
    }
  }
  return ids;
}

// Human-readable family names keyed by the ID prefix items use: FRR families by
// their short code (e.g. "AFC" -> "Addressing FedRAMP Communication"), KSI
// families by their full id (e.g. "KSI-CED" -> "Cybersecurity Education").
export function extractFamilyNames(frmrData) {
  const names = {};
  for (const [code, family] of Object.entries(frmrData?.FRR || {})) {
    if (typeof family?.info?.name === 'string') names[code] = family.info.name;
  }
  for (const [code, family] of Object.entries(frmrData?.KSI || {})) {
    if (typeof family?.name === 'string') names[family.id || `KSI-${code}`] = family.name;
  }
  return names;
}

const RULE_ID = /^[A-Z]+-[A-Z]+-[A-Z]+$/;

// Collapses { a: 'SHOULD', b: 'MUST', c: 'MUST', d: 'MUST' } into
// "A: SHOULD · B–D: MUST", or just "MUST" when every class agrees.
export function formatForceByClass(byClass) {
  const entries = Object.entries(byClass).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return null;
  if (entries.every(([, f]) => f === entries[0][1])) return entries[0][1];

  const runs = [];
  for (const [cls, force] of entries) {
    const last = runs[runs.length - 1];
    const adjacent = last && cls.charCodeAt(0) === last.to.charCodeAt(0) + 1;
    if (last && last.force === force && adjacent) last.to = cls;
    else runs.push({ from: cls, to: cls, force });
  }
  return runs
    .map(r => `${r.from.toUpperCase()}${r.to !== r.from ? `–${r.to.toUpperCase()}` : ''}: ${r.force}`)
    .join(' · ');
}

// A rule's force label: its own `force`, or per-class forces collapsed by
// formatForceByClass. Null when it declares none.
export function ruleForce(rule) {
  if (typeof rule?.force === 'string') return rule.force;
  if (!isPlainObject(rule?.varies_by_class)) return null;
  const byClass = {};
  for (const [cls, data] of Object.entries(rule.varies_by_class)) {
    if (typeof data?.force === 'string') byClass[cls] = data.force;
  }
  return formatForceByClass(byClass);
}

// A rule's statement(s): [{ label: null, text }] for a single statement, or one
// { label: "Class A", text } per certification class under varies_by_class.
export function ruleStatements(rule) {
  if (typeof rule?.statement === 'string') return [{ label: null, text: rule.statement }];
  if (!isPlainObject(rule?.varies_by_class)) return [];
  return Object.entries(rule.varies_by_class)
    .filter(([, data]) => typeof data?.statement === 'string')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cls, data]) => ({ label: `Class ${cls.toUpperCase()}`, text: data.statement }));
}

// Calls visit(ruleId, rule) for every FRR requirement / KSI in FRMR.
function forEachRule(frmrData, visit) {
  function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (RULE_ID.test(key) && isPlainObject(value)) visit(key, value);
      else walk(value);
    }
  }
  walk(frmrData?.FRR);
  walk(frmrData?.KSI);
}

// Viewer-only: { ruleId: forceLabel } for every FRR requirement / KSI that
// declares a force (MUST, SHOULD, MAY, ...), either directly or per
// certification class under varies_by_class.
export function extractRuleForces(frmrData) {
  const forces = {};
  forEachRule(frmrData, (id, rule) => {
    const force = ruleForce(rule);
    if (force) forces[id] = force;
  });
  return forces;
}

// Viewer-only: { ruleId: { statements, followingInformation } } for every FRR
// requirement / KSI with statement text, for the rule-text section of item cards.
export function extractRuleTexts(frmrData) {
  const texts = {};
  forEachRule(frmrData, (id, rule) => {
    const statements = ruleStatements(rule);
    const followingInformation = Array.isArray(rule.following_information) ? rule.following_information : [];
    if (statements.length || followingInformation.length) texts[id] = { statements, followingInformation };
  });
  return texts;
}
