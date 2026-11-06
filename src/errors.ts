/**
 * Error reporting with Sentry: uncaught errors and rejections with their stack, grouped into issues.
 * The SDLC tool takes Sentry's issue alerts as incident signals (/api/signals/sentry).
 *
 * Off unless the container has a DSN (SENTRY_DSN, written to /sentry.json by docker/32-sentry.sh).
 * Events go to this site's own /sentry/ path, which nginx forwards to Sentry, so the browser makes
 * no cross-origin calls and the CSP stays `connect-src 'self'`.
 *
 * What leaves the browser: the error's type, its stack (file, function, line) and the page's path.
 * Never error messages (they can echo what a person typed), query strings, cookies, headers, user
 * details, form values or console output. For PHI products use a Sentry plan covered by a BAA.
 */
import * as Sentry from "@sentry/react";
import { ApiError } from "./api/client";

export interface ErrorConfig {
  dsn: string;
  environment?: string;
  release?: string;
}

const pathOnly = (url?: string): string | undefined => {
  if (!url) return url;
  try {
    const u = new URL(url, window.location.origin);
    return u.origin + u.pathname;
  } catch {
    return undefined;
  }
};

// A request breadcrumb keeps its path, method and status only.
const httpData = (data: Record<string, unknown>) => ({
  url: pathOnly(String(data.url)),
  method: typeof data.method === "string" ? data.method : undefined,
  status_code: typeof data.status_code === "number" ? data.status_code : undefined,
});

/** Strips an event down to what may leave the browser, and ties a failed API call to the
 * backend's trace (tags trace_id, endpoint, status) so the SDLC tool sees one incident. */
export function scrub(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): Sentry.ErrorEvent {
  const error = hint?.originalException;
  if (error instanceof ApiError) {
    event.tags = {
      ...event.tags,
      ...(error.traceId ? { trace_id: error.traceId } : {}),
      ...(error.endpoint ? { endpoint: error.endpoint } : {}),
      status: String(error.status),
    };
  }
  delete event.user;
  delete event.extra;
  delete event.contexts?.state;
  if (event.request) {
    event.request = { url: pathOnly(event.request.url) };
  }
  for (const ex of event.exception?.values ?? []) {
    ex.value = undefined;
    for (const frame of ex.stacktrace?.frames ?? []) {
      delete frame.vars;
      frame.abs_path = pathOnly(frame.abs_path);
    }
  }
  delete event.message;
  event.logentry = undefined;
  event.breadcrumbs = (event.breadcrumbs ?? [])
    .filter((b) => b.category !== "console" && b.category !== "ui.input")
    .map((b) => ({
      category: b.category,
      level: b.level,
      timestamp: b.timestamp,
      type: b.type,
      data: b.data?.url ? httpData(b.data) : undefined,
    }));
  return event;
}

/** Reports an error the app handled (shown to the person) but that someone should fix. Does
 * nothing while error reporting is off. */
export function reportError(error: unknown): void {
  Sentry.captureException(error);
}

/** Starts Sentry from /sentry.json; resolves false when error reporting is off. */
export async function startErrors(
  load: () => Promise<Response> = () => fetch("/sentry.json"),
): Promise<boolean> {
  let config: ErrorConfig;
  try {
    const res = await load();
    if (!res.ok) return false;
    config = (await res.json()) as ErrorConfig;
  } catch {
    return false;
  }
  if (!config.dsn) return false;
  Sentry.init({
    dsn: config.dsn,
    tunnel: "/sentry/envelope/",
    environment: config.environment || undefined,
    release: config.release || undefined,
    // Collect nothing about people or requests; scrub() removes whatever else could carry it.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    // Traces go through OpenTelemetry (telemetry.ts); Sentry only takes errors.
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    beforeSend: (event, hint) => scrub(event, hint),
  });
  return true;
}
