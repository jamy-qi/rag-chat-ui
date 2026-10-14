// 主题管理：localStorage 持久化 + 系统偏好回退 + html.dark class 切换
export type Theme = 'light' | 'dark'
// 主题全局共享，不随 kbId 隔离
const THEME_KEY = 'rag-chat-ui:theme'
export const THEME_CHANGED = 'rag-chat-ui:theme-changed'

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme, opts?: { persist?: boolean }): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  // 启动路径（persist:false）只切 class 不写存储，保留未来跟随系统偏好的能力
  if (opts?.persist !== false) saveTheme(theme)
  window.dispatchEvent(new CustomEvent(THEME_CHANGED, { detail: theme }))
}

export function saveTheme(theme: Theme): void {
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
}
