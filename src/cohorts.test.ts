import { OpenFeature, TypedInMemoryProvider } from "@openfeature/web-sdk";
import { FlagCohorts, cohortHook, failedResponse, startCohorts } from "./cohorts";

const KEY = "emr.emr-feat-3.check-in-kiosk";

afterEach(async () => {
  await OpenFeature.clearProviders();
  OpenFeature.clearHooks();
  vi.useRealTimers();
});

test("each minute counts once for every flag in use, on the side this browser got", () => {
  const c = new FlagCohorts();
  c.touch();
  expect(c.take()).toBeNull(); // no flag used yet
  c.see(KEY, true);
  c.see(KEY, true);
  c.see("other.flag", false);
  c.see("not a key!", true);
  expect(c.take()).toBeNull(); // nobody was there this minute
  c.touch();
  expect(c.take()).toEqual({
    flags: { [KEY]: { on: { requests: 1, errors: 0 } }, "other.flag": { off: { requests: 1, errors: 0 } } },
  });
  c.fail();
  c.see(KEY, false); // the share changed: the latest answer counts
  expect(c.take()).toEqual({
    flags: { [KEY]: { off: { requests: 1, errors: 1 } }, "other.flag": { off: { requests: 1, errors: 1 } } },
  });
  expect(c.take()).toBeNull();
});

test("no more flags than the BFF accepts", () => {
  const c = new FlagCohorts();
  for (let i = 0; i < 60; i++) c.see(`f${String(i)}`, true);
  c.see("f1", false); // known flags still update
  c.touch();
  const flags = c.take()?.flags ?? {};
  expect(Object.keys(flags)).toHaveLength(50);
  expect(flags.f1).toEqual({ off: { requests: 1, errors: 0 } });
});

test("the hook counts every boolean flag the app reads", async () => {
  const c = new FlagCohorts();
  OpenFeature.addHooks(cohortHook(c));
  await OpenFeature.setProviderAndWait(
    new TypedInMemoryProvider({
      [KEY]: { variants: { on: true, off: false }, defaultVariant: "on", disabled: false },
      colour: { variants: { a: "blue" }, defaultVariant: "a", disabled: false },
    }),
  );
  const client = OpenFeature.getClient();
  expect(client.getBooleanValue(KEY, false)).toBe(true);
  expect(client.getStringValue("colour", "red")).toBe("blue");
  c.touch();
  expect(c.take()).toEqual({ flags: { [KEY]: { on: { requests: 1, errors: 0 } } } });
});

test("server failures and no answer count, a 4xx doesn't", () => {
  expect(failedResponse(500)).toBe(true);
  expect(failedResponse(503)).toBe(true);
  expect(failedResponse(404)).toBe(false);
  expect(failedResponse(200)).toBe(false);
});

test("each minute's counts go to the BFF with the CSRF token; errors on the page count", async () => {
  vi.useFakeTimers();
  document.cookie = "XSRF-TOKEN=t1";
  const c = new FlagCohorts();
  const listeners: Record<string, () => void> = {};
  const target = {
    addEventListener: (type: string, fn: () => void) => {
      listeners[type] = fn;
    },
    document: { visibilityState: "visible" as DocumentVisibilityState },
  };
  const posts: RequestInit[] = [];
  const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    posts.push(init ?? {});
    return Promise.reject(new Error("offline"));
  });
  const stop = startCohorts({ counter: c, fetchImpl, every: 60_000, target: target as never });
  vi.advanceTimersByTime(60_000);
  expect(fetchImpl).not.toHaveBeenCalled(); // no flag used yet
  c.see(KEY, true);
  listeners.error?.();
  vi.advanceTimersByTime(60_000);
  expect(fetchImpl).toHaveBeenCalledWith("/flag-cohorts", expect.objectContaining({ method: "POST" }));
  expect(posts[0]?.headers).toMatchObject({ "X-XSRF-TOKEN": "t1" });
  expect(JSON.parse(posts[0]?.body as string)).toEqual({
    flags: { [KEY]: { on: { requests: 1, errors: 1 } } },
  });
  target.document.visibilityState = "hidden";
  vi.advanceTimersByTime(60_000);
  expect(fetchImpl).toHaveBeenCalledTimes(1); // nobody looking, nothing failed: not a minute of use
  listeners.unhandledrejection?.();
  vi.advanceTimersByTime(60_000);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  stop();
  await Promise.resolve();
});
