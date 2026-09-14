// Vitest 全局 setup：jest-dom 匹配器 + jsdom 缺失 API 的兜底 polyfill
import '@testing-library/jest-dom/vitest'

// Radix ScrollArea 等组件依赖 ResizeObserver，jsdom 未实现
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver
}

// 部分组件（如 sonner / 媒体查询类逻辑）依赖 matchMedia，jsdom 未实现
if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia
}
