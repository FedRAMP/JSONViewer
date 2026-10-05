#!/usr/bin/env node
/**
 * Builds public/nist-800-53-rev5-control-titles.json — { "AC-02": "Account
 * Management", "AC-02 (01)": "Automated System Account Management", ... } —
 * from NIST's OSCAL SP 800-53 Rev 5 catalog, for the Control Guidance view's
 * control headers. Keys match AgencyControlGuidance.controls.merged.json.
 * Run with: bun run sync:titles (also part of bun run sync).
 *
 * Only the titles are kept, so the viewer doesn't ship the ~10 MB catalog.
 */

import { writeFileSync, mkdirSync } from 'fs';

// Pinned to a specific commit (rather than a moving branch) so a re-sync is
// reproducible and doesn't silently pull in unreviewed upstream changes.
const CATALOG_URL = 'https://raw.githubusercontent.com/usnistgov/oscal-content/78650f02ad9321bb7b817846f8fbd4f2bcd620de/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json';
const DEST = 'public/nist-800-53-rev5-control-titles.json';

// "ac-2" -> "AC-02", "ac-2.1" -> "AC-02 (01)"
function toGuidanceControlId(oscalId) {
  const m = /^([a-z]{2})-(\d+)(?:\.(\d+))?$/i.exec(oscalId);
  if (!m) return null;
  const [, family, num, enh] = m;
  const base = `${family.toUpperCase()}-${num.padStart(2, '0')}`;
  return enh ? `${base} (${enh.padStart(2, '0')})` : base;
}

process.stdout.write(`⬇  NIST SP 800-53 Rev 5 control titles → ${DEST} ... `);
try {
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${CATALOG_URL}`);
  const { catalog } = await res.json();

  const titles = {};
  function collect(controls) {
    for (const control of controls || []) {
      const id = toGuidanceControlId(control.id);
      if (id && typeof control.title === 'string') titles[id] = control.title;
      collect(control.controls);
    }
  }
  for (const group of catalog.groups || []) collect(group.controls);

  mkdirSync('public', { recursive: true });
  writeFileSync(DEST, JSON.stringify(titles, null, 2) + '\n');
  console.log(`✓ (${Object.keys(titles).length} controls)`);
} catch (err) {
  console.log(`✗  ${err.message}`);
  process.exit(1);
}
