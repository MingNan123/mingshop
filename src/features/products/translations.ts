export const PRODUCT_TRANSLATION_LOCALES = ['zh-Hant', 'en', 'ko', 'ja'] as const;
export type ProductTranslationLocale = (typeof PRODUCT_TRANSLATION_LOCALES)[number];

export interface ProductTranslation {
  name?: string;
  description?: string;
}

export type ProductTranslations = Partial<Record<ProductTranslationLocale, ProductTranslation>>;

export function parseProductTranslations(raw: string | null | undefined): ProductTranslations {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const result: ProductTranslations = {};
    for (const locale of PRODUCT_TRANSLATION_LOCALES) {
      const entry = value?.[locale];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const source = entry as Record<string, unknown>;
      const name = typeof source.name === 'string' ? source.name.trim() : '';
      const description = typeof source.description === 'string' ? source.description.trim() : '';
      if (name || description) result[locale] = { ...(name ? { name } : {}), ...(description ? { description } : {}) };
    }
    return result;
  } catch {
    return {};
  }
}

export function productTranslationsFromForm(form: FormData): string | null {
  const result: ProductTranslations = {};
  for (const locale of PRODUCT_TRANSLATION_LOCALES) {
    const suffix = locale.replace('-', '_').toLowerCase();
    const name = String(form.get(`translation_${suffix}_name`) ?? '').trim();
    const description = String(form.get(`translation_${suffix}_description`) ?? '').trim();
    if (name || description) result[locale] = { ...(name ? { name } : {}), ...(description ? { description } : {}) };
  }
  return Object.keys(result).length ? JSON.stringify(result) : null;
}
