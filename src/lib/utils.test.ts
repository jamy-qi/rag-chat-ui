import { describe, expect, it } from 'vitest'
import { cn, shouldPin } from './utils'

describe('cn', () => {
  it('合并多个类名', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })
  it('忽略 falsy 值（条件类名场景）', () => {
    expect(cn('foo', false, undefined, null, 'bar')).toBe('foo bar')
  })
  it('tailwind 冲突类后者覆盖前者（twMerge）', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm text-red-500', 'text-blue-500')).toBe('text-sm text-blue-500')
  })
  it('支持对象语法（clsx）', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })
})

describe('shouldPin', () => {
  it('距底小于阈值（默认 80px）时吸附', () => {
    expect(shouldPin(500, 500, 1000)).toBe(true) // 恰好在底部（距底 0）
    expect(shouldPin(450, 500, 1000)).toBe(true) // 距底 50
    expect(shouldPin(0, 500, 1000)).toBe(false) // 距底 500
  })
  it('距底恰好等于阈值不吸附（严格小于）', () => {
    expect(shouldPin(420, 500, 1000)).toBe(false) // 距底 80
  })
  it('支持自定义阈值', () => {
    expect(shouldPin(0, 100, 190, 100)).toBe(true) // 距底 90 < 100
    expect(shouldPin(0, 100, 200, 100)).toBe(false) // 距底 100
  })
})
