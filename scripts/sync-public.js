#!/usr/bin/env node
/**
 * Fetches the FedRAMP schema/rules files this app depends on and writes them
 * to public/. Run with: bun run sync
 *
 * All source repos are public, so no auth/token is required. The schema list
 * is discovered dynamically (every *.json file in the repo root) rather than
 * hardcoded, since upstream renames files from time to time.
 */

import { writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';

const SCHEMAS_REPO = 'fedramp/schemas';
const clean = process.argv.includes('--clean');

async function listRootJsonFiles(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/`, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} listing ${repo}`);
  const items = await res.json();
  return items.filter(i => i.type === 'file' && i.name.endsWith('.json'));
}

// Pinned to a specific commit (rather than a moving branch) so a re-sync is
// reproducible and doesn't silently pull in unreviewed upstream changes. This
// single file also carries the Rev5 NIST control baseline (FRR.FRC.data.rev5.CSF
// ['FRC-CSF-BSL']), so no separate control-baseline source is needed.
const FRMR_URL = 'https://raw.githubusercontent.com/FedRAMP/rules/12fe1b60f578ab448c26d143baac99d16d8bfe14/fedramp-consolidated-rules.json';

async function fetchFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

mkdirSync('public', { recursive: true });

// --clean wipes only the files this script itself owns (top-level public/*.json
// matching fedramp-*), never public/samples/ — this is not atomic: if the fetch
// loop below fails partway, public/ is left missing files until a successful re-run.
if (clean) {
  const removed = readdirSync('public', { withFileTypes: true })
    .filter(d => d.isFile() && /^fedramp-.*\.json$/.test(d.name))
    .map(d => d.name);
  for (const name of removed) {
    rmSync(`public/${name}`);
    console.log(`🗑  removed public/${name}`);
  }
  console.log(`Cleaned ${removed.length} file(s).`);
}

const schemaFiles = await listRootJsonFiles(SCHEMAS_REPO);

const targets = [
  { url: FRMR_URL, label: 'FRMR rules', dest: 'public/fedramp-consolidated-rules.json' },
  ...schemaFiles.map(f => ({
    url: f.download_url,
    label: f.name.replace('fedramp-', '').replace('.json', ''),
    dest: `public/${f.name}`,
  })),
];

let anyFailed = false;
for (const { url, label, dest } of targets) {
  process.stdout.write(`⬇  ${label} → ${dest} ... `);
  try {
    const content = await fetchFile(url);
    JSON.parse(content); // validate JSON before writing
    writeFileSync(dest, content);
    console.log('✓');
  } catch (err) {
    console.log(`✗  ${err.message}`);
    anyFailed = true;
  }
}

if (anyFailed) process.exit(1);
