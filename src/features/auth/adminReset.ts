import { credentialTag } from './session';
import { signToken, verifyToken } from './token';

const PURPOSE = 'admin-password-reset';

/** Create a short-lived token bound to the password that is current right now. */
export async function signAdminResetToken(
  signingKey: string,
  credential: string,
  ttlSeconds: number,
  nowSeconds: number,
): Promise<string> {
  const tag = await credentialTag(signingKey, credential);
  return signToken(`${PURPOSE}:${tag}`, signingKey, ttlSeconds, nowSeconds);
}

/** A password change alters the credential tag, invalidating every older link. */
export async function verifyAdminResetToken(
  token: string | null | undefined,
  signingKey: string,
  credential: string,
  nowSeconds: number,
): Promise<boolean> {
  const payload = await verifyToken(token, signingKey, nowSeconds);
  const tag = await credentialTag(signingKey, credential);
  return payload === `${PURPOSE}:${tag}`;
}
