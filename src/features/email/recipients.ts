export const EMAIL_RECIPIENT_LIMIT = 20;

export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseEmailRecipients(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const part of (raw ?? '').split(/[\s,;]+/)) {
    const email = part.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(email);
    if (recipients.length >= EMAIL_RECIPIENT_LIMIT) break;
  }
  return recipients;
}

export function normalizeEmailRecipients(values: Array<FormDataEntryValue | string>): {
  recipients: string[];
  invalid: string[];
} {
  const flattened = values
    .map((value) => String(value ?? ''))
    .join('\n');
  const candidates = parseEmailRecipients(flattened);
  return {
    recipients: candidates.filter(isValidEmailAddress),
    invalid: candidates.filter((email) => !isValidEmailAddress(email)),
  };
}

export function serializeEmailRecipients(recipients: string[]): string {
  return recipients.join('\n');
}
