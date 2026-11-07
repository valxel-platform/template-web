# Web template (React 19, TypeScript, Vite)

The golden path for Vrixel web apps. The Vrixel SDLC creates consumer repos from this template;
you can also use **Use this template** on GitHub.

## What you get

| Area           | Choice                                                                                                                                                                                                                                        | Why                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| App            | React 19, TypeScript (strict), Vite 8                                                                                                                                                                                                         | Current stack; strict types catch errors early                             |
| Quality        | ESLint (type-checked rules), Prettier, `tsc --noEmit`                                                                                                                                                                                         | One style; no unchecked `any`                                              |
| Unit tests     | Vitest, Testing Library, V8 coverage of at least 90% (VX-11)                                                                                                                                                                                  | Tests what people see, not implementation details                          |
| Contract tests | Pact consumer tests write `pacts/*.json` for the API to verify                                                                                                                                                                                | The API can't break this app silently                                      |
| End-to-end     | Playwright against the deployed app (`BASE_URL`); `@smoke` tests run in production                                                                                                                                                            | Real browser, real environment                                             |
| Sign-in        | Through the product's BFF (`template-bff`): `/auth/me`, `/auth/login`, `POST /auth/logout`. No token ever in the browser: the BFF holds them and sends the API the person's token; writes send the `XSRF-TOKEN` cookie back as `X-XSRF-TOKEN` | VX-17: tokens out of reach of scripts; one origin, no CORS                 |
| Serving        | Unprivileged nginx on 8080 with CSP, HSTS and security headers on every page (`security-headers.conf`), `/healthz`, immutable asset caching. Reached only through the BFF (`workload.yaml`: project visibility)                               | Secure defaults; works behind the platform's gateway                       |
| Feature flags  | OpenFeature (React SDK) with the OFREP web provider; nginx forwards `/ofrep/` to the product's Flipt                                                                                                                                          | New UI ships dark; the SDLC tool turns it on at release                    |
| Tracing        | OpenTelemetry in the browser: API calls carry `traceparent`; spans go to `/otlp/`, forwarded by nginx to the collector                                                                                                                        | One trace from the click to the database; uncaught errors recorded by type |
| Errors         | Sentry, through this site's `/sentry/` path, when `SENTRY_DSN` is set; types and stacks only                                                                                                                                                  | Uncaught errors grouped into issues, alerting the SDLC tool                |
| Supply chain   | `npm ci` from the lockfile, actions pinned by SHA, dependency review, Dependabot                                                                                                                                                              | Reproducible and reviewed dependencies                                     |

## Checks and how the pipeline reads them

| Check                                                    | Where                                        | Required  | Read by the Vrixel SDLC as                                 |
| -------------------------------------------------------- | -------------------------------------------- | --------- | ---------------------------------------------------------- |
| `unit`                                                   | `ci.yml` (lint, format, types, tests, build) | yes       | the `unit` suite, counts and coverage from `unit / report` |
| `contract`                                               | `ci.yml`                                     | yes       | the `contract` suite                                       |
| `CodeQL`                                                 | default setup, enabled at provisioning       | yes       | the `sast` suite                                           |
| `dependency-review`, `image`                             | `ci.yml`                                     | no        | dependency diff; Dockerfile builds                         |
| `integration / report`, `e2e / report`, `smoke / report` | `post-deploy.yml`                            | per stage | the stage's suite                                          |

## Develop

```bash
npm ci
npm run dev            # http://localhost:5173, /api proxied to the service on :8080
npm test               # unit tests with coverage
npm run test:contract  # writes pacts/template-web-template-service.json
npm run lint && npm run typecheck && npm run format:check
BASE_URL=https://staging.example.com npm run e2e
```

## Signing in

The app never sees a token. The product's BFF signs people in with the product's Keycloak realm,
keeps their tokens, serves this app and proxies `/api/**` with the person's token, all on one
origin. `src/auth.ts` asks the BFF who is signed in (`/auth/me`), starts sign-in (`/auth/login`) and
signs out (`POST /auth/logout`, then a navigation to end the Keycloak session too). A 401 from the
API means the session ended: the app offers to sign in again. Every write sends the CSRF token the
BFF set (`csrfToken()` as `X-XSRF-TOKEN`).

## Feature flags

The Vrixel SDLC creates a flag for each feature in the product's Flipt when its design is
approved (on in dev and staging, off in production until release). Put the feature's new UI
behind it:

```tsx
import { useFeature } from "./flags";

const kiosk = useFeature("emr.emr-feat-3.check-in-kiosk");
return kiosk ? <KioskCheckIn /> : <FrontDeskCheckIn />;
```

The browser asks this site's `/ofrep/` path; at start, `docker/30-flags.sh` points it at the
product's Flipt:

| Variable            | Example                     |                                               |
| ------------------- | --------------------------- | --------------------------------------------- |
| `FLAGS_URL`         | `http://flipt.emr.svc:8080` | The product's Flipt; unset, every flag is off |
| `FLAGS_ENVIRONMENT` | `production`                | Flipt environment (`x-flipt-environment`)     |
| `FLAGS_NAMESPACE`   | `emr`                       | The product's Flipt namespace                 |

The browser never holds a Flipt token: configure the product's Flipt to allow OFREP without one
(`authentication.exclude.ofrep: true`) and keep it reachable only inside the product's runtime.
In development, run Flipt on `:8081` or leave it off (flags read as off). Tests set flags with
`TypedInMemoryProvider` (see `src/flags.test.tsx`).

**Gradual releases.** The SDLC tool turns a feature on for 5% of users, then 25%, and so on, and
stops if the people who have it fail more than the people who don't. The services count their own
requests. `src/cohorts.ts` counts what only the browser sees, in user-minutes: each minute the page
is in front of the person counts once for every flag the app has read, on the side this browser
got. The minute counts as failed if it had an uncaught error, an unhandled rejection, a reported
error, or an API call that failed (a 5xx or no answer; a 4xx is the person's own mistake). Every
minute the counts go to the BFF (`POST /flag-cohorts`, with the session and CSRF token), which
adds up everyone's and logs them for the tool. Only flag keys, on or off, and counts leave the
browser. Signed-out visitors aren't counted (the BFF refuses their posts).

## Tracing

`src/telemetry.ts` starts OpenTelemetry in the browser. Every `fetch` to the app's API carries a
W3C `traceparent` header, so the trace continues in the service and beyond, and uncaught errors
are recorded as `browser.error` spans with the error's type only. Spans go to this site's
`/otlp/v1/traces`, which `docker/31-otel.sh` forwards to the data plane's collector:

| Variable             | Example                                    |                                  |
| -------------------- | ------------------------------------------ | -------------------------------- |
| `OTEL_COLLECTOR_URL` | `http://otel-collector.observability:4318` | Unset: browser spans are dropped |

URLs end up in traces: keep names, dates of birth and other personal data out of query strings.

## Error reporting

`src/errors.ts` sends uncaught errors and rejections to Sentry, with their stack, so they are
grouped into issues and Sentry's issue alerts reach the SDLC tool as incident signals
(`/api/signals/sentry`). Events go to this site's `/sentry/envelope/`, which `docker/32-sentry.sh`
forwards to the DSN's Sentry project, so the CSP stays `connect-src 'self'`:

| Variable             | Example                                |                               |
| -------------------- | -------------------------------------- | ----------------------------- |
| `SENTRY_DSN`         | `https://<key>@o1.ingest.sentry.io/42` | Unset: error reporting is off |
| `SENTRY_ENVIRONMENT` | `production`                           |                               |
| `SENTRY_RELEASE`     | the image tag                          |                               |

A failed API call carries the trace the API named in its `traceresponse` header: a report about it
is tagged with that `trace_id`, the endpoint and the status, so the SDLC tool joins it to the backend's
errors from the same request (one incident). Server failures the app shows to people (5xx, or no
answer) are reported too, through `reportError`; a 4xx is the person's to fix and isn't.

Each event also carries the feature flags this browser evaluated and their values (Sentry's
OpenFeature integration). An error that happens only with a feature on is plain in the issue,
and its flag is the first suspect.

Only the error's type, its stack frames, page paths and flag values leave the browser: no error messages, query
strings, cookies, headers, user details, form values or console output (`scrub`, with Sentry's own
collection turned off). For products with PHI, use a Sentry plan covered by a BAA, or leave the DSN
unset. Upload source maps from the release pipeline if you want readable stacks.

## After creating a repo from this template

1. Rename the package, the Pact consumer and provider names, and the page title.
2. Keep `connect-src 'self'` in `security-headers.conf`: the API is on the same origin, behind the BFF.
3. Share the pact with the provider (artifact today; a Pact Broker once you run one).
