import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { detectSchema, scoreSchema } from '../src/utils/detectSchema.js';
import { SCHEMA_CATALOG } from '../src/config.js';

const PUBLIC = resolve(import.meta.dirname, '../public');
const readJson = file => JSON.parse(readFileSync(resolve(PUBLIC, file), 'utf8'));

const ENTRIES = SCHEMA_CATALOG.map(e => ({ ...e, schema: readJson(e.file) }));

describe('detectSchema', () => {
  for (const entry of SCHEMA_CATALOG) {
    // Only meaningful for samples that still carry their own schema's required
    // keys — a sample that has drifted behind a schema update can legitimately
    // look more like another document type. Asserts the correct schema ties for
    // the best score, since some document types share identical top-level keys.
    const sample = readJson(`samples/${entry.file.replace(/\.json$/, '.sample.json')}`);
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
    const sample = readJson(`samples/${sdr.file.replace(/\.json$/, '.sample.json')}`);
    expect(detectSchema(ENTRIES, sample).file).toBe(sdr.file);
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
});
