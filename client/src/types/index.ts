// Shared TypeScript types mirroring the server's pydantic schemas.

export interface UserPublic {
  id: string
  email: string
  name: string
}

export interface UserMe extends UserPublic {
  provider: string
  created_at: string
  well_count: number
  billing_plan?: string | null
  billing_status?: string | null
}

export interface TokenResponse {
  access_token: string
  token_type: 'bearer'
  user: UserPublic
}

/**
 * Mirrors ``AnalysisMode`` in ``server/app/schemas/well.py``:
 *   - 'deterministic' → numpy engine; LLM only narrates.
 *   - 'llm'           → numpy curves; LLM picks zones from them.
 *   - 'numpy_only'    → numpy engine only; no LLM calls at all.
 */
export type AnalysisMode = 'deterministic' | 'llm' | 'numpy_only'

export interface HcZoneOut {
  id: string
  zone_type: 'OIL' | 'GAS'
  top_ft: number
  bot_ft: number
  thick_ft: number
  shc_pct: number
  sw_pct: number
  phi_pct: number
  rt_mean: number
  gr_mean: number
  vsh_pct: number
  pef_mean: number
  bvw_mean: number
  producible_pct: number
  lith_flag: string
  ai_note: string | null
  /** Free-text explanation supplied by the LLM zone picker (mode="llm"). */
  ai_rationale?: string | null
  /** 'high' | 'medium' | 'low' confidence — only set when LLM picked the zone. */
  ai_confidence?: 'high' | 'medium' | 'low' | null
}

export interface WellSummary {
  id: string
  well_name: string
  api_number: string | null
  operator: string | null
  field: string | null
  log_date: string | null
  depth_start: number
  depth_stop: number
  curves_available: string[]
  created_at: string
  zone_count: number
  oil_zone_count: number
  gas_zone_count: number
  analysis_mode: AnalysisMode
}

export type CurveArrays = {
  depth: (number | null)[]
  GR: (number | null)[]
  NPHI: (number | null)[]
  DPHI: (number | null)[]
  RHOZ: (number | null)[]
  RT: (number | null)[]
  /** Additional resistivity mnemonics for comparison (downsampled overview). */
  rt_curves?: Record<string, (number | null)[]>
  PEF: (number | null)[]
  SP?: (number | null)[]
  Vsh: (number | null)[]
  phi_eff: (number | null)[]
  Sw: (number | null)[]
  Shc: (number | null)[]
  BVW: (number | null)[]
  hc_type: number[]
  lith_flag: number[]
}

export type ZoneDetailArrays = CurveArrays & { zone_index: number }

export interface ResultJson {
  overview: CurveArrays
  zone_details: ZoneDetailArrays[]
  stats: {
    GR_clean: number
    GR_shale: number
    mean_GR: number
    mean_RT: number
    mean_NPHI: number
    mean_phi_eff: number
    mean_Sw: number
    pef_distribution: {
      sandstone_pct: number
      dolomite_pct: number
      limestone_pct: number
      uncertain_pct: number
    }
    rho_ma_auto?: boolean
    Rw_auto?: boolean
    Rw_method?: string | null
    sp_used?: boolean
    sp_shale_baseline?: number | null
    sp_sand_line?: number | null
    /** ELAN/vendor porosity curve was merged (PIGN, PHIT, TPHI, …) */
    used_phi_input?: boolean
    /** ELAN/RST/vendor Sw curve was merged (SUWI, SW, …) */
    used_sw_input?: boolean
  }
  curve_map?: Record<string, string>
  validation?: Record<string, unknown>
  raw_arrays?: Record<string, (number | null)[]>
  /**
   * Metadata from whichever LLM picker ran — populated for every non-
   * deterministic analysis mode. The shape is a discriminated union on
   * ``mode``; presence of the various fields depends on which mode ran.
   */
  zone_picker?: {
    mode: AnalysisMode
    model?: string
    generated_at?: string
    /** llm — number of zones the LLM picked. */
    zone_count?: number
    depth_range_ft?: [number, number]
    well_summary?: string | null
    error?: string
    raw_text?: string
    skipped?: string[]
  }
}

export interface AIZoneInterpretation {
  zone_index: number
  fluid_type_confidence: 'high' | 'medium' | 'low'
  interpretation: string
  producibility_assessment: string
  concerns: string[]
  recommended_actions: string[]
}

export interface AIDataQualityFlag {
  severity: 'warning' | 'critical'
  curve: string
  message: string
}

export interface AIInterpretation {
  well_narrative?: string
  reservoir_context?: string
  zone_interpretations?: AIZoneInterpretation[]
  data_quality_flags?: AIDataQualityFlag[]
  lithology_summary?: string
  overall_confidence?: 'high' | 'medium' | 'low'
  overall_confidence_reason?: string
  disclaimer?: string
  generated_at?: string
  model?: string
  error?: string
  reason?: string
  raw_text?: string
}

export interface PetroParams {
  rho_ma: number | null
  rho_fl: number
  Rw: number | null
  a: number
  m: number
  n: number
  GR_clean: number | null
  GR_shale: number | null
  Rt_cutoff: number
  Shc_cutoff: number
  phi_cutoff: number
  Vsh_cutoff: number
  Sw_producible: number
}

export interface WellDetail extends WellSummary {
  petro_params: Partial<PetroParams>
  result_json: ResultJson
  ai_interpretation: AIInterpretation | null
  zones: HcZoneOut[]
}

export interface WellStats {
  total_wells: number
  total_hc_zones: number
  avg_porosity_pct: number
  avg_sw_pct: number
}

export type AssistantContextType = 'zone' | 'interval'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ProposedZone {
  zone_type: 'OIL' | 'GAS'
  top_ft: number
  bot_ft: number
  rationale: string
  confidence?: 'high' | 'medium' | 'low' | null
}

export interface AssistantReply {
  reply: string
  proposed_zone?: ProposedZone | null
  error?: string | null
  disclaimer?: string | null
  generated_at?: string | null
  model?: string | null
}

export interface DepthInterval {
  top_ft: number
  bot_ft: number
}
