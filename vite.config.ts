import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, loadEnv } from "vite"; // Import loadEnv
import tsconfigPaths from "vite-tsconfig-paths";
// import { webSocketPlugin } from "./server/setup-websockets"; // Keep commented out for now

export default defineConfig(({ mode }) => {
  // Load .env files based on the mode (development, production)
  // This makes process.env work correctly in Remix server-side code (loaders/actions)
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // Define process.env for server-side code
    define: {
      'process.env': env,
    },
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
  };
});
