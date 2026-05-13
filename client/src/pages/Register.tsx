import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'

import AuthShell from '@/components/layout/AuthShell'
import Button from '@/components/ui/Button'
import GoogleButton from '@/components/ui/GoogleButton'
import Input from '@/components/ui/Input'
import { useAuth } from '@/hooks/useAuth'

export default function Register() {
  const { register } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const validate = () => {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = 'Name is required.'
    if (!email.includes('@')) errs.email = 'Enter a valid email.'
    if (password.length < 8) errs.password = 'Min. 8 characters.'
    if (confirm !== password) errs.confirm = 'Passwords do not match.'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!validate()) return
    setLoading(true)
    try {
      await register({
        email,
        name,
        password,
        confirm_password: confirm,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Create Account"
      subtitle="Start analysing your first well in seconds"
      footer={
        <span>
          Already have an account?{' '}
          <Link to="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </span>
      }
    >
      <GoogleButton label="Sign up with Google" />

      <div className="my-5 flex items-center gap-3 text-text-dim font-mono text-[10px] uppercase tracking-widest">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label="Full name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          hint="At least 8 characters"
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fieldErrors.confirm}
        />
        {error && (
          <p className="text-xs font-mono text-gas" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" loading={loading} className="mt-2">
          {loading ? 'Creating account…' : 'Create Account'}
        </Button>
      </form>
    </AuthShell>
  )
}
