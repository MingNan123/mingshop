export interface BuyerDetails {
  email: string | null;
  name: string | null;
  virtualRegion: string | null;
}

export interface BuyerRequirements {
  email: boolean;
  name: boolean;
  virtualRegion: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseBuyerDetails(input: {
  email?: unknown;
  name?: unknown;
  virtual_region?: unknown;
}, requirements: BuyerRequirements): BuyerDetails | null {
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const virtualRegion =
    typeof input.virtual_region === 'string' ? input.virtual_region.trim() : '';
  if (requirements.email && !EMAIL.test(email)) return null;
  if (requirements.name && !name) return null;
  if (requirements.virtualRegion && !virtualRegion) return null;
  return {
    email: requirements.email ? email : null,
    name: requirements.name ? name : null,
    virtualRegion: requirements.virtualRegion ? virtualRegion : null,
  };
}

export function buyerRequirements(
  products: Array<{ collect_email?: number; collect_name?: number; collect_virtual_region?: number }>,
): BuyerRequirements {
  return {
    email: products.some((p) => p.collect_email === 1),
    name: products.some((p) => p.collect_name === 1),
    virtualRegion: products.some((p) => p.collect_virtual_region === 1),
  };
}
