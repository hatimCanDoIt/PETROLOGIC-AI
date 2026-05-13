import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api, extractErrorMessage } from '@/api/client'
import LoggedInChrome from '@/components/layout/LoggedInChrome'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import { useAuthStore } from '@/store/authStore'
import type { UserMe } from '@/types'

function statusLabel(raw: string | null | undefined) {
  if (!raw) return 'Not subscribed yet'
  return raw.split('_').join(' ')
}

export default function Billing() {
  const [params, setParams] = useSearchParams()
  const setUser = useAuthStore((s) => s.setUser)

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await api.get<UserMe>('/api/auth/me')
      return data
    },
  })

  useEffect(() => {
    if (!me.data?.email) return
    setUser({ id: me.data.id, email: me.data.email, name: me.data.name })
  }, [me.data, setUser])

  const portal = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ url: string }>('/api/billing/portal')
      return data.url
    },
    onSuccess: (url) => {
      window.location.assign(url)
    },
  })

  const portalErr =
    portal.error != null ? extractErrorMessage(portal.error, 'Portal request failed.') : null

  const checkoutFlag = params.get('checkout')
  useEffect(() => {
    if (checkoutFlag === 'success') {
      void me.refetch()
      const next = new URLSearchParams(params)
      next.delete('checkout')
      next.delete('session_id')
      setParams(next, { replace: true })
    }
  }, [checkoutFlag, me, params, setParams])

  return (
    <LoggedInChrome
      title="Billing & subscription"
      subtitle="Plan snapshot from PETROLOGIC; payment methods & invoices via Stripe Customer Portal when configured."
      topRight={
        <Link
          to="/subscription"
          className="text-xs font-mono uppercase tracking-widest text-accent hover:underline"
        >
          Change plan
        </Link>
      }
    >
      {checkoutFlag === 'success' && (
        <Card className="border-accent/40 bg-accent/5">
          <p className="text-sm text-text">
            Checkout finished — refreshing your profile. Stripe webhooks may take a moment to sync
            plan status.
          </p>
        </Card>
      )}

      {me.isLoading ? (
        <p className="text-text-dim font-mono text-sm">Loading billing profile…</p>
      ) : me.isError ? (
        <p className="text-gas font-mono text-sm">Could not load your account.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Current plan" subtitle="Updated after Stripe subscription events sync.">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-text-dim">
                  Plan
                </dt>
                <dd className="text-text-bright font-medium">
                  {me.data?.billing_plan
                    ? me.data.billing_plan.charAt(0).toUpperCase() + me.data.billing_plan.slice(1)
                    : 'None on file'}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-text-dim">
                  Subscription status
                </dt>
                <dd className="text-text-bright capitalize">
                  {statusLabel(me.data?.billing_status)}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-text-dim">
                  Seats
                </dt>
                <dd className="text-text-dim">
                  Seat quantity lives on the Stripe subscription line item — Customer Portal shows the
                  live count.
                </dd>
              </div>
            </dl>
          </Card>

          <Card
            title="Stripe Customer Portal"
            subtitle="Update payment methods, download invoices, or cancel renewals."
            action={
              <Button
                variant="primary"
                size="sm"
                loading={portal.isPending}
                onClick={() => portal.mutate()}
              >
                Open portal
              </Button>
            }
          >
            <p className="text-sm text-text-dim">
              After your first Checkout, this opens Stripe&apos;s portal. Until then expect a polite
              400 from the API — add keys and subscribe when ready.
            </p>
            {portalErr && (
              <p className="mt-3 text-xs text-gas font-mono" role="alert">
                {portalErr}
              </p>
            )}
          </Card>
        </div>
      )}

      <Card title="Production checklist" className="max-w-3xl">
        <ul className="list-disc list-inside space-y-2 text-xs text-text-dim font-mono leading-relaxed">
          <li>
            Set <code className="text-accent">STRIPE_SECRET_KEY</code>, price IDs, and expose{' '}
            <code className="text-accent">POST /api/billing/webhook</code> in the Stripe dashboard.
          </li>
          <li>Enable Customer Portal branding and return URLs in Stripe.</li>
          <li>Enterprise stays on email — procurement handles contracts offline.</li>
        </ul>
      </Card>
    </LoggedInChrome>
  )
}
