import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { detectSchema, scoreSchema } from '../src/utils/detectSchema.js';
import { SCHEMA_CATALOG } from '../src/config.js';

const PUBLIC = resolve(import.meta.dirname, '../public');
const readJson = file => JSON.parse(readFileSync(resolve(PUBLIC, file), 'utf8'));
const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const readSample = file => JSON.parse(readFileSync(resolve(FIXTURES, file.replace(/\.json$/, '.sample.json')), 'utf8'));

const ENTRIES = SCHEMA_CATALOG.map(e => ({ ...e, schema: readJson(e.file) }));

describe('detectSchema', () => {
  for (const entry of SCHEMA_CATALOG) {
    // Only meaningful for samples that still carry their own schema's required
    // keys — a sample that has drifted behind a schema update can legitimately
    // look more like another document type. Asserts the correct schema ties for
    // the best score, since some document types share identical top-level keys.
    const sample = readSample(entry.file);
    const current = (readJson(entry.file).required || []).every(k => k in sample);
    it.skipIf(!current)(`ranks ${entry.label} best for its sample fixture`, () => {
      const detected = detectSchema(ENTRIES, sample);
      const own = ENTRIES.find(e => e.file === entry.file);
      expect(scoreSchema(detected.schema, sample)).toBe(scoreSchema(own.schema, sample));
    });
  }

  it('distinguishes advisor from assessor by their name field', () => {
    const base = { logo: 'x', serviceDescription: 'x', contactInformation: {}, servicesOffered: [] };
    expect(detectSchema(ENTRIES, { ...base, advisorName: 'A' }).label).toBe('Advisor Information');
    expect(detectSchema(ENTRIES, { ...base, assessorName: 'A', a2laId: '1', a2laAccreditationDate: '2026-01-01' }).label)
      .toBe('Assessor Information');
  });

  it('detects the SDR from its sample fixture', () => {
    const sdr = SCHEMA_CATALOG[0];
    const sample = readSample(sdr.file);
    expect(detectSchema(ENTRIES, sample).file).toBe(sdr.file);
  });

  it('honors a $schema pointer naming a catalog file', () => {
    const data = { $schema: 'https://www.fedramp.gov/schemas/fedramp-vulnerability-detail-report-schema-2026-06-24.json', reportPeriod: {} };
    expect(detectSchema(ENTRIES, data).label).toBe('Vulnerability Detail Report');
  });

  it('ignores a $schema pointer that names no catalog file', () => {
    const sdr = SCHEMA_CATALOG[0];
    const sample = { ...readSample(sdr.file), $schema: 'https://example.com/unknown.json' };
    expect(detectSchema(ENTRIES, sample).file).toBe(sdr.file);
  });

  it('prefers the schema whose matched keys have the right type', () => {
    // A VDR that mentions acceptedVulnerabilities as a string (a pointer to the
    // separate AVI report) used to tie with Accepted Vulnerability Info.
    const data = {
      certificationPackageOverviewUri: 'https://example.com',
      reportPeriod: { from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z' },
      acceptedVulnerabilities: 'Reported separately.',
      vulnerabilities: [],
    };
    expect(detectSchema(ENTRIES, data).label).toBe('Vulnerability Detail Report');
  });

  it('returns null for non-object data', () => {
    expect(detectSchema(ENTRIES, null)).toBeNull();
    expect(detectSchema(ENTRIES, [1, 2])).toBeNull();
    expect(detectSchema(ENTRIES, 'x')).toBeNull();
  });

  it('returns null when no schema shares any top-level key', () => {
    expect(detectSchema(ENTRIES, { totallyUnrelated: 1 })).toBeNull();
  });
});

describe('scoreSchema', () => {
  const schema = { properties: { a: {}, b: {}, c: {} }, required: ['a', 'b'] };

  it('penalizes unknown keys and missing required keys', () => {
    expect(scoreSchema(schema, { a: 1, b: 1 })).toBe(2);
    expect(scoreSchema(schema, { a: 1, b: 1, z: 1 })).toBe(1);
    expect(scoreSchema(schema, { a: 1 })).toBe(-1);
  });

  it('counts a declared key with the wrong JSON type as unknown', () => {
    const typed = { properties: { a: { type: 'array' }, b: { type: 'string' } } };
    expect(scoreSchema(typed, { a: [], b: 'x' })).toBe(2);
    expect(scoreSchema(typed, { a: 'x', b: 'x' })).toBe(0);
  });

  it('ignores the $schema key', () => {
    expect(scoreSchema(schema, { $schema: 'x', a: 1, b: 1 })).toBe(2);
  });
});
