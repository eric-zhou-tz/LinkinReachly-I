import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/a11y/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/main/**/*.ts', 'src/renderer/**/*.{ts,tsx}'],
      exclude: ['src/main/index.ts', 'src/**/types.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 35,
        lines: 40
      }
    }
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  }
})
