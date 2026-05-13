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
}

export interface TokenResponse {
  access_token: string
  token_type: 'bearer'
  user: UserPublic
}

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
}

export type CurveArrays = {
  depth: (number | null)[]
  GR: (number | null)[]
  NPHI: (number | null)[]
  DPHI: (number | null)[]
  RHOZ: (number | null)[]
  RT: (number | null)[]
  PEF: (number | null)[]
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
  }
  curve_map?: Record<string, string>
  validation?: Record<string, unknown>
  raw_arrays?: Record<string, (number | null)[]>
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
  rho_ma: number
  rho_fl: number
  Rw: number
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
