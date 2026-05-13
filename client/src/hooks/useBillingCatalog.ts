import { useQuery } from '@tanstack/react-query'

import { api } from '@/api/client'

export interface PlanPriceLine {
  label: string
  amount_note: string
  yearly_discount_pct?: number | null
}

export interface PlanCatalogEntry {
  code: string
  title: string
  blurb: string
  highlights: string[]
  monthly?: PlanPriceLine | null
  yearly?: PlanPriceLine | null
  seat_pricing_monthly_note?: string | null
  seat_pricing_yearly_note?: string | null
  trial_days?: number | null
  cta_kind: 'stripe_checkout' | 'contact_sales'
  contact_email?: string | null
  seats_min?: number | null
  seats_max?: number | null
}

export interface PlanCatalogResponse {
  plans: PlanCatalogEntry[]
}

/** Same shape as `/api/billing/plans` if the API is down — keeps UI usable offline. */
export const FALLBACK_PLANS: PlanCatalogEntry[] = [
  {
    code: 'solo',
    title: 'Solo',
    blurb:
      'One petro-engineer workstation with deterministic petrophysics and AI narration.',
    monthly: {
      label: 'Monthly billing',
      amount_note: '$500/month after the 7-day trial',
    },
    yearly: {
      label: 'Yearly billing',
      amount_note: '$4,800/year (20% versus twelve monthly invoices)',
      yearly_discount_pct: 20,
    },
    trial_days: 7,
    highlights: [
      '7-day free trial — no Solo charge until the trial ends',
      'LAS uploads sized for solo interpretation workflows',
      'Email support',
    ],
    cta_kind: 'stripe_checkout',
  },
  {
    code: 'team',
    title: 'Team',
    blurb: 'Shared workspace for multidisciplinary interpretation crews.',
    seat_pricing_monthly_note: '$250/seat/month (3–10 seats)',
    seat_pricing_yearly_note:
      '~$200/seat/month effective — 20% off when prepaid annually (Stripe quantity = seat count).',
    yearly: {
      label: 'Yearly billing',
      amount_note: '20% off each seat versus monthly invoicing.',
      yearly_discount_pct: 20,
    },
    highlights: [
      'Quantity-based billing for 3–10 collaborators',
      'Same feature set as Solo with room to grow',
      'Priority onboarding assistance',
    ],
    cta_kind: 'stripe_checkout',
    seats_min: 3,
    seats_max: 10,
  },
  {
    code: 'enterprise',
    title: 'Enterprise',
    blurb: 'For organizations with more than ten seats, SSO requirements, or custom contracts.',
    highlights: [
      'Volume licensing mapped to procurement workflows',
      'Security reviews & bespoke uptime expectations',
      'Dedicated technical liaison',
    ],
    cta_kind: 'contact_sales',
    contact_email: 'sales@example.com',
    seats_min: 11,
    seats_max: null,
  },
]

export function useBillingPlans() {
  return useQuery({
    queryKey: ['billing-plans'],
    queryFn: async () => {
      const { data } = await api.get<PlanCatalogResponse>('/api/billing/plans')
      return data
    },
    retry: 1,
    staleTime: 120_000,
  })
}

export function useStripeReady() {
  return useQuery({
    queryKey: ['stripe-status'],
    queryFn: async () => {
      const { data } = await api.get<{ checkout_configured: boolean }>(
        '/api/billing/stripe-status',
      )
      return data.checkout_configured
    },
    retry: 1,
    staleTime: 60_000,
  })
}
