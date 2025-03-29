import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
// import { webSocketPlugin } from "./server/setup-websockets"; // Keep commented out

// Simplified config - Remix handles env vars differently for client/server
export default defineConfig({
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
    }),
    tsconfigPaths(),
    // webSocketPlugin, // Keep commented out
  ],
});
