import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, extractErrorMessage } from '@/api/client'
import type {
  AnalysisMode,
  PetroParams,
  WellDetail,
  WellStats,
  WellSummary,
} from '@/types'

export function useWells() {
  return useQuery({
    queryKey: ['wells'],
    queryFn: async () => {
      const { data } = await api.get<WellSummary[]>('/api/wells')
      return data
    },
  })
}

export function useWellStats() {
  return useQuery({
    queryKey: ['well-stats'],
    queryFn: async () => {
      const { data } = await api.get<WellStats>('/api/wells/stats')
      return data
    },
  })
}

export function useWell(wellId: string | undefined) {
  return useQuery({
    queryKey: ['well', wellId],
    enabled: Boolean(wellId),
    queryFn: async () => {
      const { data } = await api.get<WellDetail>(`/api/wells/${wellId}`)
      return data
    },
  })
}

export function useUploadWell() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      file: File
      rho_ma?: number
      rho_fl?: number
      Rw?: number
      a?: number
      m?: number
      n?: number
      analysis_mode?: AnalysisMode
    }) => {
      const fd = new FormData()
      fd.append('las_file', input.file)
      if (input.rho_ma != null) fd.append('rho_ma', String(input.rho_ma))
      if (input.rho_fl != null) fd.append('rho_fl', String(input.rho_fl))
      if (input.Rw != null) fd.append('Rw', String(input.Rw))
      if (input.a != null) fd.append('a', String(input.a))
      if (input.m != null) fd.append('m', String(input.m))
      if (input.n != null) fd.append('n', String(input.n))
      if (input.analysis_mode) fd.append('analysis_mode', input.analysis_mode)
      try {
        const { data } = await api.post<WellDetail>('/api/wells/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000,
        })
        return data
      } catch (err) {
        throw new Error(extractErrorMessage(err, 'Upload failed.'))
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wells'] })
      qc.invalidateQueries({ queryKey: ['well-stats'] })
    },
  })
}

export function useDeleteWell() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (wellId: string) => {
      await api.delete(`/api/wells/${wellId}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wells'] })
      qc.invalidateQueries({ queryKey: ['well-stats'] })
    },
  })
}

export function useReanalyzeWell(wellId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      params: Partial<PetroParams> & { analysis_mode?: AnalysisMode },
    ) => {
      if (!wellId) throw new Error('No well id')
      try {
        const { data } = await api.post<WellDetail>(
          `/api/wells/${wellId}/reanalyze`,
          params,
          { timeout: 120000 },
        )
        return data
      } catch (err) {
        throw new Error(extractErrorMessage(err, 'Reanalysis failed.'))
      }
    },
    onSuccess: (data) => {
      if (wellId) {
        qc.setQueryData(['well', wellId], data)
      }
      qc.invalidateQueries({ queryKey: ['wells'] })
    },
  })
}

export async function downloadWellExport(wellId: string, fileName: string) {
  const resp = await api.get(`/api/wells/${wellId}/export`, { responseType: 'blob' })
  const blob = new Blob([resp.data], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
