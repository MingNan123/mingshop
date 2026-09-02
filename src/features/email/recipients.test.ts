import { describe, expect, it } from 'vitest';
import {
  EMAIL_RECIPIENT_LIMIT,
  normalizeEmailRecipients,
  parseEmailRecipients,
  serializeEmailRecipients,
} from './recipients';

describe('email recipients', () => {
  it('parses comma, newline, semicolon, and whitespace separated addresses', () => {
    expect(parseEmailRecipients('a@example.com, b@example.com\nc@example.com; d@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ]);
  });

  it('dedupes case-insensitively while preserving the first spelling', () => {
    expect(parseEmailRecipients('Owner@Example.com owner@example.com OTHER@example.com')).toEqual([
      'Owner@Example.com',
      'OTHER@example.com',
    ]);
  });

  it('separates invalid addresses before saving', () => {
    expect(normalizeEmailRecipients(['owner@example.com', 'bad-address', 'team@example.com'])).toEqual({
      recipients: ['owner@example.com', 'team@example.com'],
      invalid: ['bad-address'],
    });
  });

  it('caps the list to a bounded number of recipients', () => {
    const raw = Array.from({ length: EMAIL_RECIPIENT_LIMIT + 3 }, (_, i) => `u${i}@example.com`).join(' ');
    expect(parseEmailRecipients(raw)).toHaveLength(EMAIL_RECIPIENT_LIMIT);
  });

  it('serializes recipients as newline separated rows for editing', () => {
    expect(serializeEmailRecipients(['a@example.com', 'b@example.com'])).toBe('a@example.com\nb@example.com');
  });
});
