// Every published document type from https://github.com/fedramp/schemas that the
// editor's schema picker offers. fedramp-common-definitions-schema-2026-06-24.json
// is deliberately excluded — it's only used for $ref resolution, not editable directly.
export const SCHEMA_CATALOG = [
  { file: 'fedramp-security-decision-record-schema-2026-06-24.json',        label: 'Security Decision Record (SDR)' },
  { file: 'fedramp-certification-package-overview-schema-2026-06-24.json',  label: 'Certification Package Overview (COP)' },
  { file: 'fedramp-ongoing-certification-report-schema-2026-06-24.json',    label: 'Ongoing Certification Report' },
  { file: 'fedramp-incident-report-schema-2026-06-24.json',                 label: 'Incident Report' },
  { file: 'fedramp-significant-change-notifications-schema-2026-06-24.json', label: 'Significant Change Notification' },
  { file: 'fedramp-accepted-vulnerability-info-schema-2026-06-24.json',     label: 'Accepted Vulnerability Info' },
  { file: 'fedramp-vulnerability-detail-report-schema-2026-06-24.json',     label: 'Vulnerability Detail Report' },
  { file: 'fedramp-historical-ver-activity-schema-2026-06-24.json',         label: 'Historical Vulnerability Activity' },
  { file: 'fedramp-advisor-information-schema-2026-06-24.json',             label: 'Advisor Information' },
  { file: 'fedramp-assessor-information-schema-2026-06-24.json',            label: 'Assessor Information' },
];
