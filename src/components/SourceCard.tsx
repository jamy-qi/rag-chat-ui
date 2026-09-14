import { useState } from 'react'
import { toast } from 'sonner'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Check, ChevronRight, Copy, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SCORE_HIGH, SCORE_LOW } from '@/lib/constants'
import type { Source } from '@/types'

function scoreBadgeClass(score: number): string {
  // glow 仅暗色生效（浅色白底上发光效果差），见 index.css
  if (score >= SCORE_HIGH)
    return 'glow-primary-sm border-primary/50 bg-primary/10 text-primary'
  if (score >= SCORE_LOW) return 'border-warning/40 bg-warning/10 text-warning'
  return 'border-border bg-accent text-muted-foreground'
}

export function SourceCard({ source, index }: { source: Source; index: number }) {
  const [copied, setCopied] = useState(false)

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(source.source)
      setCopied(true)
      toast.success('已复制来源路径')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('复制失败，请手动选择文本复制')
    }
  }

  return (
    <Collapsible className="group rounded-lg border border-border bg-card text-xs transition-colors duration-150 data-[state=open]:border-primary/40">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" />
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={source.title}>
          {index + 1}. {source.title}
        </span>
        <span
          className="hidden max-w-40 truncate text-muted-foreground sm:inline"
          title={source.source}
        >
          {source.source}
        </span>
        <span
          title="与问题的向量相似度 0~1，越高越相关"
          className={cn(
            'shrink-0 rounded-full border px-1.5 py-px font-mono text-[11px] tabular-nums',
            scoreBadgeClass(source.score),
          )}
        >
          {source.score.toFixed(2)}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border/70 px-3 py-2">
          <div className="mb-1 flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={source.source}>
              {source.source}
            </p>
            <button
              type="button"
              onClick={() => void handleCopyPath()}
              title="复制来源路径"
              aria-label="复制来源路径"
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </div>
          <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">{source.text}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
