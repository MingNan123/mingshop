/**
 * Stable origin for absolute URLs embedded in public, shared responses.
 * A configured value is deployment policy, so fail closed on malformed input
 * instead of silently putting a request-derived hostname into the shared cache.
 */
export function publicOrigin(
  requestOrigin: string,
  configuredOrigin: string | undefined,
): string {
  if (configuredOrigin === undefined) return new URL(requestOrigin).origin;

  const value = configuredOrigin.trim();
  if (!value) throw new Error('CANONICAL_ORIGIN must not be empty');

  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('CANONICAL_ORIGIN must be an HTTPS origin without a path');
  }
  return url.origin;
}

/**
 * Resolve the absolute origin used by scheduled jobs, which have no request URL.
 * Deployment policy wins over the learned origin so cron-generated links stay on
 * the canonical host. Older installations without CANONICAL_ORIGIN can continue
 * using the origin remembered from live traffic.
 */
export function scheduledOrigin(
  configuredOrigin: string | undefined,
  learnedOrigin: string | null,
): string | null {
  if (configuredOrigin !== undefined) {
    return publicOrigin(configuredOrigin, configuredOrigin);
  }
  if (!learnedOrigin) return null;

  const url = new URL(learnedOrigin);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Stored store_url must be an HTTP(S) origin');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Stored store_url must be an origin without credentials, path, query, or fragment');
  }
  return url.origin;
}
