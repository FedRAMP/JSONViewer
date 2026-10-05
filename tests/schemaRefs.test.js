import { describe, it, expect } from 'vitest';
import { inlineCommonDefs, resolveLocalRef } from '../src/utils/schemaRefs.js';

const COMMON_ID = 'https://fedramp.gov/schemas/fedramp-common-definitions-schema-2026-06-24.json';

describe('resolveLocalRef', () => {
  it('resolves a top-level $defs ref', () => {
    const schema = { $defs: { widgetId: { type: 'string' } } };
    expect(resolveLocalRef(schema, { $ref: '#/$defs/widgetId' })).toBe(schema.$defs.widgetId);
  });

  it('resolves a ref nested inside properties', () => {
    const schema = { properties: { foo: { properties: { bar: { type: 'string' } } } } };
    expect(resolveLocalRef(schema, { $ref: '#/properties/foo/properties/bar' })).toBe(schema.properties.foo.properties.bar);
  });

  it('returns the node unchanged when it has no $ref', () => {
    const node = { type: 'string' };
    expect(resolveLocalRef({}, node)).toBe(node);
  });

  it('fails open, returning the original node, when the ref target is missing', () => {
    const node = { $ref: '#/$defs/missing' };
    expect(resolveLocalRef({ $defs: {} }, node)).toBe(node);
  });
});

describe('inlineCommonDefs', () => {
  it('returns the schema unchanged when there is no matching external ref', () => {
    const schema = { type: 'object', properties: { foo: { type: 'string' } } };
    const commonDefs = { $id: COMMON_ID, $defs: { bar: { type: 'string' } } };
    expect(inlineCommonDefs(schema, commonDefs)).toBe(schema);
  });

  it('returns the schema unchanged when commonDefs is missing $id or $defs', () => {
    const schema = { type: 'object' };
    expect(inlineCommonDefs(schema, null)).toBe(schema);
    expect(inlineCommonDefs(schema, {})).toBe(schema);
  });

  it('rewrites a direct external $ref to a local one and copies the def', () => {
    const schema = {
      type: 'object',
      properties: { id: { $ref: `${COMMON_ID}/$defs/widgetId` } },
    };
    const commonDefs = { $id: COMMON_ID, $defs: { widgetId: { type: 'string', minLength: 1 } } };
    const result = inlineCommonDefs(schema, commonDefs);
    expect(result.properties.id).toEqual({ $ref: '#/$defs/widgetId' });
    expect(result.$defs.widgetId).toEqual({ type: 'string', minLength: 1 });
  });

  it('also rewrites the fragment form of an external $ref (`<id>#/$defs/x`)', () => {
    const schema = {
      type: 'object',
      properties: { id: { $ref: `${COMMON_ID}#/$defs/widgetId` } },
    };
    const commonDefs = { $id: COMMON_ID, $defs: { widgetId: { type: 'string' } } };
    const result = inlineCommonDefs(schema, commonDefs);
    expect(result.properties.id).toEqual({ $ref: '#/$defs/widgetId' });
    expect(result.$defs.widgetId).toEqual({ type: 'string' });
  });

  // Regression test: fedramp-accepted-vulnerability-info-schema, fedramp-vulnerability-detail-report-schema,
  // and fedramp-historical-ver-activity-schema all directly reference commonDefs' `vulnerabilityDetail`,
  // which internally uses a *local* ref (`#/$defs/detection`) back into commonDefs itself. Before this fix,
  // that nested def was never copied over, leaving a dangling `#/$defs/detection` ref that Ajv couldn't
  // resolve — which crashed the form (blank page) for those three schemas.
  it('transitively inlines defs that are only reachable via a local #/$defs ref inside a copied def', () => {
    const schema = {
      type: 'object',
      properties: {
        vulnerabilities: {
          type: 'array',
          items: { $ref: `${COMMON_ID}/$defs/vulnerabilityDetail` },
        },
      },
    };
    const commonDefs = {
      $id: COMMON_ID,
      $defs: {
        vulnerabilityDetail: {
          type: 'object',
          properties: {
            detection: { $ref: '#/$defs/detection' },
            currentRating: { $ref: '#/$defs/nRating' },
          },
        },
        detection: { type: 'object', properties: { method: { type: 'string' } } },
        nRating: { type: 'string', enum: ['Low', 'Moderate', 'High'] },
        unrelatedDef: { type: 'string' },
      },
    };

    const result = inlineCommonDefs(schema, commonDefs);

    expect(result.$defs.vulnerabilityDetail).toBeDefined();
    expect(result.$defs.detection).toEqual(commonDefs.$defs.detection);
    expect(result.$defs.nRating).toEqual(commonDefs.$defs.nRating);
    // Refs inside the copied vulnerabilityDetail def remain valid local refs.
    expect(result.$defs.vulnerabilityDetail.properties.detection).toEqual({ $ref: '#/$defs/detection' });
    // Defs never referenced (directly or transitively) are not pulled in.
    expect(result.$defs.unrelatedDef).toBeUndefined();
  });

  it('does not infinite-loop on circular local refs between commonDefs', () => {
    const schema = { type: 'object', properties: { a: { $ref: `${COMMON_ID}/$defs/a` } } };
    const commonDefs = {
      $id: COMMON_ID,
      $defs: {
        a: { $ref: '#/$defs/b' },
        b: { $ref: '#/$defs/a' },
      },
    };
    const result = inlineCommonDefs(schema, commonDefs);
    expect(result.$defs.a).toEqual({ $ref: '#/$defs/b' });
    expect(result.$defs.b).toEqual({ $ref: '#/$defs/a' });
  });

  it('does not overwrite a $defs entry the schema already defines locally', () => {
    const schema = {
      type: 'object',
      $defs: { widgetId: { type: 'string', const: 'already-local' } },
      properties: { id: { $ref: `${COMMON_ID}/$defs/widgetId` } },
    };
    const commonDefs = { $id: COMMON_ID, $defs: { widgetId: { type: 'string', minLength: 99 } } };
    const result = inlineCommonDefs(schema, commonDefs);
    expect(result.$defs.widgetId).toEqual({ type: 'string', const: 'already-local' });
  });
});
