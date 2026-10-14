import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import {
  Database,
  Cpu,
  Layers,
  WifiOff,
  Sun,
  Moon,
  PanelLeft,
  SlidersHorizontal,
} from 'lucide-react'
import { applyTheme, loadTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { Health, Stats } from '@/types'

interface TopBarProps {
  /** 知识库应用名（meta.appName）；null = meta 未加载，显示骨架 */
  appName: string | null
  stats: Stats | null
  /** /api/health 结果：移动端 <md 时以此渲染健康状态圆点；null = 未拿到 */
  health: Health | null
  statsError: boolean
  k: number
  onKChange: (k: number) => void
  /** 打开移动端导航抽屉（仅 <md 显示的菜单按钮触发） */
  onOpenMobileNav: () => void
}

/** 健康圆点：语义色表达 ready/degraded/unavailable（primary≈绿 / warning≈黄 / destructive≈红） */
const HEALTH_DOT: Record<Health['status'], { dot: string; label: string }> = {
  ready: { dot: 'bg-primary', label: '服务状态：正常' },
  degraded: { dot: 'bg-warning', label: '服务状态：降级' },
  unavailable: { dot: 'bg-destructive', label: '服务状态：不可用' },
}

export function TopBar({ appName, stats, health, statsError, k, onKChange, onOpenMobileNav }: TopBarProps) {
  const [theme, setTheme] = useState<Theme>(() => loadTheme())

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  const healthMeta = health
    ? HEALTH_DOT[health.status]
    : { dot: 'bg-muted-foreground/50', label: '服务状态：未知' }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-sidebar/90 px-3 backdrop-blur md:gap-4 md:px-4">
      {/* 移动端菜单按钮：打开导航抽屉 */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenMobileNav}
        aria-label="打开菜单"
        className="shrink-0 bg-transparent text-muted-foreground hover:text-foreground md:hidden"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      {/* Mineradio 式荧光绿色块 Logo */}
      <div className="flex items-center gap-2.5">
        <div className="glow-primary-sm flex h-7 w-12 items-center justify-center rounded-md bg-primary">
          <span className="text-xs font-extrabold tracking-wider text-primary-foreground">
            RAG
          </span>
        </div>
        {appName === null ? (
          <Skeleton
            className="hidden h-5 w-24 sm:block"
            aria-label="应用名加载中"
          />
        ) : (
          <h1 className="hidden text-base font-bold tracking-tight whitespace-nowrap text-foreground sm:block">
            {appName}
          </h1>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {/* <md：只显示健康状态圆点，完整徽章太占空间 */}
        <span
          className={cn('h-2.5 w-2.5 shrink-0 rounded-full md:hidden', healthMeta.dot)}
          title={healthMeta.label}
          aria-label={healthMeta.label}
        />
        {statsError ? (
          <Badge
            variant="outline"
            className="rounded-full border-red-500/30 bg-red-500/10 text-red-400"
          >
            <WifiOff className="mr-1 h-3 w-3" />
            后端未连接
          </Badge>
        ) : stats ? (
          <div className="hidden items-center gap-2 md:flex">
            <Badge
              variant="outline"
              className="rounded-full border-border bg-transparent whitespace-nowrap text-muted-foreground"
              title="LLM 模型"
            >
              <Cpu className="mr-1 h-3 w-3" />
              {stats.llm_model}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-border bg-transparent whitespace-nowrap text-muted-foreground"
              title="Embedding 模型"
            >
              <Layers className="mr-1 h-3 w-3" />
              {stats.embed_model}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-border bg-transparent whitespace-nowrap text-muted-foreground"
              title="知识库分块数"
            >
              <Database className="mr-1 h-3 w-3" />
              {stats.chunks.toLocaleString()} chunks
            </Badge>
          </div>
        ) : (
          <Skeleton className="hidden h-5 w-24 rounded-full md:block" aria-label="统计信息加载中" />
        )}
      </div>

      {/* Top-K：收进 Popover，顶栏只留触发按钮 */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Top-K 设置"
            className="shrink-0 gap-1.5 bg-transparent text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <Badge
              variant="outline"
              className="rounded-full border-primary/40 bg-primary/[0.08] px-1.5 text-[10px] text-primary"
            >
              {k}
            </Badge>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="mr-label whitespace-nowrap">TOP-K</span>
              <span className="min-w-5 text-center text-sm font-semibold text-primary">{k}</span>
            </div>
            <Slider
              value={[k]}
              min={1}
              max={10}
              step={1}
              onValueChange={(v) => onKChange(v[0])}
              aria-label="Top-K"
            />
            <p className="text-xs text-muted-foreground">影响后续检索条数</p>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        aria-label="切换主题"
        className="shrink-0 bg-transparent text-muted-foreground hover:text-foreground"
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </header>
  )
}
