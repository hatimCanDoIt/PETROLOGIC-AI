"""Pydantic schemas for /api/wells endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# "deterministic" → numpy engine, LLM only narrates the result.
# "llm"           → numpy engine, LLM picks zones from the computed curves.
AnalysisMode = Literal["deterministic", "llm"]


class HcZoneOut(BaseModel):
    id: str
    zone_type: str
    top_ft: float
    bot_ft: float
    thick_ft: float
    shc_pct: float
    sw_pct: float
    phi_pct: float
    rt_mean: float
    gr_mean: float
    vsh_pct: float
    pef_mean: float
    bvw_mean: float
    producible_pct: float
    lith_flag: str
    ai_note: Optional[str] = None
    # Populated only when the LLM picked the zone.
    ai_rationale: Optional[str] = None
    ai_confidence: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class WellSummary(BaseModel):
    """Summary used in list views — no log arrays."""

    id: str
    well_name: str
    api_number: Optional[str] = None
    operator: Optional[str] = None
    field: Optional[str] = None
    log_date: Optional[str] = None
    depth_start: float
    depth_stop: float
    curves_available: List[str] = Field(default_factory=list)
    created_at: datetime
    zone_count: int = 0
    oil_zone_count: int = 0
    gas_zone_count: int = 0
    analysis_mode: AnalysisMode = "deterministic"

    model_config = ConfigDict(from_attributes=True)


class WellDetail(WellSummary):
    """Full report payload including log arrays and AI interpretation."""

    petro_params: Dict[str, Any] = Field(default_factory=dict)
    result_json: Dict[str, Any] = Field(default_factory=dict)
    ai_interpretation: Optional[Dict[str, Any]] = None
    zones: List[HcZoneOut] = Field(default_factory=list)


class ReanalyzeRequest(BaseModel):
    rho_ma: Optional[float] = Field(default=None, ge=1.0, le=4.0)
    rho_fl: Optional[float] = Field(default=None, ge=0.5, le=1.5)
    Rw: Optional[float] = Field(default=None, gt=0)
    a: Optional[float] = Field(default=None, gt=0)
    m: Optional[float] = Field(default=None, gt=0)
    n: Optional[float] = Field(default=None, gt=0)
    GR_clean: Optional[float] = None
    GR_shale: Optional[float] = None
    Rt_cutoff: Optional[float] = Field(default=None, gt=0)
    Shc_cutoff: Optional[float] = Field(default=None, ge=0, le=1)
    phi_cutoff: Optional[float] = Field(default=None, ge=0, le=1)
    Vsh_cutoff: Optional[float] = Field(default=None, ge=0, le=1)
    Sw_producible: Optional[float] = Field(default=None, ge=0, le=1)
    # If supplied, switch the well's analysis mode for this re-run. Omitted
    # → keep the mode the well was last analyzed with.
    analysis_mode: Optional[AnalysisMode] = None


class WellStatsResponse(BaseModel):
    total_wells: int
    total_hc_zones: int
    avg_porosity_pct: float
    avg_sw_pct: float
