import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  base: process.env.VITE_STATIC === "1" ? "./" : "/",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:3000", "/media": "http://localhost:3000" } },
});
