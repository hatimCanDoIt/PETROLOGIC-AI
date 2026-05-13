import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, extractErrorMessage } from '@/api/client'
import LoggedInChrome from '@/components/layout/LoggedInChrome'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import {
  FALLBACK_PLANS,
  useBillingPlans,
  useStripeReady,
  type PlanCatalogEntry,
} from '@/hooks/useBillingCatalog'

type Interval = 'monthly' | 'yearly'

function IntervalToggle({
  value,
  onChange,
}: {
  value: Interval
  onChange: (v: Interval) => void
}) {
  const opt = (v: Interval, label: string) => {
    const active = value === v
    return (
      <button
        type="button"
        onClick={() => onChange(v)}
        className={
          active
            ? 'flex-1 rounded-md border border-accent bg-accent/10 px-3 py-2 text-xs font-mono uppercase tracking-widest text-accent'
            : 'flex-1 rounded-md border border-border px-3 py-2 text-xs font-mono uppercase tracking-widest text-text-dim hover:border-border-light hover:bg-bg-deep'
        }
      >
        {label}
      </button>
    )
  }
  return (
    <div className="flex max-w-md gap-2 rounded-lg border border-border p-1 bg-bg-deep">
      {opt('monthly', 'Monthly')}
      {opt('yearly', 'Yearly (save 20%)')}
    </div>
  )
}

function formatPlanPrice(plan: PlanCatalogEntry, interval: Interval): string {
  if (plan.code === 'solo') {
    if (interval === 'monthly' && plan.monthly) return plan.monthly.amount_note
    if (interval === 'yearly' && plan.yearly) return plan.yearly.amount_note
    return plan.monthly?.amount_note ?? plan.yearly?.amount_note ?? ''
  }
  if (plan.code === 'team') {
    if (interval === 'monthly' && plan.seat_pricing_monthly_note)
      return plan.seat_pricing_monthly_note
    if (interval === 'yearly' && plan.seat_pricing_yearly_note)
      return plan.seat_pricing_yearly_note
    return plan.seat_pricing_monthly_note ?? plan.seat_pricing_yearly_note ?? ''
  }
  return ''
}

export default function Subscription() {
  const [interval, setInterval] = useState<Interval>('monthly')
  const [teamSeats, setTeamSeats] = useState(3)
  const [billingError, setBillingError] = useState<string | null>(null)
  const plansQuery = useBillingPlans()
  const stripeReady = useStripeReady()

  const plans = useMemo(
    () => plansQuery.data?.plans ?? FALLBACK_PLANS,
    [plansQuery.data?.plans],
  )

  const checkout = useMutation({
    mutationFn: async (payload: {
      plan_code: 'solo' | 'team'
      billing_interval: Interval
      seat_count?: number
    }) => {
      const { data } = await api.post<{ url: string }>(
        '/api/billing/checkout',
        payload,
      )
      return data.url
    },
    onSuccess: (url) => {
      window.location.assign(url)
    },
    onError: (err) => {
      setBillingError(extractErrorMessage(err, 'Could not start checkout.'))
    },
  })

  const stripeOk = stripeReady.data === true
  const showStripeSetupNote =
    stripeReady.isError || (stripeReady.isSuccess && !stripeReady.data)

  return (
    <LoggedInChrome
      title="Choose a workspace plan"
      subtitle="Solo & Team checkout via Stripe when keys and price IDs are configured — safe to browse before then."
    >
      {plansQuery.isError && (
        <Card className="border-border bg-bg-deep">
          <p className="text-sm text-text-dim font-mono">
            Plan catalog couldn&apos;t load from the server — showing baked-in copy instead. Billing
            still works once you add Stripe settings.
          </p>
        </Card>
      )}

      {showStripeSetupNote && (
        <Card className="border-border bg-bg-deep">
          <p className="text-sm text-text">
            {!stripeReady.isError && (
              <>
                Checkout is waiting on <strong>Stripe secrets and price IDs</strong> in the server{' '}
                <code className="text-accent">.env</code>. Buttons stay inactive so nothing breaks
                while you iterate.
              </>
            )}
            {stripeReady.isError && (
              <>
                Couldn&apos;t verify Stripe configuration (API unreachable). Checkout stays disabled;
                retry after your backend is running.
              </>
            )}
          </p>
        </Card>
      )}

      {billingError && (
        <p className="text-sm text-gas font-mono" role="alert">
          {billingError}
        </p>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <IntervalToggle value={interval} onChange={setInterval} />
        <p className="text-xs text-text-dim font-mono max-w-xl">
          Solo includes a{' '}
          <span className="text-accent">seven-day trial</span> — the trial applies to the Solo plan
          only. Team subscriptions follow the Stripe schedule confirmed at Checkout.
        </p>
      </div>

      {plansQuery.isLoading && !plansQuery.data ? (
        <p className="text-text-dim font-mono text-sm">Loading plans…</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((plan) => {
            const priceLine = formatPlanPrice(plan, interval)
            const isEnterprise = plan.cta_kind === 'contact_sales'
            const isTeam = plan.code === 'team'
            const salesMail = plan.contact_email || 'sales@example.com'

            const cta = (() => {
              if (isEnterprise) {
                return (
                  <a
                    href={`mailto:${salesMail}?subject=PETROLOGIC%20Enterprise`}
                    className="block w-full"
                  >
                    <Button variant="secondary" size="lg" className="w-full">
                      Contact sales
                    </Button>
                  </a>
                )
              }
              if (isTeam) {
                return (
                  <div className="space-y-3">
                    <label className="block text-xs font-mono uppercase tracking-widest text-text-dim">
                      Seats (3–10)
                      <input
                        type="number"
                        min={3}
                        max={10}
                        value={teamSeats}
                        onChange={(e) => setTeamSeats(Number(e.target.value))}
                        className="mt-1 w-full rounded-md border border-border bg-bg-panel px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </label>
                    <Button
                      variant="primary"
                      size="lg"
                      className="w-full"
                      loading={checkout.isPending}
                      disabled={!stripeOk || teamSeats < 3 || teamSeats > 10}
                      onClick={() => {
                        setBillingError(null)
                        checkout.mutate({
                          plan_code: 'team',
                          billing_interval: interval,
                          seat_count: teamSeats,
                        })
                      }}
                    >
                      Start team checkout
                    </Button>
                  </div>
                )
              }
              return (
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  loading={checkout.isPending}
                  disabled={!stripeOk}
                  onClick={() => {
                    setBillingError(null)
                    checkout.mutate({ plan_code: 'solo', billing_interval: interval })
                  }}
                >
                  Start Solo trial / subscribe
                </Button>
              )
            })()

            return (
              <Card
                key={plan.code}
                glow={plan.code === 'team'}
                title={plan.title}
                subtitle={plan.blurb}
                className="flex flex-col h-full"
              >
                <div className="flex-1 space-y-3">
                  {priceLine && (
                    <p className="font-display text-2xl text-accent leading-tight">{priceLine}</p>
                  )}
                  {plan.code === 'solo' && typeof plan.trial_days === 'number' && (
                    <p className="text-xs font-mono text-text-dim">
                      {plan.trial_days}-day complimentary access before Stripe captures the Solo
                      subscription.
                    </p>
                  )}
                  <ul className="space-y-2 text-sm text-text-dim list-disc list-inside">
                    {plan.highlights.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </div>
                <div className="mt-6 pt-4 border-t border-border">{cta}</div>
              </Card>
            )
          })}
        </div>
      )}

      <Card className="max-w-2xl">
        <p className="text-xs text-text-dim font-mono leading-relaxed">
          After subscribing, manage cards and invoices from the{' '}
          <Link to="/billing" className="text-accent hover:underline">
            Billing
          </Link>{' '}
          page (Stripe Customer Portal).
        </p>
      </Card>
    </LoggedInChrome>
  )
}
