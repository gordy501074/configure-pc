import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initAnalytics } from "./lib/analytics/track";
import { setupAutoIntegration, instrumentFetch } from "./lib/analytics/auto";

// Boot telemetry before the app renders so early nav/errors are captured.
initAnalytics();
setupAutoIntegration();
// Instrument the global fetch so every API call is measured (bodies excluded).
window.fetch = instrumentFetch(window.fetch.bind(window));

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);