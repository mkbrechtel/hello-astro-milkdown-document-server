import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { startHocuspocus } from "./src/server/hocuspocus.js";

function hocuspocusIntegration() {
  return {
    name: "hocuspocus",
    hooks: {
      "astro:server:setup": () => {
        startHocuspocus();
      },
    },
  };
}

export default defineConfig({
  integrations: [react(), hocuspocusIntegration()],
});
