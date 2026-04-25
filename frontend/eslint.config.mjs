import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import js from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tailwindcss from "eslint-plugin-tailwindcss"
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"
import tseslint from "typescript-eslint"

const __dirname = dirname(fileURLToPath(import.meta.url))

const eslintConfig = defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      ...tailwindcss.configs["flat/recommended"],
    ],
    languageOptions: {
      globals: globals.browser,
    },
    settings: {
      tailwindcss: {
        callees: ["cn", "cva"],
        config: resolve(__dirname, "src/index.css"),
      },
    },
    rules: {
      "tailwindcss/no-custom-classname": "off",
      "tailwindcss/classnames-order": "error",
    },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
])

export default eslintConfig
