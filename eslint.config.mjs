import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Sync-setState-in-effect je legitímny vzor na 7 existujúcich miestach
      // (reset stavu pri zmene propu, fetch-on-mount) — nechávame ako warning,
      // nové výskyty rieš radšej cez key/derived state (react.dev/learn/you-might-not-need-an-effect).
      "react-hooks/set-state-in-effect": "warn",
      // Podčiarknikový prefix = zámerne nepoužité (napr. fázované API).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
