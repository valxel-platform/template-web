# Web template (React 19, TypeScript, Vite)

The golden path for Vrixel web apps. The Vrixel SDLC creates consumer repos from this template;
you can also use **Use this template** on GitHub.

## What you get

| Area           | Choice                                                                                        | Why                                                  |
| -------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| App            | React 19, TypeScript (strict), Vite 8                                                         | Current stack; strict types catch errors early       |
| Quality        | ESLint (type-checked rules), Prettier, `tsc --noEmit`                                         | One style; no unchecked `any`                        |
| Unit tests     | Vitest, Testing Library, V8 coverage of at least 70%                                          | Tests what people see, not implementation details    |
| Contract tests | Pact consumer tests write `pacts/*.json` for the API to verify                                | The API can't break this app silently                |
| End-to-end     | Playwright against the deployed app (`BASE_URL`); `@smoke` tests run in production            | Real browser, real environment                       |
| Serving        | Unprivileged nginx on 8080 with CSP and security headers, `/healthz`, immutable asset caching | Secure defaults; works behind the platform's gateway |
| Supply chain   | `npm ci` from the lockfile, actions pinned by SHA, dependency review, Dependabot              | Reproducible and reviewed dependencies               |

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

## After creating a repo from this template

1. Rename the package, the Pact consumer and provider names, and the page title.
2. Tighten `connect-src` in `nginx.conf` to the product's API origin.
3. Share the pact with the provider (artifact today; a Pact Broker once you run one).
