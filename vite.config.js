import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web", base: "/merchant/", plugins: [react()],
  build: { outDir: "../public/merchant", emptyOutDir: true },
});
