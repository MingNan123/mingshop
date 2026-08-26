import { describe, expect, it, vi } from 'vitest';
import { uploadDigitalFile, validateDigitalFile } from './digitalFile';
import type { StorageProvider } from '../storage/provider';

describe('digital deliverables', () => {
  it('accepts common digital files without MIME-specific restrictions', () => {
    expect(validateDigitalFile(new File(['pdf'], 'guide.pdf', { type: 'application/pdf' }))).toBeNull();
    expect(validateDigitalFile(new File(['zip'], 'RuoYi-Vue-master.zip', { type: 'application/x-zip-compressed' }))).toBeNull();
    expect(validateDigitalFile(new File(['docx'], 'manual.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))).toBeNull();
    expect(validateDigitalFile(new File(['bin'], 'archive.7z', { type: 'application/x-7z-compressed' }))).toBeNull();
    expect(validateDigitalFile(new File(['data'], 'unknown.bin', { type: '' }))).toBeNull();
    expect(validateDigitalFile(new File([], 'empty.zip', { type: 'application/zip' }))).toMatch(/non-empty/);
  });

  it('rejects files over the 100 MB limit', () => {
    const file = { size: 100 * 1024 * 1024 + 1, name: 'large.zip', type: 'application/zip' } as File;
    expect(validateDigitalFile(file)).toMatch(/100 MB/);
  });

  it('uploads under an immutable unique key with private metadata', async () => {
    const put = vi.fn<StorageProvider['put']>();
    const storage: StorageProvider = { put, get: vi.fn(), delete: vi.fn() };
    const file = new File(['hello'], 'My guide.pdf', { type: 'application/pdf' });
    const saved = await uploadDigitalFile(storage, file);

    expect(saved).toMatchObject({ name: 'My guide.pdf', mime: 'application/pdf', size: 5 });
    expect(saved.key).toMatch(/^deliverables\/[0-9a-f-]+\/My-guide\.pdf$/);
    expect(put).toHaveBeenCalledWith(
      saved.key,
      expect.any(ArrayBuffer),
      'application/pdf',
      { cacheControl: 'private, no-store' },
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
