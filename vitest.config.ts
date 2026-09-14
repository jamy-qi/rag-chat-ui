import path from 'path'
import { defineConfig } from 'vitest/config'

// 独立的 vitest 配置，与 vite.config.ts 互不影响（vitest 优先读本文件）。
// 默认 node 环境；需要 localStorage/window 的测试文件用
// `// @vitest-environment jsdom` 注释单独切换。
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx,mjs}'],
  },
})
