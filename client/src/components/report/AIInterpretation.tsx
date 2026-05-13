import { useState } from 'react'

import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import type { AIInterpretation as AIType } from '@/types'

interface Props {
  ai: AIType | null
  onRetry?: () => void
  retrying?: boolean
}

function ConfidenceBadge({ value }: { value?: string }) {
  if (!value) return null
  const tone =
    value === 'high' ? 'reservoir' : value === 'medium' ? 'warning' : 'gas'
  return <Badge tone={tone}>{value.toUpperCase()} confidence</Badge>
}

function ZoneAccordion({
  z,
  idx,
}: {
  z: NonNullable<AIType['zone_interpretations']>[number]
  idx: number
}) {
  const [open, setOpen] = useState(idx === 0)
  const confTone =
    z.fluid_type_confidence === 'high'
      ? 'reservoir'
      : z.fluid_type_confidence === 'medium'
      ? 'warning'
      : 'gas'
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-deep hover:bg-bg-panel transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-text-dim">
            Zone #{z.zone_index + 1}
          </span>
          <Badge tone={confTone}>{z.fluid_type_confidence}</Badge>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          className="text-text-dim"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 surface-column-muted">
          <p className="text-sm text-text">{z.interpretation}</p>
          {z.producibility_assessment && (
            <p className="text-sm text-text-bright">
              <span className="font-mono text-[10px] uppercase tracking-widest text-text-dim mr-2">
                Producibility:
              </span>
              {z.producibility_assessment}
            </p>
          )}
          {z.concerns?.length > 0 && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-oil mb-1">
                Concerns
              </p>
              <ul className="list-disc list-inside text-sm text-text space-y-0.5">
                {z.concerns.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {z.recommended_actions?.length > 0 && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent mb-1">
                Recommended actions
              </p>
              <ul className="list-disc list-inside text-sm text-text space-y-0.5">
                {z.recommended_actions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AIInterpretation({ ai, onRetry, retrying }: Props) {
  if (!ai) {
    return (
      <div className="panel p-6 text-center text-text-dim">
        <p>No AI interpretation has been generated yet.</p>
        {onRetry && (
          <Button onClick={onRetry} loading={retrying} className="mt-4">
            Generate Interpretation
          </Button>
        )}
      </div>
    )
  }

  if (ai.error) {
    return (
      <div className="panel p-6 space-y-3">
        <Badge tone="warning">AI interpretation unavailable</Badge>
        <p className="text-sm text-text">{ai.reason || ai.error}</p>
        {ai.raw_text && (
          <details className="text-xs text-text-dim font-mono">
            <summary className="cursor-pointer">Raw model output</summary>
            <pre className="whitespace-pre-wrap mt-2">{ai.raw_text}</pre>
          </details>
        )}
        {onRetry && (
          <Button onClick={onRetry} loading={retrying} variant="secondary">
            Retry
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {ai.well_narrative && (
        <div className="panel p-5 border-l-2 border-accent">
          <h4 className="font-display text-xs uppercase tracking-widest text-accent mb-2">
            Well Narrative
          </h4>
          <p className="text-sm text-text leading-relaxed">{ai.well_narrative}</p>
        </div>
      )}

      {ai.reservoir_context && (
        <div className="panel p-5">
          <h4 className="font-display text-xs uppercase tracking-widest text-text-bright mb-2">
            Reservoir Context
          </h4>
          <p className="text-sm text-text leading-relaxed">{ai.reservoir_context}</p>
        </div>
      )}

      {ai.zone_interpretations && ai.zone_interpretations.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-display text-xs uppercase tracking-widest text-text-bright">
            Zone-by-Zone Interpretation
          </h4>
          {ai.zone_interpretations.map((z, i) => (
            <ZoneAccordion key={i} z={z} idx={i} />
          ))}
        </div>
      )}

      {ai.data_quality_flags && ai.data_quality_flags.length > 0 && (
        <div className="panel p-5">
          <h4 className="font-display text-xs uppercase tracking-widest text-text-bright mb-3">
            Data Quality Flags
          </h4>
          <div className="space-y-2">
            {ai.data_quality_flags.map((f, i) => (
              <div
                key={i}
                className="flex items-start gap-3 border-l-2 pl-3 py-1"
                style={{
                  borderColor:
                    f.severity === 'critical' ? '#ff3d5a' : '#f5a623',
                }}
              >
                <Badge tone={f.severity === 'critical' ? 'gas' : 'warning'}>
                  {f.severity}
                </Badge>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-text-dim">
                    {f.curve}
                  </p>
                  <p className="text-sm text-text">{f.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ai.lithology_summary && (
        <div className="panel p-5">
          <h4 className="font-display text-xs uppercase tracking-widest text-text-bright mb-2">
            Lithology Summary
          </h4>
          <p className="text-sm text-text leading-relaxed">{ai.lithology_summary}</p>
        </div>
      )}

      <div className="panel p-5 flex items-start justify-between gap-3">
        <div>
          <h4 className="font-display text-xs uppercase tracking-widest text-text-bright">
            Overall Confidence
          </h4>
          {ai.overall_confidence_reason && (
            <p className="text-sm text-text mt-2">{ai.overall_confidence_reason}</p>
          )}
        </div>
        <ConfidenceBadge value={ai.overall_confidence} />
      </div>

      <div className="rounded-md border-l-2 border-oil bg-oil/5 px-4 py-3 text-xs text-text-dim">
        <strong className="text-oil font-display tracking-wider">DISCLAIMER · </strong>
        {ai.disclaimer ||
          'This AI-generated interpretation requires validation by a licensed petrophysicist before use in any well or business decision.'}
      </div>

      {ai.model && (
        <p className="font-mono text-[10px] text-text-dim text-right">
          {ai.model} · {ai.generated_at ? new Date(ai.generated_at).toLocaleString() : ''}
        </p>
      )}
    </div>
  )
}
