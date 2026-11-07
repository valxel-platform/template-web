/**
 * Users with a feature on against users with it off, while the SDLC tool releases it gradually.
 *
 * The services count their own requests; this counts what only the browser sees. Each minute in
 * which the page is in front of the person (or something failed) counts once for every flag the
 * app has used, on the side this browser got, and as failed when the minute had an uncaught
 * error, an unhandled rejection, a reported error, or an API call that failed (5xx or no answer).
 * Once a minute the counts go to the BFF (`POST /flag-cohorts`, with the CSRF token), which adds
 * them up for everyone and logs them for the tool. A person who isn't signed in isn't counted: the
 * BFF refuses the post.
 *
 * Only counts leave the browser: flag keys, on or off, and how many minutes failed. No pages,
 * errors or anything about the person.
 */
import type { Hook } from "@openfeature/web-sdk";
import { csrfToken } from "./auth";

const KEY = /^[A-Za-z0-9._-]{1,200}$/;
const MAX_FLAGS = 50;

type Side = { requests: number; errors: number };
export type CohortPost = { flags: Record<string, { on?: Side; off?: Side }> };

export class FlagCohorts {
  private readonly used = new Map<string, boolean>();
  private failed = false;
  private active = false;

  /** A flag was evaluated: from now on each minute counts for it, on the side it last had. */
  see(key: string, on: boolean): void {
    if (!KEY.test(key) || (!this.used.has(key) && this.used.size >= MAX_FLAGS)) return;
    this.used.set(key, on);
  }

  /** Something failed this minute. */
  fail(): void {
    this.failed = true;
  }

  /** The person was there this minute (the page was visible). */
  touch(): void {
    this.active = true;
  }

  /** This minute's counts, or null when there's nothing to say; the next minute starts. */
  take(): CohortPost | null {
    const counted = this.active || this.failed;
    const errors = this.failed ? 1 : 0;
    this.active = false;
    this.failed = false;
    if (!counted || this.used.size === 0) return null;
    const flags: CohortPost["flags"] = {};
    for (const [key, on] of this.used) {
      flags[key] = { [on ? "on" : "off"]: { requests: 1, errors } };
    }
    return { flags };
  }
}

export const cohorts = new FlagCohorts();

/** An OpenFeature hook: every boolean flag the app evaluates is counted. */
export function cohortHook(counter: FlagCohorts = cohorts): Hook {
  return {
    after(_ctx, details) {
      if (typeof details.value === "boolean") counter.see(details.flagKey, details.value);
    },
  };
}

/** Whether an API answer counts as a failure for the person: the server failed. */
export function failedResponse(status: number): boolean {
  return status >= 500;
}

export interface CohortOptions {
  counter?: FlagCohorts;
  fetchImpl?: typeof fetch;
  every?: number;
  target?: Pick<Window, "addEventListener"> & { document: Pick<Document, "visibilityState"> };
}

/** Counts failures and visible minutes, and posts each minute's counts. Returns a stop function. */
export function startCohorts({
  counter = cohorts,
  fetchImpl = fetch,
  every = 60_000,
  target = window,
}: CohortOptions = {}): () => void {
  const fail = () => {
    counter.fail();
  };
  target.addEventListener("error", fail);
  target.addEventListener("unhandledrejection", fail);
  const tick = () => {
    if (target.document.visibilityState === "visible") counter.touch();
    const body = counter.take();
    if (!body) return;
    fetchImpl("/flag-cohorts", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrfToken() },
      body: JSON.stringify(body),
    }).catch(() => undefined); // a lost minute is fine
  };
  const timer = setInterval(tick, every);
  return () => {
    clearInterval(timer);
  };
}
