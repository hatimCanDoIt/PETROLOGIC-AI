import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import {
  chatWithAssistant,
  explainWithAssistant,
  type AssistantContext,
} from '@/hooks/useWell'
import type { AssistantReply, ChatMessage, HcZoneOut, ProposedZone } from '@/types'

interface LogAssistantChatProps {
  wellId: string
  context: AssistantContext
  zone?: HcZoneOut | null
  onClose: () => void
  onAddZone?: (proposal: ProposedZone) => void
  addingZone?: boolean
}

function contextTitle(context: AssistantContext, zone?: HcZoneOut | null): string {
  if (context.type === 'zone' && zone) {
    return `${zone.zone_type} zone · ${zone.top_ft.toFixed(0)}–${zone.bot_ft.toFixed(0)} ft`
  }
  if (context.type === 'interval') {
    const { top_ft, bot_ft } = context.interval
    return `Interval · ${Math.min(top_ft, bot_ft).toFixed(0)}–${Math.max(top_ft, bot_ft).toFixed(0)} ft`
  }
  return 'Log assistant'
}

export default function LogAssistantChat({
  wellId,
  context,
  zone,
  onClose,
  onAddZone,
  addingZone,
}: LogAssistantChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposed, setProposed] = useState<ProposedZone | null>(null)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contextKey = context.type === 'zone' ? context.zoneId : `${context.interval.top_ft}-${context.interval.bot_ft}`

  const runExplain = useCallback(async () => {
    setLoading(true)
    setError(null)
    setMessages([])
    setProposed(null)
    try {
      const res: AssistantReply = await explainWithAssistant(wellId, context)
      if (res.error) setError(res.error)
      setMessages([{ role: 'assistant', content: res.reply }])
      if (res.proposed_zone) setProposed(res.proposed_zone)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Explain failed')
    } finally {
      setLoading(false)
    }
  }, [wellId, context])

  useEffect(() => {
    void runExplain()
  }, [runExplain, contextKey])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || sending || loading) return
    setInput('')
    setSending(true)
    setError(null)
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    try {
      const res = await chatWithAssistant(wellId, context, nextMessages)
      if (res.error) setError(res.error)
      setMessages([...nextMessages, { role: 'assistant', content: res.reply }])
      if (res.proposed_zone) setProposed(res.proposed_zone)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-accent/30 bg-bg-deep/95 shadow-lg">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-muted px-3 py-2">
        <div className="min-w-0">
          <p className="font-mono text-[9px] uppercase tracking-widest text-accent">AI assistant</p>
          <p className="truncate font-display text-sm text-text-bright">{contextTitle(context, zone)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-text-dim hover:bg-bg-elevated hover:text-text"
          aria-label="Close assistant"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" style={{ maxHeight: 'min(42vh, 360px)' }}>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-text-dim">
            <Spinner /> Analyzing curves…
          </div>
        )}
        {error && (
          <p className="rounded border border-gas/40 bg-gas/10 px-2 py-1.5 text-xs text-gas">{error}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={clsx(
              'rounded-lg px-3 py-2 text-sm leading-relaxed',
              m.role === 'user'
                ? 'ml-6 bg-accent/15 text-text-bright'
                : 'mr-4 border border-border-muted bg-bg-panel text-text',
            )}
          >
            {m.content}
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-text-dim">
            <Spinner /> Thinking…
          </div>
        )}
      </div>

      {proposed && onAddZone && (
        <div className="shrink-0 border-t border-border-muted bg-bg-panel/80 px-3 py-2.5">
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-dim mb-1.5">
            Suggested pay zone
          </p>
          <p className="text-xs text-text mb-2">{proposed.rationale}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={addingZone}
              onClick={() => onAddZone(proposed)}
            >
              Add as {proposed.zone_type} zone
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setProposed(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-border-muted p-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendMessage()
              }
            }}
            disabled={loading || sending}
            placeholder="Ask about this zone or interval…"
            className="min-w-0 flex-1 rounded border border-border-muted bg-bg px-2.5 py-2 text-sm text-text-bright placeholder:text-text-dim focus:border-accent focus:outline-none"
          />
          <Button size="sm" onClick={() => void sendMessage()} disabled={loading || sending || !input.trim()}>
            Send
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-text-dim leading-snug">
          AI suggestions require validation by a licensed petrophysicist.
        </p>
      </div>
    </div>
  )
}
