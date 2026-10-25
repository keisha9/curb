import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // --host so a phone on the same Wi-Fi can open the trips page from the QR code.
  server: { host: true, port: 5173 },
});
