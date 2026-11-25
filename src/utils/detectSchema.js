import { resolveLocalRef } from './schemaRefs';

// Guess a document's type. A `$schema` pointer naming a catalog file wins
// outright. Otherwise score each schema by the document's top-level keys:
// reward keys the schema declares with a matching JSON type, penalize keys it
// doesn't (or declares with a different type) and required keys that are
// missing. Returns the best-scoring catalog entry, or null if nothing matches
// any key at all.

function typeMatches(prop, value) {
  if (!prop?.type) return true;
  return [].concat(prop.type).some(t => {
    switch (t) {
      case 'array': return Array.isArray(value);
      case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
      case 'integer': return Number.isInteger(value);
      case 'null': return value === null;
      default: return typeof value === t;
    }
  });
}

export function scoreSchema(schema, data) {
  const props = schema?.properties || {};
  const keys = Object.keys(data || {}).filter(k => k !== '$schema');
  const matched = keys.filter(k => k in props && typeMatches(resolveLocalRef(schema, props[k]), data[k])).length;
  if (!matched) return -Infinity;
  const unknown = keys.length - matched;
  const missingRequired = (schema?.required || []).filter(k => !(k in data)).length;
  return matched - unknown - 2 * missingRequired;
}

function schemaFileName(data) {
  const ref = typeof data.$schema === 'string' ? data.$schema : '';
  return ref.split(/[?#]/)[0].split('/').pop();
}

export function detectSchema(entries, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const declared = schemaFileName(data);
  const byPointer = declared && entries.find(entry => entry.file === declared);
  if (byPointer) return byPointer;
  let best = null;
  let bestScore = -Infinity;
  for (const entry of entries) {
    const score = scoreSchema(entry.schema, data);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}
