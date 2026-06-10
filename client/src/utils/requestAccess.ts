/**
 * B2B access is sales-led: prospects request access / a demo by email.
 * Set VITE_REQUEST_ACCESS_EMAIL in client/.env to your inbox.
 */
const REQUEST_ACCESS_EMAIL =
  (import.meta.env.VITE_REQUEST_ACCESS_EMAIL as string | undefined) ||
  'sales@example.com'

const SUBJECT = 'PETROLOGIC AI — Access request'

const BODY = `Hi,

I'd like to request access to PETROLOGIC AI (or schedule a demo).

Name:
Company:
Role:
Wells / month (approx.):

Thanks!`

export const REQUEST_ACCESS_MAILTO = `mailto:${REQUEST_ACCESS_EMAIL}?subject=${encodeURIComponent(
  SUBJECT,
)}&body=${encodeURIComponent(BODY)}`
