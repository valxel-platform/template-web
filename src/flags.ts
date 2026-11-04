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
 * to the product's Flipt (docker/30-flags.sh). With no flag server every flag is off.
 */
import { OFREPWebProvider } from "@openfeature/ofrep-web-provider";
import { OpenFeature, useBooleanFlagValue, type Provider } from "@openfeature/react-sdk";

export function flagProvider(origin: string = window.location.origin): Provider {
  return new OFREPWebProvider({ baseUrl: origin, pollInterval: 60_000 });
}

/** Start reading flags. Until the first answer arrives, and if Flipt can't be reached, flags are off. */
export function startFlags(provider: Provider = flagProvider()): Promise<void> {
  return OpenFeature.setProviderAndWait(provider).catch(() => undefined);
}

/** Whether the feature is on for this user. Re-renders when the flag changes. */
export function useFeature(key: string): boolean {
  return useBooleanFlagValue(key, false);
}
