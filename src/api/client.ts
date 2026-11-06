/** A typed client for the provider's API. The contract test (client.pact.test.ts) pins what this
 * client relies on, so the provider cannot break it without its pipeline failing first.
 *
 * Calls go to the BFF on the same origin with the session cookie; the BFF adds the person's token.
 * Writes must send the CSRF token (see auth.ts) as X-XSRF-TOKEN. */

export interface Greeting {
  message: string;
}

export interface ApiClient {
  greeting(name: string): Promise<Greeting>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`API ${String(status)}: ${detail}`);
  }
}

export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ApiClient {
  return {
    async greeting(name) {
      const res = await fetchImpl(`${baseUrl}/api/v1/greetings?name=${encodeURIComponent(name)}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        // Errors follow RFC 9457 (problem details); show their title, never raw bodies.
        const problem = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
        throw new ApiError(res.status, problem.detail ?? problem.title ?? res.statusText);
      }
      return (await res.json()) as Greeting;
    },
  };
}
