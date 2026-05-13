"""Well upload / list / detail / re-analyze / export endpoints."""

from __future__ import annotations

import csv
import io
import logging
from typing import Any, Optional

import numpy as np
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..core.ai_interpreter import get_ai_interpretation
from ..core.las_parser import LASParseError, auto_select_curves, parse_las, validate_curves
from ..core.petrophysics import PetroParams, PetroResult, run_petrophysics
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..models.well import HcZone, Well
from ..schemas.well import (
    HcZoneOut,
    ReanalyzeRequest,
    WellDetail,
    WellStatsResponse,
    WellSummary,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/wells", tags=["wells"])


# ---------------------------------------------------------------------------
# Serialization helpers — numpy → JSON-safe
# ---------------------------------------------------------------------------


def _arr_to_list(a: np.ndarray, decimals: Optional[int] = None) -> list:
    """Convert a numpy array to a JSON-safe list with ``None`` for NaN."""
    if a is None:
        return []
    arr = np.asarray(a, dtype=np.float64)
    if decimals is not None:
        with np.errstate(invalid="ignore"):
            arr = np.round(arr, decimals)
    out: list = []
    for v in arr.tolist():
        if v is None or (isinstance(v, float) and not np.isfinite(v)):
            out.append(None)
        else:
            out.append(v)
    return out


def _int_arr_to_list(a: np.ndarray) -> list:
    if a is None:
        return []
    return [int(x) for x in np.asarray(a).tolist()]


def _downsample_indices(n: int, max_points: int) -> np.ndarray:
    """Return indices that evenly downsample length ``n`` to ≤ ``max_points``."""
    if n <= max_points:
        return np.arange(n)
    return np.linspace(0, n - 1, max_points).astype(int)


def _zone_window_indices(
    depth: np.ndarray, top_ft: float, bot_ft: float, padding_ft: float = 100.0
) -> np.ndarray:
    lo = top_ft - padding_ft
    hi = bot_ft + padding_ft
    return np.where((depth >= lo) & (depth <= hi))[0]


def _slice_result(result_arrays: dict, idx: np.ndarray) -> dict:
    """Index into a dict-of-arrays."""
    return {k: v[idx] for k, v in result_arrays.items()}


def _build_log_payload(result: PetroResult, *, overview_max: int = 3000) -> dict:
    """Build the on-disk log array payload for ``result_json``."""
    arrays = {
        "depth": result.depth,
        "GR": result.GR,
        "NPHI": result.NPHI,
        "DPHI": result.DPHI,
        "RHOZ": result.RHOZ,
        "RT": result.RT,
        "PEF": result.PEF,
        "Vsh": result.Vsh,
        "phi_eff": result.phi_eff,
        "Sw": result.Sw,
        "Shc": result.Shc,
        "BVW": result.BVW,
        "hc_type": result.hc_type.astype(np.float64),
        "lith_flag": result.lith_flag.astype(np.float64),
    }

    n = len(result.depth)
    ov_idx = _downsample_indices(n, overview_max)
    overview = {
        "depth": _arr_to_list(arrays["depth"][ov_idx], decimals=2),
        "GR": _arr_to_list(arrays["GR"][ov_idx], decimals=2),
        "NPHI": _arr_to_list(arrays["NPHI"][ov_idx], decimals=4),
        "DPHI": _arr_to_list(arrays["DPHI"][ov_idx], decimals=4),
        "RHOZ": _arr_to_list(arrays["RHOZ"][ov_idx], decimals=4),
        "RT": _arr_to_list(arrays["RT"][ov_idx], decimals=3),
        "PEF": _arr_to_list(arrays["PEF"][ov_idx], decimals=3),
        "Vsh": _arr_to_list(arrays["Vsh"][ov_idx], decimals=4),
        "phi_eff": _arr_to_list(arrays["phi_eff"][ov_idx], decimals=4),
        "Sw": _arr_to_list(arrays["Sw"][ov_idx], decimals=4),
        "Shc": _arr_to_list(arrays["Shc"][ov_idx], decimals=4),
        "BVW": _arr_to_list(arrays["BVW"][ov_idx], decimals=4),
        "hc_type": _int_arr_to_list(result.hc_type[ov_idx]),
        "lith_flag": _int_arr_to_list(result.lith_flag[ov_idx]),
    }

    zone_details = []
    for i, z in enumerate(result.zones):
        idx = _zone_window_indices(result.depth, z["top_ft"], z["bot_ft"])
        if idx.size == 0:
            continue
        zone_details.append(
            {
                "zone_index": i,
                "depth": _arr_to_list(arrays["depth"][idx], decimals=2),
                "GR": _arr_to_list(arrays["GR"][idx], decimals=2),
                "NPHI": _arr_to_list(arrays["NPHI"][idx], decimals=4),
                "DPHI": _arr_to_list(arrays["DPHI"][idx], decimals=4),
                "RHOZ": _arr_to_list(arrays["RHOZ"][idx], decimals=4),
                "RT": _arr_to_list(arrays["RT"][idx], decimals=3),
                "PEF": _arr_to_list(arrays["PEF"][idx], decimals=3),
                "Vsh": _arr_to_list(arrays["Vsh"][idx], decimals=4),
                "phi_eff": _arr_to_list(arrays["phi_eff"][idx], decimals=4),
                "Sw": _arr_to_list(arrays["Sw"][idx], decimals=4),
                "Shc": _arr_to_list(arrays["Shc"][idx], decimals=4),
                "BVW": _arr_to_list(arrays["BVW"][idx], decimals=4),
                "hc_type": _int_arr_to_list(result.hc_type[idx]),
                "lith_flag": _int_arr_to_list(result.lith_flag[idx]),
            }
        )

    return {
        "overview": overview,
        "zone_details": zone_details,
        "stats": {
            "GR_clean": round(float(result.GR_clean), 2),
            "GR_shale": round(float(result.GR_shale), 2),
            "mean_GR": round(float(result.mean_GR), 2),
            "mean_RT": round(float(result.mean_RT), 3),
            "mean_NPHI": round(float(result.mean_NPHI), 4),
            "mean_phi_eff": round(float(result.mean_phi_eff), 4),
            "mean_Sw": round(float(result.mean_Sw), 4),
            "pef_distribution": result.pef_distribution,
        },
        "raw_arrays": {
            "depth": _arr_to_list(result.depth, decimals=3),
            "GR": _arr_to_list(result.GR, decimals=3),
            "NPHI": _arr_to_list(result.NPHI, decimals=4),
            "RHOZ": _arr_to_list(result.RHOZ, decimals=4),
            "RT": _arr_to_list(result.RT, decimals=3),
            "PEF": _arr_to_list(result.PEF, decimals=3),
        },
    }


def _params_from_form(
    rho_ma: Optional[float],
    rho_fl: Optional[float],
    Rw: Optional[float],
    a: Optional[float],
    m: Optional[float],
    n: Optional[float],
    GR_clean: Optional[float] = None,
    GR_shale: Optional[float] = None,
    Rt_cutoff: Optional[float] = None,
    Shc_cutoff: Optional[float] = None,
    phi_cutoff: Optional[float] = None,
    Vsh_cutoff: Optional[float] = None,
    Sw_producible: Optional[float] = None,
) -> PetroParams:
    p = PetroParams()
    if rho_ma is not None:
        p.rho_ma = rho_ma
    if rho_fl is not None:
        p.rho_fl = rho_fl
    if Rw is not None:
        p.Rw = Rw
    if a is not None:
        p.a = a
    if m is not None:
        p.m = m
    if n is not None:
        p.n = n
    if GR_clean is not None:
        p.GR_clean = GR_clean
    if GR_shale is not None:
        p.GR_shale = GR_shale
    if Rt_cutoff is not None:
        p.Rt_cutoff = Rt_cutoff
    if Shc_cutoff is not None:
        p.Shc_cutoff = Shc_cutoff
    if phi_cutoff is not None:
        p.phi_cutoff = phi_cutoff
    if Vsh_cutoff is not None:
        p.Vsh_cutoff = Vsh_cutoff
    if Sw_producible is not None:
        p.Sw_producible = Sw_producible
    return p


def _well_to_summary(well: Well) -> WellSummary:
    zones = well.zones if hasattr(well, "zones") else []
    return WellSummary(
        id=well.id,
        well_name=well.well_name,
        api_number=well.api_number,
        operator=well.operator,
        field=well.field,
        log_date=well.log_date,
        depth_start=well.depth_start,
        depth_stop=well.depth_stop,
        curves_available=list(well.curves_available or []),
        created_at=well.created_at,
        zone_count=len(zones),
        oil_zone_count=sum(1 for z in zones if z.zone_type == "OIL"),
        gas_zone_count=sum(1 for z in zones if z.zone_type == "GAS"),
    )


def _well_to_detail(well: Well) -> WellDetail:
    base = _well_to_summary(well).model_dump()
    base.update(
        {
            "petro_params": well.petro_params or {},
            "result_json": well.result_json or {},
            "ai_interpretation": well.ai_interpretation,
            "zones": [HcZoneOut.model_validate(z) for z in well.zones],
        }
    )
    return WellDetail.model_validate(base)


# ---------------------------------------------------------------------------
# Shared analysis pipeline (used by upload + reanalyze)
# ---------------------------------------------------------------------------


async def _run_full_analysis(
    df,
    curve_map: dict,
    params: PetroParams,
    meta_for_ai: dict,
) -> tuple[PetroResult, dict]:
    result = run_petrophysics(df, curve_map, params)
    ai = await get_ai_interpretation(result, meta_for_ai, settings.ANTHROPIC_API_KEY)
    return result, ai


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/upload",
    response_model=WellDetail,
    status_code=status.HTTP_201_CREATED,
)
async def upload_well(
    las_file: UploadFile = File(...),
    rho_ma: Optional[float] = Form(None),
    rho_fl: Optional[float] = Form(None),
    Rw: Optional[float] = Form(None),
    a: Optional[float] = Form(None),
    m: Optional[float] = Form(None),
    n: Optional[float] = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # ---- basic file checks
    filename = las_file.filename or ""
    if not filename.lower().endswith(".las"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .las files are supported.",
        )

    raw = await las_file.read()
    if len(raw) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {settings.MAX_UPLOAD_MB} MB limit.",
        )

    # ---- parse LAS
    try:
        las_data = parse_las(raw)
    except LASParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    validation = validate_curves(las_data)
    if validation["missing_critical"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "LAS file is missing critical curves.",
                "missing_critical": validation["missing_critical"],
                "warnings": validation["warnings"],
            },
        )

    curve_map = auto_select_curves(las_data.df, validation)
    params = _params_from_form(rho_ma, rho_fl, Rw, a, m, n)

    curves_available = [c["name"] for c in las_data.meta.curves]
    meta_for_ai = {
        "well_name": las_data.meta.well_name,
        "field": las_data.meta.field,
        "operator": las_data.meta.operator,
        "log_date": las_data.meta.log_date,
        "curves_available": curves_available,
    }

    try:
        result, ai = await _run_full_analysis(
            las_data.df, curve_map, params, meta_for_ai
        )
    except Exception as exc:
        logger.exception("Analysis failure")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Analysis failed: {exc}",
        )

    log_payload = _build_log_payload(result)
    log_payload["curve_map"] = curve_map
    log_payload["validation"] = {
        k: v for k, v in validation.items() if k not in ("missing_critical",)
    }

    well = Well(
        user_id=current_user.id,
        well_name=las_data.meta.well_name,
        api_number=las_data.meta.api_number,
        operator=las_data.meta.operator,
        field=las_data.meta.field,
        log_date=las_data.meta.log_date,
        depth_start=las_data.meta.depth_start,
        depth_stop=las_data.meta.depth_stop,
        curves_available=curves_available,
        petro_params=params.to_dict(),
        result_json=log_payload,
        ai_interpretation=ai,
    )
    db.add(well)
    await db.flush()  # populate well.id

    # ---- persist zones
    ai_notes = _zone_ai_notes(ai, len(result.zones))
    for i, z in enumerate(result.zones):
        zone = HcZone(
            well_id=well.id,
            zone_type=z["type"],
            top_ft=z["top_ft"],
            bot_ft=z["bot_ft"],
            thick_ft=z["thick_ft"],
            shc_pct=z["shc_pct"],
            sw_pct=z["sw_pct"],
            phi_pct=z["phi_pct"],
            rt_mean=z["rt_mean"],
            gr_mean=z["gr_mean"],
            vsh_pct=z["vsh_pct"],
            pef_mean=z["pef_mean"],
            bvw_mean=z["bvw_mean"],
            producible_pct=z["producible_pct"],
            lith_flag=z["lith_flag"],
            ai_note=ai_notes.get(i),
        )
        db.add(zone)

    await db.commit()

    # ---- reload with eagerly loaded zones
    fresh = await db.execute(
        select(Well).options(selectinload(Well.zones)).where(Well.id == well.id)
    )
    return _well_to_detail(fresh.scalar_one())


def _zone_ai_notes(ai: dict | None, n_zones: int) -> dict[int, str]:
    """Extract per-zone interpretation text from the AI response."""
    if not isinstance(ai, dict):
        return {}
    notes: dict[int, str] = {}
    for entry in ai.get("zone_interpretations") or []:
        try:
            idx = int(entry.get("zone_index", -1))
        except (TypeError, ValueError):
            continue
        if 0 <= idx < n_zones:
            text = entry.get("interpretation") or ""
            notes[idx] = text[:1000]
    return notes


@router.get("", response_model=list[WellSummary])
async def list_wells(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = await db.execute(
        select(Well)
        .options(selectinload(Well.zones))
        .where(Well.user_id == current_user.id)
        .order_by(Well.created_at.desc())
    )
    return [_well_to_summary(w) for w in q.scalars().all()]


@router.get("/stats", response_model=WellStatsResponse)
async def well_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    total_q = await db.execute(
        select(func.count(Well.id)).where(Well.user_id == current_user.id)
    )
    total_wells = int(total_q.scalar() or 0)

    zones_q = await db.execute(
        select(
            func.count(HcZone.id),
            func.avg(HcZone.phi_pct),
            func.avg(HcZone.sw_pct),
        )
        .join(Well, Well.id == HcZone.well_id)
        .where(Well.user_id == current_user.id)
    )
    row = zones_q.one()
    return WellStatsResponse(
        total_wells=total_wells,
        total_hc_zones=int(row[0] or 0),
        avg_porosity_pct=float(row[1] or 0.0),
        avg_sw_pct=float(row[2] or 0.0),
    )


async def _get_user_well(
    well_id: str, current_user: User, db: AsyncSession
) -> Well:
    q = await db.execute(
        select(Well)
        .options(selectinload(Well.zones))
        .where(Well.id == well_id, Well.user_id == current_user.id)
    )
    well = q.scalar_one_or_none()
    if well is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Well not found."
        )
    return well


@router.get("/{well_id}", response_model=WellDetail)
async def get_well(
    well_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    well = await _get_user_well(well_id, current_user, db)
    return _well_to_detail(well)


@router.delete("/{well_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_well(
    well_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    well = await _get_user_well(well_id, current_user, db)
    await db.delete(well)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{well_id}/export")
async def export_well(
    well_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    well = await _get_user_well(well_id, current_user, db)
    rj = well.result_json or {}
    overview = rj.get("overview") or {}
    if not overview.get("depth"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No log data stored for this well.",
        )

    cols = [
        "DEPTH",
        "GR",
        "NPHI",
        "DPHI",
        "RHOZ",
        "RT",
        "PEF",
        "Vsh",
        "phi_eff",
        "Sw",
        "Shc",
        "BVW",
        "hc_type",
        "lith_flag",
    ]
    key_map = {"DEPTH": "depth"}

    n = len(overview["depth"])
    rows: list[list[Any]] = []
    for i in range(n):
        row: list[Any] = []
        for c in cols:
            k = key_map.get(c, c)
            v = overview.get(k, [None] * n)[i]
            row.append("" if v is None else v)
        rows.append(row)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(cols)
    writer.writerows(rows)
    csv_bytes = buf.getvalue().encode("utf-8")

    safe_well = "".join(
        c if c.isalnum() or c in "-_" else "_" for c in (well.well_name or "well")
    )
    filename = f"{safe_well}_{well.log_date or 'unknown'}_petrologic.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{well_id}/reanalyze", response_model=WellDetail)
async def reanalyze_well(
    well_id: str,
    payload: ReanalyzeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    well = await _get_user_well(well_id, current_user, db)
    rj = well.result_json or {}
    raw = rj.get("raw_arrays")
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Original log data is not stored. Please re-upload the LAS file.",
        )

    # Reconstitute a DataFrame from raw arrays
    import pandas as pd

    def _arr(name: str) -> np.ndarray:
        vals = raw.get(name) or []
        return np.array([np.nan if v is None else v for v in vals], dtype=np.float64)

    df = pd.DataFrame(
        {
            "DEPT": _arr("depth"),
            "GR": _arr("GR"),
            "NPHI": _arr("NPHI"),
            "RHOZ": _arr("RHOZ"),
            "RT": _arr("RT"),
            "PEF": _arr("PEF"),
        }
    )
    curve_map = {
        "GR": "GR",
        "NPHI": "NPHI",
        "RHOZ": "RHOZ",
        "RT": "RT",
        "PEF": "PEF",
    }

    stored = well.petro_params or {}
    base = PetroParams(**{k: stored[k] for k in stored if k in PetroParams.__dataclass_fields__})

    # Merge: new values override stored values
    update = payload.model_dump(exclude_none=True)
    for k, v in update.items():
        setattr(base, k, v)

    meta_for_ai = {
        "well_name": well.well_name,
        "field": well.field,
        "operator": well.operator,
        "log_date": well.log_date,
        "curves_available": list(well.curves_available or []),
    }

    try:
        result, ai = await _run_full_analysis(df, curve_map, base, meta_for_ai)
    except Exception as exc:
        logger.exception("Reanalysis failure")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reanalysis failed: {exc}",
        )

    log_payload = _build_log_payload(result)
    log_payload["curve_map"] = curve_map

    well.petro_params = base.to_dict()
    well.result_json = log_payload
    well.ai_interpretation = ai

    # Replace zones
    await db.execute(sql_delete(HcZone).where(HcZone.well_id == well.id))
    ai_notes = _zone_ai_notes(ai, len(result.zones))
    for i, z in enumerate(result.zones):
        db.add(
            HcZone(
                well_id=well.id,
                zone_type=z["type"],
                top_ft=z["top_ft"],
                bot_ft=z["bot_ft"],
                thick_ft=z["thick_ft"],
                shc_pct=z["shc_pct"],
                sw_pct=z["sw_pct"],
                phi_pct=z["phi_pct"],
                rt_mean=z["rt_mean"],
                gr_mean=z["gr_mean"],
                vsh_pct=z["vsh_pct"],
                pef_mean=z["pef_mean"],
                bvw_mean=z["bvw_mean"],
                producible_pct=z["producible_pct"],
                lith_flag=z["lith_flag"],
                ai_note=ai_notes.get(i),
            )
        )

    await db.commit()
    fresh = await db.execute(
        select(Well).options(selectinload(Well.zones)).where(Well.id == well.id)
    )
    return _well_to_detail(fresh.scalar_one())
