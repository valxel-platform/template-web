import { render, screen } from "@testing-library/react";
import { OpenFeature, OpenFeatureProvider, TypedInMemoryProvider } from "@openfeature/react-sdk";
import { flagProvider, startFlags, useFeature } from "./flags";

const KEY = "emr.emr-feat-3.check-in-kiosk";

function CheckIn() {
  return <p>{useFeature(KEY) ? "Kiosk check-in" : "Front desk check-in"}</p>;
}

function flags(on: boolean) {
  return new TypedInMemoryProvider({
    [KEY]: { variants: { on: true, off: false }, defaultVariant: on ? "on" : "off", disabled: false },
  });
}

afterEach(async () => {
  await OpenFeature.clearProviders();
});

test("a feature's new UI shows only when its flag is on", async () => {
  await startFlags(flags(true));
  render(
    <OpenFeatureProvider>
      <CheckIn />
    </OpenFeatureProvider>,
  );
  expect(await screen.findByText("Kiosk check-in")).toBeInTheDocument();
});

test("a flag that is off, or unknown, keeps today's UI", async () => {
  await startFlags(flags(false));
  render(
    <OpenFeatureProvider>
      <CheckIn />
    </OpenFeatureProvider>,
  );
  expect(screen.getByText("Front desk check-in")).toBeInTheDocument();
});

test("flags are read over OFREP from this site's origin, and an unreachable server leaves them off", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      calls.push(input instanceof Request ? `${input.method} ${input.url}` : `GET ${String(input)}`);
      return Promise.reject(new Error("offline"));
    }),
  );
  const provider = flagProvider("https://emr.example.com");
  expect(provider.metadata.name).toMatch(/Remote Evaluation Protocol/);
  await startFlags(provider);
  render(
    <OpenFeatureProvider>
      <CheckIn />
    </OpenFeatureProvider>,
  );
  expect(screen.getByText("Front desk check-in")).toBeInTheDocument();
  expect(calls[0]).toBe("POST https://emr.example.com/ofrep/v1/evaluate/flags");
  vi.unstubAllGlobals();
});
