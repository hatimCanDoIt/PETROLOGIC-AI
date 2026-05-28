import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, extractErrorMessage } from '@/api/client'
import type {
  AnalysisMode,
  AssistantReply,
  ChatMessage,
  DepthInterval,
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

export type AssistantContext =
  | { type: 'zone'; zoneId: string }
  | { type: 'interval'; interval: DepthInterval }

function assistantPayload(context: AssistantContext) {
  if (context.type === 'zone') {
    return { context_type: 'zone' as const, zone_id: context.zoneId }
  }
  return {
    context_type: 'interval' as const,
    top_ft: context.interval.top_ft,
    bot_ft: context.interval.bot_ft,
  }
}

export async function explainWithAssistant(
  wellId: string,
  context: AssistantContext,
): Promise<AssistantReply> {
  const { data } = await api.post<AssistantReply>(
    `/api/wells/${wellId}/assistant/explain`,
    assistantPayload(context),
    { timeout: 120000 },
  )
  return data
}

export async function chatWithAssistant(
  wellId: string,
  context: AssistantContext,
  messages: ChatMessage[],
): Promise<AssistantReply> {
  const { data } = await api.post<AssistantReply>(
    `/api/wells/${wellId}/assistant/chat`,
    { ...assistantPayload(context), messages },
    { timeout: 120000 },
  )
  return data
}

export function useAddZone(wellId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      zone_type: 'OIL' | 'GAS'
      top_ft: number
      bot_ft: number
      ai_rationale?: string | null
      ai_confidence?: 'high' | 'medium' | 'low' | null
    }) => {
      if (!wellId) throw new Error('No well id')
      const { data } = await api.post<WellDetail>(`/api/wells/${wellId}/zones`, input)
      return data
    },
    onSuccess: (data) => {
      if (wellId) qc.setQueryData(['well', wellId], data)
      qc.invalidateQueries({ queryKey: ['wells'] })
    },
  })
}

export async function fetchReportHtml(wellId: string): Promise<string> {
  const { data } = await api.get<string>(`/api/wells/${wellId}/export/report`, {
    responseType: 'text',
  })
  return data
}

export async function downloadWellPdf(wellId: string, fileName: string) {
  const resp = await api.get(`/api/wells/${wellId}/export/pdf`, { responseType: 'blob' })
  const blob = new Blob([resp.data], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
