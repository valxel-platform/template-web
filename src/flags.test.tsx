import { render, screen } from "@testing-library/react";
import { OpenFeature, OpenFeatureProvider, TypedInMemoryProvider } from "@openfeature/react-sdk";
import { browserKey, flagProvider, startFlags, useFeature } from "./flags";

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

test("flags are asked for as this browser, with the same key every time", async () => {
  const saved = new Map<string, string>();
  const store = {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => void saved.set(k, v),
  };
  let n = 0;
  const uuid = () => `browser-${String(++n)}`;
  expect(browserKey(store, uuid)).toBe("browser-1");
  expect(browserKey(store, uuid)).toBe("browser-1");
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(browserKey(blocked, () => "fresh")).toBe("fresh");

  await startFlags(flags(true), "browser-1");
  expect(OpenFeature.getContext().targetingKey).toBe("browser-1");
});
