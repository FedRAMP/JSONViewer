export function patchEnumField(field, enumValues, enumNames) {
  if (!field) return;
  field.enum = enumValues;
  field.enumNames = enumNames;
}
