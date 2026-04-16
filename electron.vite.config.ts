import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname), ['LR_', 'LINKINREACHLY_'])
  const define: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    define[`process.env.${key}`] = JSON.stringify(value)
  }
  define['process.env.LINKINREACHLY_API_KEY'] ??= JSON.stringify('')

  return {
  main: {
    define,
    resolve: {
      alias: {
        '@core': resolve(__dirname, 'src/core')
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts')
      },
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@core': resolve(__dirname, 'src/core')
      }
    },
    plugins: [react()]
  }
}
})
