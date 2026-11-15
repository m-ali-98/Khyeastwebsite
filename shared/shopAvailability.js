/**
 * One storefront visibility rule for public navigation and purchase actions.
 * The locale flag keeps the Iran-only shop out of translated sites; the
 * persisted display switch lets operators pause shopping without removing the
 * public product catalogue.
 */
export function isStorefrontEnabled(localeEnabled, display) {
  return Boolean(localeEnabled) && display?.enabled !== false;
}
