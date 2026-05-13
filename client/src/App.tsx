import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect } from 'react'

import Landing from '@/pages/Landing'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import Dashboard from '@/pages/Dashboard'
import Report from '@/pages/Report'
import { useAuthStore } from '@/store/authStore'

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return children
}

function OAuthCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    const token = params.get('token')
    if (token) {
      // Minimal user record; /me will refresh later
      setSession(token, { id: '', email: '', name: '' })
      navigate('/dashboard', { replace: true })
    } else {
      navigate('/login', { replace: true })
    }
  }, [params, navigate, setSession])

  return (
    <div className="flex h-screen items-center justify-center text-text-dim">
      Completing sign-in&hellip;
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/oauth-callback" element={<OAuthCallback />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/report/:wellId"
        element={
          <ProtectedRoute>
            <Report />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
