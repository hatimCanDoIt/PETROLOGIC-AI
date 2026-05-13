import { API_BASE_URL } from '@/api/client'

export default function GoogleButton({ label }: { label: string }) {
  const onClick = () => {
    window.location.href = `${API_BASE_URL}/api/auth/google`
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full inline-flex items-center justify-center gap-3 h-11 rounded-md bg-white text-gray-800 font-medium hover:bg-gray-100 transition-colors"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <path
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.63z"
          fill="#4285F4"
        />
        <path
          d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.92v2.32A9 9 0 0 0 9 18z"
          fill="#34A853"
        />
        <path
          d="M3.98 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.3-1.72V4.96H.92A9 9 0 0 0 0 9c0 1.45.35 2.82.92 4.04l3.06-2.32z"
          fill="#FBBC05"
        />
        <path
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .92 4.96l3.06 2.32C4.68 5.16 6.66 3.58 9 3.58z"
          fill="#EA4335"
        />
      </svg>
      <span>{label}</span>
    </button>
  )
}
