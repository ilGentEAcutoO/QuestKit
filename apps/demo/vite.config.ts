import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config — emits to ./dist for the Worker's `[assets]` binding.
 *
 * Plugin order matters: tailwindcss before react ensures CSS imports are
 * processed before React's HMR boundary instruments them.
 */
export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
