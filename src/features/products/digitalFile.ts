import type { StorageProvider } from '../storage/provider.ts';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Map<string, Set<string>>([
  ['application/pdf', new Set(['pdf'])],
  // Browsers on Windows/Edge and some file pickers report ZIP as
  // application/x-zip-compressed rather than application/zip.
  ['application/zip', new Set(['zip'])],
  ['application/x-zip-compressed', new Set(['zip'])],
  ['application/x-zip', new Set(['zip'])],
  ['multipart/x-zip', new Set(['zip'])],
  ['application/epub+zip', new Set(['epub'])],
  ['audio/mpeg', new Set(['mp3'])],
  // M4A is commonly reported as either audio/mp4 or audio/x-m4a.
  ['audio/mp4', new Set(['m4a'])],
  ['audio/x-m4a', new Set(['m4a'])],
  ['text/plain', new Set(['txt'])],
]);

export function validateDigitalFile(file: File): string | null {
  if (file.size < 1) return 'Choose a non-empty deliverable file.';
  if (file.size > MAX_FILE_BYTES) return 'Deliverable files must be 25 MB or smaller.';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type.toLowerCase().split(';', 1)[0].trim();
  if (!ALLOWED.get(mime)?.has(ext)) {
    return 'Use a PDF, ZIP, EPUB, MP3, M4A, or plain-text file.';
  }
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
