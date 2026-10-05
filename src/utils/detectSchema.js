// FedRAMP data files don't carry a $schema pointer, so guess the document type
// from its top-level keys: reward keys the schema declares, penalize keys it
// doesn't and required keys that are missing. Returns the best-scoring catalog
// entry, or null if nothing matches any key at all.
export function scoreSchema(schema, data) {
  const props = new Set(Object.keys(schema?.properties || {}));
  const keys = Object.keys(data || {});
  const matched = keys.filter(k => props.has(k)).length;
  if (!matched) return -Infinity;
  const unknown = keys.length - matched;
  const missingRequired = (schema?.required || []).filter(k => !(k in data)).length;
  return matched - unknown - 2 * missingRequired;
}

export function detectSchema(entries, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
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
