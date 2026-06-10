import { FormEvent, useState } from 'react'

import AuthShell from '@/components/layout/AuthShell'
import Button from '@/components/ui/Button'
import GoogleButton from '@/components/ui/GoogleButton'
import Input from '@/components/ui/Input'
import { SESSION_EXPIRED_KEY } from '@/api/client'
import { useAuth } from '@/hooks/useAuth'
import { REQUEST_ACCESS_MAILTO } from '@/utils/requestAccess'

function consumeSessionExpiredFlag(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
      sessionStorage.removeItem(SESSION_EXPIRED_KEY)
      return true
    }
  } catch {
    /* private mode */
  }
  return false
}

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sessionExpired] = useState(consumeSessionExpiredFlag)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login({ email, password })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Sign In"
      subtitle="Access your wells & interpretations"
      footer={
        <span>
          Don&apos;t have an account?{' '}
          <a href={REQUEST_ACCESS_MAILTO} className="text-accent hover:underline">
            Request access
          </a>
        </span>
      }
    >
      {sessionExpired && (
        <p
          role="status"
          className="mb-4 rounded-md border border-oil/40 bg-oil/10 px-3 py-2 text-xs text-text"
        >
          Your session expired. Please sign in again.
        </p>
      )}

      <GoogleButton label="Sign in with Google" />

      <div className="my-5 flex items-center gap-3 text-text-dim text-[10px] font-medium uppercase tracking-widest">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="text-xs text-gas" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" loading={loading} className="mt-2">
          {loading ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>
    </AuthShell>
  )
}
