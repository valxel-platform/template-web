/**
 * Signing in, through the product's BFF. The browser never holds a token: the BFF keeps them and
 * gives the browser a session cookie (HttpOnly, so no script here can read it either).
 *
 *   GET  /auth/me      who is signed in (and sets the XSRF-TOKEN cookie)
 *   GET  /auth/login   start signing in at the product's Keycloak realm
 *   POST /auth/logout  end the session; answers where to end the Keycloak session too
 */

export interface Session {
  authenticated: boolean;
  sub?: string;
  name?: string;
}

/** The CSRF token the BFF set (readable on purpose): send it back on every write. */
export function csrfToken(cookies: string = document.cookie): string {
  const hit = cookies
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("XSRF-TOKEN="));
  return hit ? decodeURIComponent(hit.slice("XSRF-TOKEN=".length)) : "";
}

export async function session(fetchImpl: typeof fetch = fetch): Promise<Session> {
  const res = await fetchImpl("/auth/me", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return { authenticated: false };
  return (await res.json()) as Session;
}

/* v8 ignore start -- a top-level navigation; jsdom can't navigate */
export function navigate(url: string): void {
  window.location.assign(url);
}
/* v8 ignore stop */

export function signIn(go: (url: string) => void = navigate): void {
  go("/auth/login");
}

export async function signOut(
  fetchImpl: typeof fetch = fetch,
  go: (url: string) => void = navigate,
): Promise<void> {
  const res = await fetchImpl("/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-XSRF-TOKEN": csrfToken(), Accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as { redirect?: string };
  go(body.redirect ?? "/");
}
