import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  BookMarked,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Repeat,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  filterMistakes,
  markReview,
  mistakeTopics,
  removeMistake,
  sortMistakes,
} from '@/lib/mistakes'
import type { MistakeSortBy } from '@/lib/mistakes'
import { relativeTime } from '@/lib/sessions'
import type { Mistake } from '@/types'

interface MistakesPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mistakes: Mistake[]
  /** 「再考我一次」：新建 interview 会话并以该题开考 */
  onRetry: (mistake: Mistake) => void
}

/** 主题筛选的 UI 取值：'all' = 全部；'none' = 综合（无主题）；其余为主题名 */
type TopicFilterValue = 'all' | 'none' | string

function toFilterTopic(v: TopicFilterValue): string | null | undefined {
  if (v === 'all') return undefined
  if (v === 'none') return null
  return v
}

function MistakeItem({
  mistake,
  onRetry,
}: {
  mistake: Mistake
  onRetry: (mistake: Mistake) => void
}) {
  const [showAnswer, setShowAnswer] = useState(false)

  return (
    <li className="rounded-lg border border-border bg-secondary text-sm transition-colors duration-150 hover:border-primary/30">
      <div className="px-3 py-2.5">
        <p className="leading-relaxed whitespace-pre-wrap text-foreground">{mistake.question}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className="rounded-full border-primary/40 bg-primary/[0.08] px-1.5 text-[10px] text-primary"
          >
            {mistake.topic ?? '综合'}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            记录于 {relativeTime(mistake.createdAt)}
          </span>
          <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
            <Repeat className="h-3 w-3" />
            复习 {mistake.reviewCount} 次
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAnswer((v) => !v)}
            className="flex items-center gap-1 rounded-full border border-border bg-transparent px-3 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:border-primary/60 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {showAnswer ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showAnswer ? '收起答案' : '显示答案'}
            <ChevronRight
              className={cn(
                'h-3 w-3 transition-transform duration-200',
                showAnswer && 'rotate-90',
              )}
            />
          </button>
          <button
            type="button"
            onClick={() => {
              const { ok } = removeMistake(mistake.id)
              if (!ok) {
                toast.error('删除失败：浏览器存储不可用')
                return
              }
              toast.success('已掌握，移出错题本')
            }}
            className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/[0.08] px-3 py-1 text-xs text-primary transition-colors duration-150 hover:bg-primary/[0.16] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <CheckCircle2 className="h-3 w-3" />
            已掌握
          </button>
          <button
            type="button"
            onClick={() => {
              const { ok } = markReview(mistake.id)
              if (!ok) {
                toast.error('保存失败：浏览器存储不可用')
                return
              }
              toast('已标记「还不熟」，复习次数 +1')
            }}
            className="flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs text-warning transition-colors duration-150 hover:bg-warning/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Repeat className="h-3 w-3" />
            还不熟
          </button>
          <button
            type="button"
            onClick={() => onRetry(mistake)}
            className="flex items-center gap-1 rounded-full border border-border bg-transparent px-3 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:border-primary/60 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <RotateCcw className="h-3 w-3" />
            再考我一次
          </button>
        </div>
      </div>

      {showAnswer && (
        <div className="border-t border-border/70 px-3 py-2.5">
          {mistake.answer ? (
            <div className="markdown-body text-xs">
              <ReactMarkdown>{mistake.answer}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">（未记录答案）</p>
          )}
        </div>
      )}
    </li>
  )
}

export function MistakesPanel({ open, onOpenChange, mistakes, onRetry }: MistakesPanelProps) {
  const [topicFilter, setTopicFilter] = useState<TopicFilterValue>('all')
  const [sortBy, setSortBy] = useState<MistakeSortBy>('recent')

  const topics = useMemo(() => mistakeTopics(mistakes), [mistakes])
  const visible = useMemo(
    () => sortMistakes(filterMistakes(mistakes, toFilterTopic(topicFilter)), sortBy),
    [mistakes, topicFilter, sortBy],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col border-l border-border bg-card sm:max-w-md"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle className="flex items-center gap-2 text-foreground">
            <BookMarked className="h-4 w-4 text-primary" />
            错题本
            <Badge
              variant="outline"
              className="rounded-full border-primary/40 bg-primary/[0.08] px-1.5 text-[10px] text-primary"
            >
              {mistakes.length}
            </Badge>
          </SheetTitle>
          <SheetDescription className="text-muted-foreground">
            面试中答错或收藏的题目。「已掌握」移出错题本，「还不熟」计入复习次数。
          </SheetDescription>
        </SheetHeader>

        {mistakes.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-1">
            {/* 主题筛选：全部 + 错题里实际出现过的主题 */}
            <select
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
              aria-label="按主题筛选"
              className="rounded-full border border-border bg-transparent px-3 py-1 text-xs text-muted-foreground transition-colors duration-150 outline-none hover:border-primary/60 focus:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring [&>option]:bg-popover"
            >
              <option value="all">全部主题</option>
              {topics.map((t) => (
                <option key={t ?? 'none'} value={t ?? 'none'}>
                  {t ?? '综合'}
                </option>
              ))}
            </select>
            {/* 排序切换 */}
            <div className="flex items-center gap-1">
              {(
                [
                  ['recent', '最近记录'],
                  ['reviewCount', '复习多优先'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSortBy(value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    sortBy === value
                      ? 'border-primary/60 bg-primary/[0.08] text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <Separator className="shrink-0 bg-border/70" />
        <ScrollArea className="min-h-0 flex-1">
          {mistakes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 pt-16 text-center">
              <BookMarked className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">错题本还是空的</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                模拟面试中答错或表示不会的题会自动收录到这里；也可以点击回答下方的「加入错题本」手动收藏。
              </p>
            </div>
          ) : visible.length === 0 ? (
            <p className="px-6 pt-16 text-center text-sm text-muted-foreground">
              该主题下暂无错题
            </p>
          ) : (
            <ul className="space-y-2.5 p-4">
              {visible.map((m) => (
                <MistakeItem key={m.id} mistake={m} onRetry={onRetry} />
              ))}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
