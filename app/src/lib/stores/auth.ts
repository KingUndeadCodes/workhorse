import { writable } from 'svelte/store';
import type { User } from '$domain';

const STORAGE_KEY = 'anvil.auth';

interface StoredAuth {
  token: string;
  user: User;
}

function loadStored(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

const stored = loadStored();

export const authToken = writable<string | null>(stored?.token ?? null);
export const currentUser = writable<User | null>(stored?.user ?? null);

function persist(auth: StoredAuth | null) {
  if (auth) localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  else localStorage.removeItem(STORAGE_KEY);
}

function setAuth(auth: StoredAuth) {
  authToken.set(auth.token);
  currentUser.set(auth.user);
  persist(auth);
}

/** Clears auth state — called on logout, or when api.ts sees a 401 (expired/invalid token). */
export function clearAuth() {
  authToken.set(null);
  currentUser.set(null);
  persist(null);
}

async function readError(res: Response): Promise<string> {
  return (await res.json().catch(() => ({}))).error ?? `${res.status} ${res.statusText}`;
}

// login/signup use raw fetch, not api.ts's helpers — those attach a token that doesn't
// exist yet, and importing api.ts here would make api.ts <-> auth.ts circular.
export async function login(email: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const { token, user } = await res.json();
  setAuth({ token, user });
}

export async function signup(email: string, password: string, displayName: string): Promise<void> {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, displayName }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const { token, user } = await res.json();
  setAuth({ token, user });
}

export function logout(): void {
  clearAuth();
}
