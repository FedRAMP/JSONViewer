import { extractFamilyNames, extractFRMRRequirements, extractRuleForces, extractRuleTexts, patchFRMRSchema } from './utils/frmr';
import { extractNISTControls, extractRev5BaselineByClass, patchRV5Schema } from './utils/rv5';
import { fetchRaw, fetchSchema, simpleFetch } from './utils/schemaLoader';
import { detectSchema } from './utils/detectSchema';
import { buildItemCardIndex, buildPreviewHtml } from './utils/htmlPreview';
import { buildControlGuidanceHtml, extractControlRuleMap } from './utils/controlGuidance';
import { SCHEMA_CATALOG } from './config';

const FRMR_URL = 'fedramp-consolidated-rules.json';
const COMMON_DEFS_FILE = 'fedramp-common-definitions-schema-2026-06-24.json';
const GUIDANCE_URL = 'AgencyControlGuidance.controls.merged.json';
const CONTROL_TITLES_URL = 'nist-800-53-rev5-control-titles.json';

const fileInput = document.getElementById('file-input');
const openBtn = document.getElementById('open-btn');
const expandBtn = document.getElementById('expand-btn');
const collapseBtn = document.getElementById('collapse-btn');
const schemaSelect = document.getElementById('schema-select');
const fileNameEl = document.getElementById('file-name');
const statusEl = document.getElementById('status');
const dropHint = document.getElementById('drop-hint');
const preview = document.getElementById('preview');
const main = document.getElementById('main');
const documentControls = document.getElementById('document-controls');
const viewDocumentBtn = document.getElementById('view-document');
const viewGuidanceBtn = document.getElementById('view-guidance');

// Catalog entries that loaded successfully, each with its patched schema.
let entries = [];
let currentData = null;
let currentFileName = null;
let familyNames = {};
let ruleForces = {};
let ruleTexts = {};
// The sandboxed iframe can't run script, so expand/collapse-all re-renders
// with every <details> open or closed. null = default (requirement/KSI cards
// closed, everything else open).
let expandMode = null; // null | 'expanded' | 'collapsed'
let view = 'document'; // 'document' | 'guidance'
let guidanceData = null;
let controlRules = {};
let controlTitles = {};

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
  statusEl.hidden = false;
  dropHint.hidden = true;
  preview.hidden = true;
}

function selectedEntry() {
  return entries.find(e => e.file === schemaSelect.value) ?? null;
}

function setView(next) {
  if (next === view) return;
  view = next;
  expandMode = null;
  viewDocumentBtn.classList.toggle('active', view === 'document');
  viewGuidanceBtn.classList.toggle('active', view === 'guidance');
  viewDocumentBtn.setAttribute('aria-pressed', String(view === 'document'));
  viewGuidanceBtn.setAttribute('aria-pressed', String(view === 'guidance'));
  documentControls.hidden = view !== 'document';
  fileNameEl.hidden = view !== 'document';
  render();
}

function showPreview(html) {
  preview.srcdoc = html;
  statusEl.hidden = true;
  dropHint.hidden = true;
  preview.hidden = false;
}

function renderGuidance() {
  expandBtn.disabled = false;
  collapseBtn.disabled = false;
  const renderOptions = {
    collapsed: expandMode === 'collapsed',
    expanded: expandMode === 'expanded',
    groupNames: familyNames,
    ruleForces,
  };
  // Embed the open document's cards (e.g. an SDR's requirement/KSI entries)
  // under each mapped rule.
  const entry = selectedEntry();
  const sdr = currentData && entry
    ? { label: currentFileName, cards: buildItemCardIndex(entry.schema, currentData, renderOptions) }
    : null;
  showPreview(buildControlGuidanceHtml(guidanceData, controlRules, {
    ...renderOptions,
    title: 'Agency Control Guidance',
    sdr,
    controlTitles,
  }));
}

function render() {
  if (view === 'guidance' && guidanceData) {
    renderGuidance();
    return;
  }
  const entry = selectedEntry();
  const hasDoc = Boolean(currentData && entry);
  expandBtn.disabled = !hasDoc;
  collapseBtn.disabled = !hasDoc;
  if (!hasDoc) {
    statusEl.hidden = true;
    dropHint.hidden = false;
    preview.hidden = true;
    return;
  }
  showPreview(buildPreviewHtml(entry.schema, currentData, {
    title: entry.label,
    collapsed: expandMode === 'collapsed',
    expanded: expandMode === 'expanded',
    groupNames: familyNames,
    ruleForces,
    ruleTexts,
  }));
}

async function init() {
  const [frmrData, commonDefs, guidance, titles] = await Promise.all([
    simpleFetch(FRMR_URL), fetchRaw(COMMON_DEFS_FILE), simpleFetch(GUIDANCE_URL), simpleFetch(CONTROL_TITLES_URL),
  ]);
  controlTitles = titles || {};
  guidanceData = guidance;
  controlRules = frmrData ? extractControlRuleMap(frmrData) : {};
  viewGuidanceBtn.disabled = !guidanceData;
  viewGuidanceBtn.title = guidanceData ? '' : `${GUIDANCE_URL} could not be loaded`;
  const requirements = frmrData ? extractFRMRRequirements(frmrData) : [];
  const controls = frmrData ? extractNISTControls(extractRev5BaselineByClass(frmrData)) : [];
  familyNames = frmrData ? extractFamilyNames(frmrData) : {};
  ruleForces = frmrData ? extractRuleForces(frmrData) : {};
  ruleTexts = frmrData ? extractRuleTexts(frmrData) : {};

  const loaded = await Promise.all(SCHEMA_CATALOG.map(async entry => {
    const schema = await fetchSchema(entry.file, commonDefs);
    if (!schema) return null;
    patchFRMRSchema(schema, requirements);
    patchRV5Schema(schema, controls);
    return { ...entry, schema };
  }));
  entries = loaded.filter(Boolean);

  if (!entries.length) {
    showStatus('Failed to load any FedRAMP schemas. Check your network connection.', true);
    return;
  }

  for (const entry of entries) {
    schemaSelect.add(new Option(entry.label, entry.file));
  }
  schemaSelect.disabled = false;
  openBtn.disabled = false;
  render();
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch {
      showStatus(`${file.name} is not valid JSON.`, true);
      return;
    }
    currentData = data;
    currentFileName = file.name;
    fileNameEl.textContent = currentFileName;
    fileNameEl.title = currentFileName;
    const detected = detectSchema(entries, data);
    if (detected) schemaSelect.value = detected.file;
    expandMode = null;
    if (view !== 'document') setView('document');
    else render();
  };
  reader.onerror = () => showStatus(`Could not read ${file.name}.`, true);
  reader.readAsText(file);
}

openBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) loadFile(file);
  e.target.value = '';
});
schemaSelect.addEventListener('change', render);
viewDocumentBtn.addEventListener('click', () => setView('document'));
viewGuidanceBtn.addEventListener('click', () => setView('guidance'));
expandBtn.addEventListener('click', () => { expandMode = 'expanded'; render(); });
collapseBtn.addEventListener('click', () => { expandMode = 'collapsed'; render(); });

// Drag-and-drop anywhere on the page. The iframe swallows drag events, so
// disable its pointer events while a drag is in progress.
let dragDepth = 0;
window.addEventListener('dragenter', e => {
  e.preventDefault();
  if (dragDepth++ === 0) {
    main.classList.add('dragging');
    preview.style.pointerEvents = 'none';
  }
});
window.addEventListener('dragleave', () => {
  if (--dragDepth === 0) {
    main.classList.remove('dragging');
    preview.style.pointerEvents = '';
  }
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  main.classList.remove('dragging');
  preview.style.pointerEvents = '';
  const file = e.dataTransfer?.files?.[0];
  if (file && !openBtn.disabled) loadFile(file);
});

init();
