import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { UserPublic } from '@/types'

interface AuthState {
  token: string | null
  user: UserPublic | null
  setSession: (token: string, user: UserPublic) => void
  setUser: (user: UserPublic) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    {
      name: 'petrologic-auth',
      partialize: (s) => ({ token: s.token, user: s.user }),
    },
  ),
)
