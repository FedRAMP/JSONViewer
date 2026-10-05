import { patchEnumField } from './schemaPatch';

export function patchRV5Schema(schema, controls) {
  if (!controls.length) return;
  // New 2026-06-24 SDR: controlId directly on each item
  const newField = schema?.properties?.securityControls?.items?.properties?.controlId;
  // Old CR26 SDR: controlId in $defs
  const oldField = schema?.$defs?.nistSecurityControl?.properties?.controlId;

  const enumValues = ['', ...controls];
  const enumNames = ['— Select a control —', ...controls];
  for (const field of [newField, oldField]) {
    patchEnumField(field, enumValues, enumNames);
  }
}

// The Rev5 control baseline lives inside the FRMR consolidated rules document at
// FRR.FRC.data.rev5.CSF['FRC-CSF-BSL'].varies_by_class, keyed by certification class
// (b/c/d — Class A has no control baseline). Reshapes it to the
// { classKey: { family: [controlIds] } } shape extractNISTControls expects.
export function extractRev5BaselineByClass(frmrData) {
  const byClass = frmrData?.FRR?.FRC?.data?.rev5?.CSF?.['FRC-CSF-BSL']?.varies_by_class;
  if (!byClass || typeof byClass !== 'object') return {};

  const result = {};
  for (const [classKey, classData] of Object.entries(byClass)) {
    if (classData?.rev5_controls_list && typeof classData.rev5_controls_list === 'object') {
      result[classKey] = classData.rev5_controls_list;
    }
  }
  return result;
}

export function extractNISTControls(data) {
  if (!data || typeof data !== 'object') return [];

  const ids = new Set();
  for (const classData of Object.values(data)) {
    if (!classData || typeof classData !== 'object') continue;
    for (const controls of Object.values(classData)) {
      if (!Array.isArray(controls)) continue;
      for (const id of controls) {
        if (typeof id === 'string') ids.add(id);
      }
    }
  }

  return [...ids].sort((a, b) => {
    const [famA, numA = ''] = a.split('-');
    const [famB, numB = ''] = b.split('-');
    if (famA !== famB) return famA.localeCompare(famB);
    return numA.localeCompare(numB, undefined, { numeric: true });
  });
}