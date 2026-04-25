import fs from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const distDir = path.resolve(__dirname, "../backend/web/dist")

// `emptyOutDir` wipes dist on every build, including the .gitkeep that keeps
// the directory tracked so `go:embed all:dist` still compiles before the
// frontend has ever been built. Re-create it after the bundle is written.
const keepDistGitkeep = (): Plugin => ({
  name: "keep-dist-gitkeep",
  closeBundle() {
    fs.writeFileSync(path.join(distDir, ".gitkeep"), "")
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), keepDistGitkeep()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8317",
    },
  },
  build: {
    outDir: distDir,
    emptyOutDir: true,
  },
})
