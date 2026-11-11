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
 * The product events the app tracks (`track("checkin_completed")`, events.ts) ride in the same post:
 * on each side of every flag used that minute, so a gradual release can compare how often people
 * with a feature on do them, and in total, which the BFF logs for the tool's staging check.
 *
 * Only counts leave the browser: flag keys, on or off, how many minutes failed, and how many times
 * each named event happened. No pages, errors or anything about the person.
 */
import type { Hook } from "@openfeature/web-sdk";
import { csrfToken } from "./auth";

const KEY = /^[A-Za-z0-9._-]{1,200}$/;
const MAX_FLAGS = 50;
/** The BFF's limits for one person's minute: at most 20 event names, each counted up to 120. */
export const MAX_EVENTS = 20;
export const MAX_COUNT = 120;
export const EVENT = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

type Side = { requests: number; errors: number; events?: Record<string, number> };
export type CohortPost = {
  flags?: Record<string, { on?: Side; off?: Side }>;
  events?: Record<string, number>;
};

export class FlagCohorts {
  private readonly used = new Map<string, boolean>();
  private failed = false;
  private active = false;
  private readonly happened = new Map<string, number>();

  /** A flag was evaluated: from now on each minute counts for it, on the side it last had. */
  see(key: string, on: boolean): void {
    if (!KEY.test(key) || (!this.used.has(key) && this.used.size >= MAX_FLAGS)) return;
    this.used.set(key, on);
  }

  /** Something failed this minute. */
  fail(): void {
    this.failed = true;
  }

  /** A product event happened this minute (events.ts `track`). */
  record(event: string): void {
    if (!EVENT.test(event) || event.length > 100) return;
    if (!this.happened.has(event) && this.happened.size >= MAX_EVENTS) return;
    this.happened.set(event, Math.min(MAX_COUNT, (this.happened.get(event) ?? 0) + 1));
  }

  /** The person was there this minute (the page was visible). */
  touch(): void {
    this.active = true;
  }

  /** This minute's counts, or null when there's nothing to say; the next minute starts. */
  take(): CohortPost | null {
    const counted = this.active || this.failed;
    const errors = this.failed ? 1 : 0;
    const events = this.happened.size ? Object.fromEntries([...this.happened].sort()) : undefined;
    this.active = false;
    this.failed = false;
    this.happened.clear();
    const post: CohortPost = {};
    if ((counted || events) && this.used.size > 0) {
      const flags: NonNullable<CohortPost["flags"]> = {};
      for (const [key, on] of this.used) {
        flags[key] = { [on ? "on" : "off"]: { requests: 1, errors, ...(events ? { events } : {}) } };
      }
      post.flags = flags;
    }
    if (events) post.events = events;
    return post.flags || post.events ? post : null;
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
