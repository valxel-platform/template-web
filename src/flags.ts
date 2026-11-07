/**
 * Feature flags through OpenFeature.
 *
 * The Vrixel SDLC tool gives each feature a flag (a key like `emr.emr-feat-3.check-in-kiosk`) in
 * the product's Flipt when its design is approved: on in dev and staging, off in production until
 * the feature is released. Put the feature's new UI behind it:
 *
 *   const kiosk = useFeature("emr.emr-feat-3.check-in-kiosk");
 *   return kiosk ? <KioskCheckIn /> : <FrontDeskCheckIn />;
 *
 * The browser reads flags over OFREP from this site's own `/ofrep/` path, which nginx forwards
 * to the product's Flipt (docker/30-flags.sh), as this browser (`browserKey`), so gradual releases
 * work. With no flag server every flag is off.
 */
import { OFREPWebProvider } from "@openfeature/ofrep-web-provider";
import { OpenFeature, useBooleanFlagValue, type Provider } from "@openfeature/react-sdk";

export function flagProvider(origin: string = window.location.origin): Provider {
  return new OFREPWebProvider({ baseUrl: origin, pollInterval: 60_000 });
}

const BROWSER_KEY = "vrixel.flags.browser";

type KeyStore = Pick<Storage, "getItem" | "setItem">;

/**
 * A random id for this browser, kept in localStorage. The tool releases features gradually (on for
 * 5% of users, then 25%, ...), and Flipt picks who gets a feature by this id, so each browser keeps
 * the same answer as the share grows. It says nothing about the person and goes only to the flag
 * server. Where storage is blocked, a fresh id is used for this page.
 */
export function browserKey(store?: KeyStore, uuid: () => string = () => crypto.randomUUID()): string {
  let s = store;
  try {
    s = s ?? window.localStorage;
    const have = s.getItem(BROWSER_KEY);
    if (have) return have;
  } catch {
    // storage blocked: make one below
  }
  const made = uuid();
  try {
    s?.setItem(BROWSER_KEY, made);
  } catch {
    // unwritable: this page still gets a consistent answer
  }
  return made;
}

/** Start reading flags as this browser. Until the first answer arrives, and if Flipt can't be reached, flags are off. */
export async function startFlags(
  provider: Provider = flagProvider(),
  key: string = browserKey(),
): Promise<void> {
  try {
    await OpenFeature.setContext({ targetingKey: key });
  } catch {
    // without a key every browser gets the same answer: still correct, just not gradual
  }
  return OpenFeature.setProviderAndWait(provider).catch(() => undefined);
}

/** Whether the feature is on for this user. Re-renders when the flag changes. */
export function useFeature(key: string): boolean {
  return useBooleanFlagValue(key, false);
}
