const CLIENT_PRICE_FIELDS = [
  'price',
  'price_cents',
  'unit_price',
  'unit_price_cents',
  'amount',
  'amount_cents',
  'total',
  'total_cents',
  'currency',
] as const;

export function clientControlledPriceFields(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const raw = value as Record<string, unknown>;
  return CLIENT_PRICE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(raw, field));
}

export function hasClientControlledPriceFields(value: unknown): boolean {
  return clientControlledPriceFields(value).length > 0;
}
