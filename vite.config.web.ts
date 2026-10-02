import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Configuration de build spécifique pour la version pure web autonome (fichier HTML unique)
export default defineConfig({
  plugins: [
    react(),
    viteSingleFile({
      useRecommendedBuildConfig: true,
      removeViteModuleLoader: true,
    }),
  ],
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    target: "esnext",
    assetsInlineLimit: 100000000, // 100MB pour tout inliner
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
