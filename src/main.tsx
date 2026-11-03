import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OpenFeatureProvider } from "@openfeature/react-sdk";
import { App } from "./App";
import { createApiClient } from "./api/client";
import { startFlags } from "./flags";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

void startFlags();
createRoot(root).render(
  <StrictMode>
    <OpenFeatureProvider>
      <App api={createApiClient("")} />
    </OpenFeatureProvider>
  </StrictMode>,
);
