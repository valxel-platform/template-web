import type { ErrorEvent } from "@sentry/react";
import * as Sentry from "@sentry/react";
import { ApiError } from "./api/client";
import { reportError, scrub, startErrors } from "./errors";

vi.mock("@sentry/react", () => ({ init: vi.fn(), captureException: vi.fn() }));

const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.mocked(Sentry.init).mockClear();
});

test("error reporting stays off without a DSN", async () => {
  expect(await startErrors(json({ dsn: "" }))).toBe(false);
  expect(await startErrors(json({}, 404))).toBe(false);
  expect(await startErrors(() => Promise.reject(new Error("offline")))).toBe(false);
  expect(Sentry.init).not.toHaveBeenCalled();
});

test("with a DSN, errors go through this site's tunnel and nothing personal is sent", async () => {
  expect(
    await startErrors(json({ dsn: "https://k@o1.ingest.sentry.io/42", environment: "production" })),
  ).toBe(true);
  const opts = vi.mocked(Sentry.init).mock.calls[0]?.[0];
  expect(opts).toMatchObject({
    tunnel: "/sentry/envelope/",
    environment: "production",
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
  expect(opts?.beforeSend).toBeTypeOf("function");
});

test("an event keeps the error's type and stack, and loses messages, queries and people", () => {
  const event = {
    type: undefined,
    message: "Saved Jane Doe",
    user: { email: "jane@example.com", ip_address: "1.2.3.4" },
    extra: { form: { name: "Jane" } },
    request: {
      url: "https://app.example.com/patients?name=Jane",
      cookies: { s: "x" },
      headers: { Authorization: "t" },
    },
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read 'Jane' of undefined",
          stacktrace: {
            frames: [
              {
                function: "save",
                lineno: 3,
                abs_path: "https://app.example.com/assets/a.js?v=1",
                vars: { name: "Jane" },
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: "console", message: "Jane", timestamp: 1 },
      { category: "ui.input", message: "input[name=name]", timestamp: 2 },
      {
        category: "fetch",
        type: "http",
        timestamp: 3,
        data: { url: "/api/patients?q=Jane", status_code: 500, method: "GET", body: "x" },
      },
    ],
  } as unknown as ErrorEvent;
  const out = scrub(event);
  expect(out.exception?.values?.[0]).toMatchObject({ type: "TypeError", value: undefined });
  expect(out.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
    function: "save",
    lineno: 3,
    abs_path: "https://app.example.com/assets/a.js",
  });
  expect(out.message).toBeUndefined();
  expect(out.user).toBeUndefined();
  expect(out.extra).toBeUndefined();
  expect(out.request).toEqual({ url: "https://app.example.com/patients" });
  expect(out.breadcrumbs).toEqual([
    {
      category: "fetch",
      type: "http",
      timestamp: 3,
      level: undefined,
      data: { url: `${window.location.origin}/api/patients`, status_code: 500, method: "GET" },
    },
  ]);
  expect(JSON.stringify(out)).not.toContain("Jane");
});

test("beforeSend scrubs, and bare events and odd URLs pass through", async () => {
  await startErrors(json({ dsn: "https://k@o1.ingest.sentry.io/42", release: "web@1.2.3" }));
  const opts = vi.mocked(Sentry.init).mock.calls[0]?.[0];
  expect(opts?.release).toBe("web@1.2.3");
  const sent = (opts?.beforeSend as (e: ErrorEvent) => ErrorEvent)({
    type: undefined,
    message: "x",
    request: { url: "http://[bad" },
  });
  expect(sent).toEqual({
    type: undefined,
    request: { url: undefined },
    breadcrumbs: [],
    logentry: undefined,
  });
  expect(scrub({ type: undefined, exception: { values: [{ type: "E" }] } }).exception).toEqual({
    values: [{ type: "E", value: undefined }],
  });
});

test("a failed API call's report carries the backend's trace, endpoint and status", () => {
  const trace = "4bf92f3577b34da6a3ce929d0e0e4736";
  const err = new ApiError(503, "unavailable", "GET /api/v1/greetings", trace);
  const out = scrub({ type: undefined, tags: { a: "b" } }, { originalException: err });
  expect(out.tags).toEqual({ a: "b", trace_id: trace, endpoint: "GET /api/v1/greetings", status: "503" });
  const bare = scrub({ type: undefined }, { originalException: new ApiError(500, "x") });
  expect(bare.tags).toEqual({ status: "500" });
  reportError(err);
  expect(Sentry.captureException).toHaveBeenCalledWith(err);
});
