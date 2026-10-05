// Resolves a single local $ref (e.g. "#/$defs/foo") against schema's own tree,
// returning the node unchanged if it has no $ref, or the original node (fail
// open) if the ref target can't be found.
export function resolveLocalRef(schema, node) {
  if (!node?.$ref) return node;
  const path = node.$ref.replace(/^#\//, '').split('/');
  let target = schema;
  for (const segment of path) target = target?.[segment];
  return target ?? node;
}

// Copy any $defs referenced from an external common-definitions schema into the
// schema itself, replacing cross-schema $refs with local #/$defs/xxx refs. Follows
// local #/$defs/xxx refs *within* commonDefs transitively too (e.g. commonDefs'
// own vulnerabilityDetail def refs #/$defs/detection) so nothing is left dangling.
// This avoids Ajv needing to resolve external URIs at runtime.
export function inlineCommonDefs(schema, commonDefs) {
  if (!commonDefs?.$defs || !commonDefs?.$id) return schema;
  const escaped = commonDefs.$id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const externalRefRe = new RegExp('"' + escaped + '#?/\\$defs/([^"]+)"', 'g');
  const localRefRe = /"#\/\$defs\/([^"]+)"/g;

  const toLocal = text => text.replace(externalRefRe, (_, name) => `"#/$defs/${name}"`);
  function localDefNames(text) {
    const names = new Set();
    let m;
    localRefRe.lastIndex = 0;
    while ((m = localRefRe.exec(text))) names.add(m[1]);
    return names;
  }

  const schemaText = toLocal(JSON.stringify(schema));
  const queue = [...localDefNames(schemaText)];
  if (!queue.length) return schema;

  const result = JSON.parse(schemaText);
  result.$defs = result.$defs || {};

  const seen = new Set();
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    if (result.$defs[name] || !commonDefs.$defs[name]) continue;
    const defText = toLocal(JSON.stringify(commonDefs.$defs[name]));
    result.$defs[name] = JSON.parse(defText);
    queue.push(...localDefNames(defText));
  }

  return result;
}
