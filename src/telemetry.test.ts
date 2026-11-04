import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { recordError, startTelemetry } from "./telemetry";

const spans = new InMemorySpanExporter();
const seen: Headers[] = [];

beforeAll(() => {
  // FetchInstrumentation wraps the fetch present when it starts.
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }),
  );
  startTelemetry({
    service: "emr-web",
    origin: "https://emr.example.com",
    processor: new SimpleSpanProcessor(spans),
  });
});

afterEach(() => {
  spans.reset();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

test("API calls carry a traceparent and are recorded as spans", async () => {
  await fetch(`${window.location.origin}/api/v1/greetings?name=x`);
  expect(seen[0]?.get("traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  await vi.waitFor(
    () => {
      expect(spans.getFinishedSpans().length).toBeGreaterThan(0);
    },
    { timeout: 2000 },
  );
  const [span] = spans.getFinishedSpans();
  expect(span?.resource.attributes["service.name"]).toBe("emr-web");
  expect(span?.attributes["http.request.method"] ?? span?.attributes["http.method"]).toBe("GET");
});

test("errors are recorded by type, without their message", () => {
  recordError(new TypeError("Ada Lovelace was not found"));
  recordError("oops");
  const [a, b] = spans.getFinishedSpans();
  expect(a?.name).toBe("browser.error");
  expect(a?.attributes["error.type"]).toBe("TypeError");
  expect(JSON.stringify(a?.attributes)).not.toContain("Ada");
  expect(b?.attributes["error.type"]).toBe("string");
});

test("uncaught errors are recorded", () => {
  window.dispatchEvent(new ErrorEvent("error", { error: new RangeError("x") }));
  expect(spans.getFinishedSpans().map((s) => s.attributes["error.type"])).toContain("RangeError");
  expect(trace.getTracer("t")).toBeDefined();
});
