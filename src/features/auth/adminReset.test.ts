import { describe, expect, it } from 'vitest';
import { signAdminResetToken, verifyAdminResetToken } from './adminReset';

describe('admin password reset tokens', () => {
  it('accepts a current token before expiry', async () => {
    const token = await signAdminResetToken('secret', 'old-hash', 900, 1_000);
    await expect(verifyAdminResetToken(token, 'secret', 'old-hash', 1_899)).resolves.toBe(true);
  });

  it('expires and is invalidated by a password change', async () => {
    const token = await signAdminResetToken('secret', 'old-hash', 900, 1_000);
    await expect(verifyAdminResetToken(token, 'secret', 'old-hash', 1_900)).resolves.toBe(false);
    await expect(verifyAdminResetToken(token, 'secret', 'new-hash', 1_100)).resolves.toBe(false);
  });

  it('rejects a token signed for another deployment', async () => {
    const token = await signAdminResetToken('secret-a', 'hash', 900, 1_000);
    await expect(verifyAdminResetToken(token, 'secret-b', 'hash', 1_100)).resolves.toBe(false);
  });
});
