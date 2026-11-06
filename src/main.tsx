import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OpenFeatureProvider } from "@openfeature/react-sdk";
import { App } from "./App";
import { createApiClient } from "./api/client";
import { session, signIn, signOut } from "./auth";
import { startFlags } from "./flags";
import { startTelemetry } from "./telemetry";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

startTelemetry();
void startFlags();
createRoot(root).render(
  <StrictMode>
    <OpenFeatureProvider>
      <App
        api={createApiClient("")}
        auth={{
          session: () => session(),
          signIn: () => {
            signIn();
          },
          signOut: () => signOut(),
        }}
      />
    </OpenFeatureProvider>
  </StrictMode>,
);
