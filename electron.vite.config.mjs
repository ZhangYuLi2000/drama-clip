import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// 用 .mjs 而非 .ts：vite 直接 import 加载，不再向工作区根目录写临时打包文件，
// 规避部分终端环境（MSYS 等）下临时文件写入 EPERM 的问题。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: {
          index: resolve('electron/main/index.ts'),
          'replica-worker': resolve('electron/main/replica/worker.ts')
        }
      }
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
        protocol: 'ws'
      },
      watch: {
        ignored: ['**/*.tmpdir/**', '**/*.tmp']
      }
    }
  }
})
