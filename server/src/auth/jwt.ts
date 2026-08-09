import { sign, verify } from 'hono/jwt';
import { getJwtSecret } from './secret';

const EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days — personal/small-scale tool, favor not logging people out constantly over tight expiry. No refresh-token flow; expiry just forces re-login.

export interface AuthClaims {
  sub: string;
  email: string;
  displayName: string;
  exp: number;
}

export async function signToken(user: { id: string; email: string; displayName: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: user.id, email: user.email, displayName: user.displayName, exp: now + EXPIRY_SECONDS }, getJwtSecret());
}

/** Throws if the token is missing/malformed/expired/mis-signed — callers (the auth middleware) turn that into a 401. */
export async function verifyToken(token: string): Promise<AuthClaims> {
  return (await verify(token, getJwtSecret(), 'HS256')) as unknown as AuthClaims;
}
