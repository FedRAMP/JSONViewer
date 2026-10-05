import { describe, it, expect } from 'vitest';
import { extractFamilyNames, extractFRMRRequirements, extractRuleForces, extractRuleTexts, formatForceByClass, patchFRMRSchema } from '../src/utils/frmr.js';
import { patchRV5Schema } from '../src/utils/rv5.js';

const REQUIREMENTS = [
  { id: 'KSI-CNA-01', title: 'KSI-CNA-01 – Cloud Native Architecture' },
  { id: 'KSI-IAM-01', title: 'KSI-IAM-01 – Identity and Access Management' },
];

const CONTROLS = ['AC-01', 'AC-02', 'AU-02'];

describe('patchFRMRSchema', () => {
  it('patches the new 2026-06-24 SDR shape (fedRampRequirements.items.properties.frrID)', () => {
    const schema = {
      properties: { fedRampRequirements: { items: { properties: { frrID: { type: 'string', example: 'x' } } } } },
    };
    patchFRMRSchema(schema, REQUIREMENTS);
    const field = schema.properties.fedRampRequirements.items.properties.frrID;
    expect(field.enum).toEqual(['', 'KSI-CNA-01', 'KSI-IAM-01']);
    expect(field.enumNames).toEqual([
      '— Select a requirement —',
      'KSI-CNA-01 – Cloud Native Architecture',
      'KSI-IAM-01 – Identity and Access Management',
    ]);
    expect(field.example).toBeUndefined();
  });

  it('patches the old CR26 SDR shape ($defs.fedRAMPRequirement.properties.frId)', () => {
    const schema = { $defs: { fedRAMPRequirement: { properties: { frId: { type: 'string' } } } } };
    patchFRMRSchema(schema, REQUIREMENTS);
    expect(schema.$defs.fedRAMPRequirement.properties.frId.enum).toEqual(['', 'KSI-CNA-01', 'KSI-IAM-01']);
  });

  it('does nothing when requirements list is empty', () => {
    const field = { type: 'string' };
    const schema = { properties: { fedRampRequirements: { items: { properties: { frrID: field } } } } };
    patchFRMRSchema(schema, []);
    expect(field.enum).toBeUndefined();
  });

  it('is a no-op when the target field is absent from the schema', () => {
    expect(() => patchFRMRSchema({}, REQUIREMENTS)).not.toThrow();
  });
});

describe('patchRV5Schema', () => {
  it('patches the new 2026-06-24 SDR shape (securityControls.items.properties.controlId)', () => {
    const schema = { properties: { securityControls: { items: { properties: { controlId: { type: 'string' } } } } } };
    patchRV5Schema(schema, CONTROLS);
    const field = schema.properties.securityControls.items.properties.controlId;
    expect(field.enum).toEqual(['', 'AC-01', 'AC-02', 'AU-02']);
    expect(field.enumNames).toEqual(['— Select a control —', 'AC-01', 'AC-02', 'AU-02']);
  });

  it('patches the old CR26 SDR shape ($defs.nistSecurityControl.properties.controlId)', () => {
    const schema = { $defs: { nistSecurityControl: { properties: { controlId: { type: 'string' } } } } };
    patchRV5Schema(schema, CONTROLS);
    expect(schema.$defs.nistSecurityControl.properties.controlId.enum).toEqual(['', 'AC-01', 'AC-02', 'AU-02']);
  });

  it('does nothing when controls list is empty', () => {
    const field = { type: 'string' };
    const schema = { properties: { securityControls: { items: { properties: { controlId: field } } } } };
    patchRV5Schema(schema, []);
    expect(field.enum).toBeUndefined();
  });
});

describe('patchFRMRSchema KSI titles (viewer-only)', () => {
  it('patches ksiId with only the KSI entries', () => {
    const schema = { properties: { keySecurityIndicators: { items: { properties: { ksiId: { type: 'string' } } } } } };
    patchFRMRSchema(schema, REQUIREMENTS);
    const field = schema.properties.keySecurityIndicators.items.properties.ksiId;
    expect(field.enum).toEqual(['', 'KSI-CNA-01', 'KSI-IAM-01']);
    expect(field.enumNames[1]).toBe('KSI-CNA-01 – Cloud Native Architecture');
  });
});

describe('extractFRMRRequirements', () => {
  it('includes requirements whose statements vary by certification class', () => {
    const frmr = { FRR: { CDS: { data: { all: { CSO: {
      'CDS-CSO-AVR': { name: 'Availability Reporting', affects: ['Providers'], varies_by_class: { a: { statement: 'x' } } },
      'CDS-CSO-AGY': { name: 'Agency Only', affects: ['Agencies'], varies_by_class: { a: { statement: 'x' } } },
    } } } } } };
    expect(extractFRMRRequirements(frmr)).toEqual([{ id: 'CDS-CSO-AVR', title: 'CDS-CSO-AVR – Availability Reporting' }]);
  });
});

describe('extractFamilyNames', () => {
  it('maps FRR short codes and KSI ids to their family names', () => {
    const frmr = {
      FRR: { AFC: { info: { name: 'Addressing FedRAMP Communication' } }, BAD: { info: {} } },
      KSI: { CED: { id: 'KSI-CED', name: 'Cybersecurity Education' } },
    };
    expect(extractFamilyNames(frmr)).toEqual({
      AFC: 'Addressing FedRAMP Communication',
      'KSI-CED': 'Cybersecurity Education',
    });
  });

  it('returns an empty map for missing data', () => {
    expect(extractFamilyNames(null)).toEqual({});
  });
});

describe('formatForceByClass', () => {
  it('returns the single force when every class agrees', () => {
    expect(formatForceByClass({ a: 'MUST', b: 'MUST' })).toBe('MUST');
  });

  it('collapses adjacent classes with the same force into ranges', () => {
    expect(formatForceByClass({ d: 'MUST', a: 'SHOULD', b: 'MUST', c: 'MUST' })).toBe('A: SHOULD · B–D: MUST');
    expect(formatForceByClass({ a: 'MAY', b: 'SHOULD', c: 'MAY' })).toBe('A: MAY · B: SHOULD · C: MAY');
  });

  it('returns null for no classes', () => {
    expect(formatForceByClass({})).toBeNull();
  });
});

describe('extractRuleForces', () => {
  it('reads direct and per-class forces for FRR and KSI rules', () => {
    const frmr = {
      FRR: { CDS: { data: { all: { CSO: {
        'CDS-CSO-PUB': { name: 'Public Information', force: 'MUST' },
        'CDS-CSO-AVR': { name: 'Availability', varies_by_class: { a: { force: 'SHOULD' }, b: { force: 'MUST' } } },
        'CDS-CSO-NONE': { name: 'No force', statement: 'x' },
      } } } } },
      KSI: { CNA: { indicators: { 'KSI-CNA-MAT': { name: 'Minimizing', force: 'MUST' } } } },
    };
    expect(extractRuleForces(frmr)).toEqual({
      'CDS-CSO-PUB': 'MUST',
      'CDS-CSO-AVR': 'A: SHOULD · B: MUST',
      'KSI-CNA-MAT': 'MUST',
    });
  });
});

describe('extractRuleTexts', () => {
  it('collects single, per-class, and following-information text for FRR and KSI rules', () => {
    const frmr = {
      FRR: { CDS: { data: { all: { CSO: {
        'CDS-CSO-PUB': { name: 'Public', statement: 'Publish it.', following_information: ['FedRAMP ID'] },
        'CDS-CSO-AVR': { name: 'Avail', varies_by_class: { b: { statement: 'B.' }, a: { statement: 'A.' } } },
        'CDS-CSO-NIL': { name: 'Nothing' },
      } } } } },
      KSI: { CED: { indicators: { 'KSI-CED-RAT': { name: 'Training', statement: 'Train.' } } } },
    };
    expect(extractRuleTexts(frmr)).toEqual({
      'CDS-CSO-PUB': { statements: [{ label: null, text: 'Publish it.' }], followingInformation: ['FedRAMP ID'] },
      'CDS-CSO-AVR': { statements: [{ label: 'Class A', text: 'A.' }, { label: 'Class B', text: 'B.' }], followingInformation: [] },
      'KSI-CED-RAT': { statements: [{ label: null, text: 'Train.' }], followingInformation: [] },
    });
  });
});
