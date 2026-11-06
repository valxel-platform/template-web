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

/** A failed call. `traceId` is the trace the API named in its traceresponse header (if any) and
 * `endpoint` the route called, so a reported error can be tied to the backend's own errors. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly endpoint = "",
    readonly traceId = "",
  ) {
    super(`API ${String(status)}: ${detail}`);
    this.name = "ApiError";
  }
}

const TRACERESPONSE = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

/** The trace id from a W3C traceresponse header, or "". */
export function traceIdOf(res: Response): string {
  return TRACERESPONSE.exec(res.headers.get("traceresponse")?.trim() ?? "")?.[1] ?? "";
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
        throw new ApiError(
          res.status,
          problem.detail ?? problem.title ?? res.statusText,
          "GET /api/v1/greetings",
          traceIdOf(res),
        );
      }
      return (await res.json()) as Greeting;
    },
  };
}
