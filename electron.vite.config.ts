import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve('electron/main/index.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve('electron/preload/index.ts') }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      strictPort: false,
      hmr: {
        protocol: 'ws',
        host: '127.0.0.1'
      },
      watch: {
        ignored: ['**/*.tmpdir/**', '**/*.tmp']
      }
    }
  }
})