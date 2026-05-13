import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, extractErrorMessage } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import type { TokenResponse, UserMe } from '@/types'

interface RegisterPayload {
  email: string
  name: string
  password: string
  confirm_password: string
}

interface LoginPayload {
  email: string
  password: string
}

export function useAuth() {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const setSession = useAuthStore((s) => s.setSession)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const register = useCallback(
    async (payload: RegisterPayload) => {
      try {
        const { data } = await api.post<TokenResponse>('/api/auth/register', payload)
        setSession(data.access_token, data.user)
        navigate('/dashboard')
        return data
      } catch (err) {
        throw new Error(extractErrorMessage(err, 'Registration failed.'))
      }
    },
    [navigate, setSession],
  )

  const login = useCallback(
    async (payload: LoginPayload) => {
      try {
        const { data } = await api.post<TokenResponse>('/api/auth/login', payload)
        setSession(data.access_token, data.user)
        navigate('/dashboard')
        return data
      } catch (err) {
        throw new Error(extractErrorMessage(err, 'Login failed.'))
      }
    },
    [navigate, setSession],
  )

  const fetchMe = useCallback(async () => {
    const { data } = await api.get<UserMe>('/api/auth/me')
    return data
  }, [])

  const signOut = useCallback(() => {
    logout()
    navigate('/login')
  }, [logout, navigate])

  return {
    token,
    user,
    isAuthenticated: Boolean(token),
    register,
    login,
    logout: signOut,
    fetchMe,
  }
}
