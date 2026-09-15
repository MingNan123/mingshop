import { describe, expect, it } from 'vitest';
import { publicOrigin, scheduledOrigin } from './origin';

describe('publicOrigin', () => {
  it('uses the request origin when a fresh deployment has no canonical origin', () => {
    expect(publicOrigin('https://new-store.example.workers.dev', undefined)).toBe(
      'https://new-store.example.workers.dev',
    );
  });

  it('uses and normalizes the configured HTTPS origin', () => {
    expect(publicOrigin('https://alternate.example', ' https://demo.minshop.dev/ ')).toBe(
      'https://demo.minshop.dev',
    );
  });

  it.each([
    '',
    'http://demo.minshop.dev',
    'https://demo.minshop.dev/store',
    'https://demo.minshop.dev/?preview=1',
    'https://demo.minshop.dev/#top',
    'https://user:pass@demo.minshop.dev',
  ])('rejects an unsafe configured value: %j', (configured) => {
    expect(() => publicOrigin('https://fallback.example', configured)).toThrow(
      /CANONICAL_ORIGIN/,
    );
  });
});

describe('scheduledOrigin', () => {
  it('prefers the configured canonical origin', () => {
    expect(scheduledOrigin('https://shop.example', 'https://learned.example')).toBe(
      'https://shop.example',
    );
  });

  it('falls back to a learned origin for older deployments', () => {
    expect(scheduledOrigin(undefined, 'https://shop.example')).toBe('https://shop.example');
  });

  it('returns null when cron has no trustworthy origin', () => {
    expect(scheduledOrigin(undefined, null)).toBeNull();
  });

  it('rejects malformed learned origins', () => {
    expect(() => scheduledOrigin(undefined, 'javascript:alert(1)')).toThrow(/HTTP/);
    expect(() => scheduledOrigin(undefined, 'https://shop.example/orders')).toThrow(/origin/);
  });
});
