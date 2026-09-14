export interface BuyerDetails {
  email: string;
  name: string;
  virtualRegion: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseBuyerDetails(input: {
  email?: unknown;
  name?: unknown;
  virtual_region?: unknown;
}): BuyerDetails | null {
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const virtualRegion =
    typeof input.virtual_region === 'string' ? input.virtual_region.trim() : '';
  if (!EMAIL.test(email) || !name || !virtualRegion) return null;
  return { email, name, virtualRegion };
}
