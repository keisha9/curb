import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves the repo under /<repo>/; set BASE_PATH there (see .github/workflows/pages.yml).
  base: process.env.BASE_PATH ?? "/",
  // --host so a phone on the same Wi-Fi can open the trips page from the QR code.
  server: { host: true, port: 5173 },
});
