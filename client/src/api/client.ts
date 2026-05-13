import axios, { AxiosError, AxiosInstance } from 'axios'

import { useAuthStore } from '@/store/authStore'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers = config.headers ?? {}
    ;(config.headers as Record<string, string>).Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token expired or invalid — purge auth state
      useAuthStore.getState().logout()
    }
    return Promise.reject(error)
  },
)

/** Pull a useful error string out of an axios error. */
export function extractErrorMessage(err: unknown, fallback = 'Request failed.'): string {
  const axiosErr = err as AxiosError<{ detail?: unknown }>
  const detail = axiosErr?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>
    if (typeof d.message === 'string') return d.message
    return JSON.stringify(detail)
  }
  if (axiosErr?.message) return axiosErr.message
  return fallback
}

export const API_BASE_URL = BASE_URL
