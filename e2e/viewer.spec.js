import { test, expect } from '@playwright/test';
import path from 'path';
import { SCHEMA_CATALOG } from '../src/config.js';

const SAMPLES_DIR = path.resolve(import.meta.dirname, '../public/samples');

function trackErrors(page) {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

async function ready(page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open JSON File' })).toBeEnabled();
}

for (const entry of SCHEMA_CATALOG) {
  test(`${entry.label} sample renders`, async ({ page }) => {
    const errors = trackErrors(page);
    await ready(page);

    const samplePath = path.join(SAMPLES_DIR, entry.file.replace(/\.json$/, '.sample.json'));
    await page.locator('#file-input').setInputFiles(samplePath);
    await page.locator('#schema-select').selectOption(entry.file);

    const frame = page.frameLocator('[data-testid="html-preview-iframe"]');
    await expect(frame.locator('.page-header h1')).toContainText(entry.label);
    await expect(frame.locator('.top-section').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('shows the open-file hint before any file is loaded', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#drop-hint')).toBeVisible();
  await expect(page.locator('[data-testid="html-preview-iframe"]')).toBeHidden();
});

test('auto-detects the document type when a file is opened', async ({ page }) => {
  await ready(page);
  const sdr = SCHEMA_CATALOG[0];
  await page.locator('#file-input').setInputFiles(
    path.join(SAMPLES_DIR, sdr.file.replace(/\.json$/, '.sample.json')),
  );
  await expect(page.locator('#schema-select')).toHaveValue(sdr.file);
  await expect(page.locator('#file-name')).toHaveText(path.basename(sdr.file.replace(/\.json$/, '.sample.json')));
});

test('changing the document type re-renders with the chosen schema', async ({ page }) => {
  await ready(page);
  const sdr = SCHEMA_CATALOG[0];
  await page.locator('#file-input').setInputFiles(
    path.join(SAMPLES_DIR, sdr.file.replace(/\.json$/, '.sample.json')),
  );
  const other = SCHEMA_CATALOG[1];
  await page.locator('#schema-select').selectOption(other.file);
  const frame = page.frameLocator('[data-testid="html-preview-iframe"]');
  await expect(frame.locator('.page-header h1')).toContainText(other.label);
});

test('SDR items show ID and status in the summary, and Collapse/Expand all work', async ({ page }) => {
  await ready(page);
  const sdr = SCHEMA_CATALOG[0];
  await page.locator('#file-input').setInputFiles(
    path.join(SAMPLES_DIR, sdr.file.replace(/\.json$/, '.sample.json')),
  );
  const frame = page.frameLocator('[data-testid="html-preview-iframe"]');
  // The SDR sample's security controls carry a controlId + implementation status.
  const control = frame.locator('details.item-details', { hasText: 'AC-02' }).first();
  await expect(control.locator('> summary .status-badge')).toBeVisible();
  await expect(control.locator('> .item-body')).not.toContainText('Control Implementation Status');
  // Default: grouped requirement/KSI/control cards start closed.
  await expect(frame.locator('.group-body > details.item-details[open]')).toHaveCount(0);
  await expect(frame.locator('.group-body > details.item-details').first()).toBeVisible();

  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(frame.locator('.top-section').first()).toBeVisible();
  await expect(frame.locator('details[open]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(frame.locator('details:not([open])')).toHaveCount(0);
});

test('SDR requirements and KSIs are grouped into named families', async ({ page }) => {
  await ready(page);
  const sdr = SCHEMA_CATALOG[0];
  await page.locator('#file-input').setInputFiles(
    path.join(SAMPLES_DIR, sdr.file.replace(/\.json$/, '.sample.json')),
  );
  const frame = page.frameLocator('[data-testid="html-preview-iframe"]');
  const afc = frame.locator('details.group-section', { has: frame.locator('.group-code', { hasText: /^AFC$/ }) });
  await expect(afc.locator('> summary .group-name')).toHaveText('Addressing FedRAMP Communication');
  await expect(afc.locator('.item-details')).toHaveCount(1);
  await expect(afc.locator('.item-details .force-badge')).toHaveText('MUST');
  const afcCard = afc.locator('.group-body > details.item-details').first();
  await afcCard.locator('> summary').click();
  const ruleText = afcCard.locator('> .item-body > details.rule-text');
  await expect(ruleText).not.toHaveAttribute('open', '');
  await ruleText.locator('> summary').click();
  await expect(ruleText.locator('.rule-statement').first()).toContainText('Providers');

  await expect(frame.locator('.group-code', { hasText: /^KSI-CED$/ })).toBeVisible();

  // The control guidance view's embedded SDR cards don't repeat the rule text.
  await page.getByRole('button', { name: 'Control Guidance' }).click();
  await expect(frame.locator('.sdr-entry').first()).toBeAttached();
  await expect(frame.locator('.sdr-entry .rule-text')).toHaveCount(0);
});

test('reports invalid JSON without crashing', async ({ page }) => {
  await ready(page);
  await page.locator('#file-input').setInputFiles({
    name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ not json'),
  });
  await expect(page.locator('#status')).toContainText('broken.json is not valid JSON.');
});

test('Control Guidance view shows controls with their mapped KSIs/FRRs', async ({ page }) => {
  const errors = trackErrors(page);
  await ready(page);
  await page.getByRole('button', { name: 'Control Guidance' }).click();
  await expect(page.locator('#document-controls')).toBeHidden();

  const frame = page.frameLocator('[data-testid="html-preview-iframe"]');
  await expect(frame.locator('.page-header h1')).toHaveText('Agency Control Guidance');
  const at = frame.locator('details.group-section', { has: frame.locator('.group-code', { hasText: /^AT$/ }) });
  await expect(at.locator('> summary .group-name')).toHaveText('Awareness and Training');

  const card = at.locator('details.control-card', { has: frame.locator('> summary .enum-value', { hasText: /^AT-02$/ }) });
  await expect(card.locator('> summary .enum-title')).toHaveText('Literacy Training and Awareness');
  await card.locator('> summary').click();
  await expect(card.locator('> .item-body')).toContainText('Agency Actions');
  await expect(card.locator('.sub-label', { hasText: 'Mapped FedRAMP Rules' })).toBeVisible();
  await expect(card.locator('.enum-value', { hasText: 'KSI-CED-RAT' })).toBeVisible();

  await page.getByRole('button', { name: 'Document' }).click();
  await expect(page.locator('#document-controls')).toBeVisible();
  await expect(page.locator('#drop-hint')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Control Guidance embeds the loaded SDR entry under each mapped rule', async ({ page }) => {
  await ready(page);
  const sdr = SCHEMA_CATALOG[0];
  const sampleName = sdr.file.replace(/\.json$/, '.sample.json');
  await page.locator('#file-input').setInputFiles(path.join(SAMPLES_DIR, sampleName));
  await page.getByRole('button', { name: 'Control Guidance' }).click();

  const frame = page.frameLocator('[data-testid="html-preview-iframe"]');
  await expect(frame.locator('.guidance-note')).toContainText(sampleName);
  await page.getByRole('button', { name: 'Expand all' }).click();
  const card = frame.locator('details.control-card', { has: frame.locator('> summary .enum-value', { hasText: /^AT-02$/ }) });
  const entry = card.locator('.sdr-entry').first();
  await expect(entry.locator('.part-label')).toHaveText(`In ${sampleName}`);
  await expect(entry.locator('.item-summary .status-badge')).toBeVisible();
});
