/**
 * Browser tracing with OpenTelemetry.
 *
 * Each call the app makes to its API carries a W3C `traceparent` header, so the request's trace
 * starts in the browser and continues through the service, agents and MCP servers. Spans go to
 * this site's own `/otlp/` path, which nginx forwards to the data plane's OpenTelemetry collector
 * (docker/30-otel.sh); with no collector configured they go nowhere.
 *
 * Spans carry URL paths, methods, status codes and timings; query strings are removed before a span
 * leaves the browser. Keep personal data out of paths (use ids, not names or dates of birth).
 * Uncaught errors are recorded as `browser.error` spans with the error's type only.
 */
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, type SpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { COMPONENT } from "./component";

export interface TelemetryOptions {
  service?: string;
  origin?: string;
  /** Replaces the OTLP exporter (tests pass an in-memory one). */
  processor?: SpanProcessor;
}

export function startTelemetry({
  service = COMPONENT,
  origin = window.location.origin,
  processor,
}: TelemetryOptions = {}): WebTracerProvider {
  const exporter: SpanExporter = new OTLPTraceExporter({ url: `${origin}/otlp/v1/traces` });
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: service }),
    spanProcessors: [processor ?? new BatchSpanProcessor(exporter)],
  });
  provider.register();
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new FetchInstrumentation({
        // Same-origin API calls get traceparent; the exporter's own calls aren't traced.
        ignoreUrls: [/\/otlp\//, /\/ofrep\//],
        propagateTraceHeaderCorsUrls: [],
        // Query strings never reach a trace: they can hold what a person searched for.
        applyCustomAttributesOnSpan: (span) => {
          withoutQueryStrings(span);
        },
      }),
    ],
  });
  window.addEventListener("error", (e) => {
    recordError(e.error);
  });
  window.addEventListener("unhandledrejection", (e) => {
    recordError(e.reason);
  });
  return provider;
}

export function recordError(error: unknown): void {
  const span: Span = trace.getTracer(COMPONENT).startSpan("browser.error");
  // The type only: messages can echo what a person typed.
  span.setAttribute("error.type", error instanceof Error ? error.name : typeof error);
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
}

/** URL attributes the fetch instrumentation sets (older and current semantic conventions). */
const URL_ATTRIBUTES = ["http.url", "url.full"];

/** The URL without its query string and fragment. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}

export function withoutQueryStrings(span: Span): void {
  const attributes = (span as unknown as { attributes?: Record<string, unknown> }).attributes ?? {};
  for (const name of URL_ATTRIBUTES) {
    const value = attributes[name];
    if (typeof value === "string") span.setAttribute(name, stripQuery(value));
  }
}
