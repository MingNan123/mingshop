import type { StorageProvider } from '../storage/provider.ts';

// Keep a reasonable safety limit while allowing larger digital products.
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export function validateDigitalFile(file: File): string | null {
  if (file.size < 1) return 'Choose a non-empty deliverable file.';
  if (file.size > MAX_FILE_BYTES) return 'Deliverable files must be 100 MB or smaller.';
  // Digital products are intentionally not restricted to a small MIME allowlist.
  // Browsers and operating systems frequently report different MIME types for
  // the same file (especially ZIP, EPUB, M4A, Office files, and archives).
  // The file is stored privately, so extension/MIME validation is not needed here.
  return null;
}

export async function uploadDigitalFile(
  storage: StorageProvider,
  file: File,
): Promise<{ key: string; name: string; mime: string; size: number }> {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'download';
  const key = `deliverables/${crypto.randomUUID()}/${safeName}`;
  await storage.put(key, await file.arrayBuffer(), file.type || 'application/octet-stream', {
    cacheControl: 'private, no-store',
  });
  return { key, name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
}
