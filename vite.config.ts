import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Build timestamp for version stamping
  const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
  
  return {
    server: {
      host: "::",
      port: 8080,
    },
    define: {
      __BUILD_TIME__: JSON.stringify(buildTime),
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
