import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// `.mts` on purpose: the project has no "type": "module", so a `.ts` config would be loaded as
// CommonJS and fail on ESM-only imports.
//
// The `@/` alias is declared here rather than via vite-tsconfig-paths. One alias is not worth a
// dependency, and that plugin is ESM-only, which is what broke this config in the first place.
const config = defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})

export default config
