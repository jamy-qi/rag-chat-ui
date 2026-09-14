// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_CHANGED, applyTheme, loadTheme, saveTheme } from './theme'

function stubSystemTheme(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  stubSystemTheme(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadTheme', () => {
  it('无存储时跟随系统暗色偏好', () => {
    stubSystemTheme(true)
    expect(loadTheme()).toBe('dark')
  })

  it('无存储时跟随系统浅色偏好', () => {
    stubSystemTheme(false)
    expect(loadTheme()).toBe('light')
  })

  it('有效存储值优先于系统偏好', () => {
    stubSystemTheme(true)
    localStorage.setItem('rag-qa:theme', 'light')
    expect(loadTheme()).toBe('light')
    stubSystemTheme(false)
    localStorage.setItem('rag-qa:theme', 'dark')
    expect(loadTheme()).toBe('dark')
  })

  it('非法存储值回退到系统偏好', () => {
    stubSystemTheme(true)
    localStorage.setItem('rag-qa:theme', 'neon')
    expect(loadTheme()).toBe('dark')
  })

  it('localStorage 抛错时回退到系统偏好', () => {
    stubSystemTheme(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadTheme()).toBe('dark')
  })
})

describe('applyTheme', () => {
  it('dark：html 加 dark class 且可读回', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(loadTheme()).toBe('dark')
  })

  it('light：html 移除 dark class 且可读回', () => {
    applyTheme('dark')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(loadTheme()).toBe('light')
  })

  it('派发 THEME_CHANGED 事件并携带主题', () => {
    const seen: string[] = []
    window.addEventListener(THEME_CHANGED, (e) => {
      seen.push((e as CustomEvent<string>).detail)
    })
    applyTheme('dark')
    applyTheme('light')
    expect(seen).toEqual(['dark', 'light'])
  })

  it('persist:false（启动路径）只切 class 不写存储', () => {
    applyTheme('dark', { persist: false })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('rag-qa:theme')).toBeNull()
    // 系统偏好不被固化：下次 loadTheme 仍跟随系统
    stubSystemTheme(false)
    expect(loadTheme()).toBe('light')
  })

  it('persist:false 覆盖既有存储时也不改写', () => {
    localStorage.setItem('rag-qa:theme', 'light')
    applyTheme('dark', { persist: false })
    expect(localStorage.getItem('rag-qa:theme')).toBe('light')
  })
})

describe('saveTheme', () => {
  it('localStorage 抛错时不传播异常', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => saveTheme('dark')).not.toThrow()
  })
})
