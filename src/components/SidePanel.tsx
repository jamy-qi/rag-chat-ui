import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Plus,
  MessageSquare,
  GraduationCap,
  FolderOpen,
  Trash2,
  BookMarked,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { relativeTime } from '@/lib/sessions'
import type { Mode, Session, Topic } from '@/types'

export interface SidePanelContentProps {
  mode: Mode
  onModeChange: (mode: Mode) => void
  topics: Topic[]
  selectedTopic: string | null
  onTopicClick: (name: string) => void
  onNewChat: () => void
  sessions: Session[]
  activeSessionId: string | null
  onSelectSession: (s: Session) => void
  onDeleteSession: (id: string) => void
  mistakesCount: number
  onOpenMistakes: () => void
}

const FOCUS_RING = 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/**
 * 侧栏内容（纯展示）：桌面 aside 与移动端 Sheet 抽屉共用同一份。
 * 顺序：模式 Tabs → 新对话 → 错题本 → 历史会话（拿主要滚动空间）→ 主题导航（可折叠）。
 */
export function SidePanelContent({
  mode,
  onModeChange,
  topics,
  selectedTopic,
  onTopicClick,
  onNewChat,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  mistakesCount,
  onOpenMistakes,
}: SidePanelContentProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 p-3">
        <Tabs value={mode} onValueChange={(v) => onModeChange(v as Mode)}>
          <TabsList className="grid h-10 w-full grid-cols-2 rounded-full border border-border bg-accent p-1">
            <TabsTrigger
              value="qa"
              className="rounded-full text-muted-foreground transition-all duration-200 data-[state=active]:bg-primary data-[state=active]:font-semibold data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
            >
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              问答
            </TabsTrigger>
            <TabsTrigger
              value="interview"
              className="rounded-full text-muted-foreground transition-all duration-200 data-[state=active]:bg-primary data-[state=active]:font-semibold data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
            >
              <GraduationCap className="mr-1.5 h-3.5 w-3.5" />
              模拟面试
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* 荧光绿胶囊主按钮 */}
        <Button
          className="glow-primary-sm h-10 w-full rounded-full font-semibold transition-all duration-200 hover:brightness-110"
          onClick={onNewChat}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          新对话
        </Button>

        {/* 错题本入口 */}
        <Button
          variant="outline"
          className="h-10 w-full rounded-full border-border bg-transparent font-semibold text-muted-foreground transition-all duration-200 hover:border-primary/60 hover:text-primary"
          onClick={onOpenMistakes}
        >
          <BookMarked className="mr-1.5 h-4 w-4" />
          错题本
          <Badge
            variant="outline"
            className="ml-auto rounded-full border-primary/40 bg-primary/[0.08] px-1.5 text-[10px] text-primary"
          >
            {mistakesCount}
          </Badge>
        </Button>
      </div>

      {sessions.length > 0 && (
        <>
          <Separator className="bg-border/70" />
          {/* 历史会话：侧栏的主要滚动区域 */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 px-3 pt-3 pb-1.5">
              <p className="mr-label">HISTORY</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                历史对话（{sessions.length}）
              </p>
            </div>
            <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
              <ul className="space-y-0.5">
                {sessions.map((s) => {
                  const active = s.id === activeSessionId
                  return (
                    <li key={s.id}>
                      <div className="group relative">
                        {/* 主区域是真 button：Enter/Space 天然可用，避免嵌套 button */}
                        <button
                          type="button"
                          onClick={() => onSelectSession(s)}
                          className={cn(
                            'w-full cursor-pointer rounded-md border-l-2 border-transparent px-2 py-1.5 text-left transition-colors duration-150 hover:bg-accent',
                            FOCUS_RING,
                            active && 'border-primary bg-primary/[0.08]',
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            {s.mode === 'interview' ? (
                              <GraduationCap
                                className={cn(
                                  'h-3.5 w-3.5 shrink-0 text-muted-foreground',
                                  active && 'text-primary',
                                )}
                              />
                            ) : (
                              <MessageSquare
                                className={cn(
                                  'h-3.5 w-3.5 shrink-0 text-muted-foreground',
                                  active && 'text-primary',
                                )}
                              />
                            )}
                            <span
                              className={cn(
                                // 右侧留出删除按钮的绝对定位空间
                                'min-w-0 flex-1 truncate pr-6 text-sm text-muted-foreground',
                                active && 'text-foreground',
                              )}
                              title={s.title}
                            >
                              {s.title}
                            </span>
                          </div>
                          <p className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
                            {relativeTime(s.updatedAt)}
                          </p>
                        </button>
                        <button
                          type="button"
                          aria-label="删除会话"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteSession(s.id)
                          }}
                          className={cn(
                            'absolute top-1.5 right-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-red-500/10 hover:text-red-400',
                            FOCUS_RING,
                          )}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </ScrollArea>
          </div>
        </>
      )}

      <Separator className="bg-border/70" />

      {/* 主题导航：Collapsible 可折叠，默认展开 */}
      <Collapsible defaultOpen className="flex min-h-0 shrink flex-col">
        <div className="px-3 pt-3 pb-2">
          <CollapsibleTrigger
            className={cn(
              'group/topic flex w-full items-center justify-between rounded-md px-1 py-0.5 text-left hover:bg-accent',
              FOCUS_RING,
            )}
          >
            <span>
              <span className="mr-label block">TOPICS</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                主题导航{topics.length > 0 ? `（${topics.length}）` : ''}
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/topic:-rotate-90" />
          </CollapsibleTrigger>
          <p className="mt-1 px-1 text-[11px] leading-snug text-muted-foreground">
            {mode === 'qa'
              ? '点击主题限定检索范围并自动填入提问，再点一次取消'
              : '点击主题限定出题范围，再点一次取消'}
          </p>
        </div>
        <CollapsibleContent className="min-h-0">
          <ScrollArea className="max-h-72 px-2 pb-3">
            {topics.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                暂无主题（后端未连接或无数据）
              </p>
            ) : (
              <ul className="space-y-0.5">
                {topics.map((t) => {
                  const active = selectedTopic === t.name
                  return (
                    <li key={t.name}>
                      <button
                        type="button"
                        onClick={() => onTopicClick(t.name)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent',
                          FOCUS_RING,
                          active && 'border-primary/50 bg-primary/[0.08] text-primary',
                        )}
                      >
                        <FolderOpen
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 text-muted-foreground',
                            active && 'text-primary',
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate" title={t.name}>
                          {t.name}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'shrink-0 rounded-full border-border px-1.5 text-[10px] text-muted-foreground',
                            active && 'border-primary/50 text-primary',
                          )}
                        >
                          {t.count}
                        </Badge>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/** 桌面侧栏：<md 隐藏（移动端由 Home 的 Sheet 抽屉承载同一份内容） */
export function SidePanel(props: SidePanelContentProps) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <SidePanelContent {...props} />
    </aside>
  )
}
