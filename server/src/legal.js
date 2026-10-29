// Version of the Terms of Service / Privacy Policy / Cookie Policy text shipped with this release.
// Bump it whenever those texts change materially; new sign-ups record the version they accepted.
export const POLICY_VERSION = '2026-10-28';

// Public facts the legal pages need. Operator details come from configuration so that nothing is invented.
export function legalInfo(config) {
  const o = config.operator;
  return {
    version: POLICY_VERSION,
    configured: Boolean(o.name && o.email),
    operator: { name: o.name, address: o.address, email: o.email, jurisdiction: o.jurisdiction, processors: o.processors },
    retention: { sessionDays: Math.round(config.sessionTtlMs / 86400000), backupDays: config.backupKeepDays },
  };
}
