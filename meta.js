export const AUTHOR_EMAIL = 'steve@thehiveryiq.com';
export const CANONICAL_GATEWAY = 'https://mcp-swap.thehiveryiq.com';

export function renderSecurity() {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return [
    `Contact: mailto:${AUTHOR_EMAIL}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en',
    `Canonical: ${CANONICAL_GATEWAY}/.well-known/security.txt`,
    'Policy: https://thehiveryiq.com',
    '',
    '# Hive Civilization security disclosure contact',
  ].join('\n');
}
