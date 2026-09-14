import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 距底小于 threshold 视为「吸附底部」（聊天流式输出时仅吸附才跟随滚动） */
export function shouldPin(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = 80,
): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold
}

/** 用户偏好减弱动态效果：平滑滚动等动画降级为 instant */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}
