# -*- coding: utf-8 -*-
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import pandas as pd
import numpy as np

FLUID_COLORS = {
    "gas":     "#1f77b4",
    "oil":     "#2ca02c",
    "CO2":     "#ff7f0e",
    "water":   "#aec7e8",
    "unknown": "#cccccc",
}

# ── Mineral reference data ────────────────────────────────────────────────────

# (name, rho_ma g/cc, nphi_ma v/v sandstone scale, pe b/e, line_color)
MINERALS_ND = [
    ("Sandstone",  2.65, 0.00,  "#d62728"),
    ("Limestone",  2.71, -0.02, "#9467bd"),
    ("Dolomite",   2.87, 0.04,  "#8c564b"),
    ("Anhydrite",  2.97, 0.01,  "#e377c2"),
    ("Shale",      2.55, 0.30,  "#7f7f7f"),
]

# (name, pe b/e, rho_ma g/cc, marker_symbol, color)
MINERALS_PE = [
    ("Quartz\n(Sandstone)", 1.81,  2.65, "diamond",       "#d62728"),
    ("Calcite\n(Limestone)",5.08,  2.71, "square",        "#9467bd"),
    ("Dolomite",            3.14,  2.87, "triangle-up",   "#8c564b"),
    ("Anhydrite",           5.05,  2.97, "star",          "#e377c2"),
    ("K-Feldspar",          2.86,  2.52, "circle",        "#17becf"),
    ("Halite (Salt)",       4.65,  2.04, "x",             "#bcbd22"),
    ("Kaolinite",           1.83,  2.41, "diamond-open",  "#aec7e8"),
    ("Illite",              3.45,  2.52, "square-open",   "#7f7f7f"),
    ("Coal",                0.17,  1.40, "star-open",     "#000000"),
    ("Pyrite",             16.97,  5.00, "cross",         "#ff7f0e"),
]

RHO_FLUID = 1.0   # brine


# ── Well-log track figure ──────────────────────────────────────────────────────

def build_log_figure(df, intervals, depth_range=None):
    """Multi-track well log with pay zone shading."""
    if df is None or df.empty:
        return go.Figure()

    plot_df = df.copy()
    if depth_range:
        lo, hi = depth_range
        plot_df = plot_df[(plot_df["DEPTH"] >= lo) & (plot_df["DEPTH"] <= hi)]
    if plot_df.empty:
        return go.Figure()

    tracks = _build_tracks(plot_df)
    if not tracks:
        return go.Figure()

    n = len(tracks)
    fig = make_subplots(
        rows=1, cols=n,
        shared_yaxes=True,
        subplot_titles=[t["title"] for t in tracks],
        horizontal_spacing=0.02,
    )

    for col_idx, track in enumerate(tracks, start=1):
        for trace in track["traces"]:
            fig.add_trace(trace, row=1, col=col_idx)
        if track.get("log_x"):
            fig.update_xaxes(type="log", row=1, col=col_idx)

    # Pay zone shading — span full width via paper x-reference
    if intervals is not None and not intervals.empty:
        for _, zone in intervals.iterrows():
            color = FLUID_COLORS.get(zone.get("fluid_type", "unknown"), "#cccccc")
            fig.add_shape(
                type="rect",
                xref="paper", x0=0, x1=1,
                yref="y", y0=zone["top_ft"], y1=zone["base_ft"],
                fillcolor=color, opacity=0.25, line_width=0,
                layer="below",
            )

    # Reverse ALL y-axes so depth increases downward (Plotly 6.x: must set
    # autorange on each axis individually — col=1 selector only sets yaxis,
    # leaving yaxis2…yaxisN in ascending order which makes tracks invisible)
    fig.update_yaxes(autorange="reversed")
    fig.update_yaxes(title_text="Depth (ft)", col=1)

    fig.update_layout(
        height=850,
        showlegend=True,
        legend=dict(orientation="h", y=-0.08),
        margin=dict(l=60, r=20, t=50, b=60),
        plot_bgcolor="#fafafa",
    )
    return fig


def _build_tracks(df):
    tracks = []
    cols = set(df.columns)

    if "GR" in cols:
        tracks.append({
            "title": "GR (GAPI)",
            "log_x": False,
            "traces": [go.Scatter(
                x=df["GR"], y=df["DEPTH"], mode="lines", name="GR",
                line=dict(color="green", width=1.2),
            )],
        })

    if "RHOB" in cols or "PE" in cols:
        traces = []
        if "RHOB" in cols:
            traces.append(go.Scatter(
                x=df["RHOB"], y=df["DEPTH"], mode="lines", name="RHOB (g/cc)",
                line=dict(color="red", width=1.2),
            ))
        if "PE" in cols:
            traces.append(go.Scatter(
                x=df["PE"], y=df["DEPTH"], mode="lines", name="PE",
                line=dict(color="purple", width=1.2, dash="dot"),
            ))
        tracks.append({"title": "RHOB / PE", "log_x": False, "traces": traces})

    if "NPHI" in cols or "DPHI" in cols:
        traces = []
        if "NPHI" in cols:
            traces.append(go.Scatter(
                x=df["NPHI"], y=df["DEPTH"], mode="lines", name="NPHI",
                line=dict(color="blue", width=1.2),
            ))
        if "DPHI" in cols:
            traces.append(go.Scatter(
                x=df["DPHI"], y=df["DEPTH"], mode="lines", name="DPHI",
                line=dict(color="red", width=1.2, dash="dash"),
            ))
        tracks.append({"title": "NPHI / DPHI", "log_x": False, "traces": traces})

    if "RT" in cols:
        tracks.append({
            "title": "RT (ohm·m)",
            "log_x": True,
            "traces": [go.Scatter(
                x=df["RT"].clip(lower=0.001), y=df["DEPTH"], mode="lines", name="RT",
                line=dict(color="black", width=1.2),
            )],
        })

    sw_phie_traces = []
    if "SW_CALC" in cols:
        sw_phie_traces.append(go.Scatter(
            x=df["SW_CALC"], y=df["DEPTH"], mode="lines", name="Sw",
            line=dict(color="royalblue", width=1.2),
        ))
    if "PHIE_CALC" in cols:
        sw_phie_traces.append(go.Scatter(
            x=df["PHIE_CALC"], y=df["DEPTH"], mode="lines", name="PHIE",
            line=dict(color="darkorange", width=1.2, dash="dash"),
        ))
    if sw_phie_traces:
        tracks.append({"title": "Sw / PHIE", "log_x": False, "traces": sw_phie_traces})

    if "VSH" in cols:
        tracks.append({
            "title": "Vsh",
            "log_x": False,
            "traces": [go.Scatter(
                x=df["VSH"], y=df["DEPTH"], mode="lines", name="Vsh",
                fill="tozerox", fillcolor="rgba(139,69,19,0.2)",
                line=dict(color="saddlebrown", width=1.2),
            )],
        })

    if "PAY_FLAG" in cols:
        tracks.append({
            "title": "Pay",
            "log_x": False,
            "traces": [go.Scatter(
                x=df["PAY_FLAG"], y=df["DEPTH"], mode="lines", name="Pay",
                fill="tozerox", fillcolor="rgba(44,160,44,0.35)",
                line=dict(color="green", width=1.2),
            )],
        })

    return tracks


# ── Crossover and lithology figures ───────────────────────────────────────────

def build_crossover_figures(df, intervals):
    """Auto-generate all crossover/lithology plots. Returns a dict of figures."""
    if df is None or df.empty:
        return {}

    figs = {}
    cols = set(df.columns)
    has_nphi = "NPHI" in cols
    has_dphi = "DPHI" in cols
    has_rhob = "RHOB" in cols
    has_pe   = "PE" in cols

    fluid = (
        df["FLUID_TYPE"]
        if "FLUID_TYPE" in df.columns
        else pd.Series(["unknown"] * len(df), index=df.index)
    )

    # ── Plot A: NPHI vs DPHI full-interval scatter ─────────────────────────
    if has_nphi and has_dphi:
        fig_a = go.Figure()
        for ftype, color in FLUID_COLORS.items():
            mask = fluid == ftype
            if mask.any():
                fig_a.add_trace(go.Scatter(
                    x=df.loc[mask, "NPHI"], y=df.loc[mask, "DPHI"],
                    mode="markers", name=ftype,
                    marker=dict(color=color, size=4, opacity=0.65),
                ))
        _add_unity_line(fig_a, axis_range=[0, 0.5])
        fig_a.update_layout(
            title="NPHI vs DPHI — Full Interval",
            xaxis_title="NPHI (v/v)", yaxis_title="DPHI (v/v)", height=480,
        )
        figs["nd_full"] = fig_a

    # ── Plot B: per pay zone N-D panels ───────────────────────────────────
    if has_nphi and has_dphi and intervals is not None and not intervals.empty:
        n_zones = min(len(intervals), 6)
        n_cols  = min(n_zones, 3)
        n_rows  = (n_zones + n_cols - 1) // n_cols
        titles = [
            f"{z.top_ft:.0f}–{z.base_ft:.0f} ft ({z.fluid_type})"
            for _, z in intervals.head(n_zones).iterrows()
        ]
        fig_b = make_subplots(rows=n_rows, cols=n_cols, subplot_titles=titles)
        for i, (_, zone) in enumerate(intervals.head(n_zones).iterrows()):
            r, c = i // n_cols + 1, i % n_cols + 1
            z_df  = df[(df["DEPTH"] >= zone["top_ft"]) & (df["DEPTH"] <= zone["base_ft"])]
            color = FLUID_COLORS.get(zone.get("fluid_type", "unknown"), "#cccccc")
            fig_b.add_trace(
                go.Scatter(
                    x=z_df["NPHI"], y=z_df["DPHI"], mode="markers",
                    name=f"Zone {i+1}", marker=dict(color=color, size=5),
                    showlegend=(i == 0),
                ),
                row=r, col=c,
            )
            fig_b.add_shape(
                type="line", x0=0, y0=0, x1=0.5, y1=0.5,
                line=dict(color="black", dash="dash"), row=r, col=c,
            )
        fig_b.update_layout(title="N-D Crossover per Detected Pay Zone", height=380 * n_rows)
        figs["nd_zones"] = fig_b

    # ── Plot C: RHOB vs NPHI — lithology with mineral reference lines ──────
    if has_rhob and has_nphi:
        figs["litho"] = _build_rhob_nphi_fig(df, fluid)

    # ── Plot D: RHOB vs PE — mineral identification chart ─────────────────
    if has_rhob and has_pe:
        figs["rhob_pe"] = _build_rhob_pe_fig(df, fluid)

    return figs


def _build_rhob_nphi_fig(df, fluid):
    """RHOB vs NPHI crossplot with lithology trend lines."""
    fig = go.Figure()

    # ── Data points coloured by fluid type ────────────────────────────────
    for ftype, color in FLUID_COLORS.items():
        mask = fluid == ftype
        if mask.any():
            fig.add_trace(go.Scatter(
                x=df.loc[mask, "NPHI"], y=df.loc[mask, "RHOB"],
                mode="markers", name=ftype,
                marker=dict(color=color, size=4, opacity=0.60),
            ))

    # ── Mineral lithology trend lines ─────────────────────────────────────
    # For each clean mineral, plot the water-saturated density vs NPHI line
    # across porosities 0 → 0.40 v/v.
    phi_range = np.linspace(0, 0.40, 50)
    for name, rho_ma, nphi_ma, color in MINERALS_ND:
        if name == "Shale":
            # Shale plots as a cloud region, not a trend line
            continue
        rho_line  = rho_ma - (rho_ma - RHO_FLUID) * phi_range
        nphi_line = nphi_ma + (1.0 - nphi_ma) * phi_range
        # Porosity tick labels at 0%, 10%, 20%, 30%
        phi_ticks = [0.0, 0.10, 0.20, 0.30]
        rho_ticks  = [rho_ma - (rho_ma - RHO_FLUID) * p for p in phi_ticks]
        nphi_ticks = [nphi_ma + (1.0 - nphi_ma) * p for p in phi_ticks]

        fig.add_trace(go.Scatter(
            x=nphi_line, y=rho_line,
            mode="lines", name=name,
            line=dict(color=color, width=2, dash="dot"),
            showlegend=True,
        ))
        # Porosity labels along the line
        fig.add_trace(go.Scatter(
            x=nphi_ticks, y=rho_ticks,
            mode="text",
            text=[f"φ={int(p*100)}%" for p in phi_ticks],
            textposition="top right",
            textfont=dict(color=color, size=9),
            showlegend=False,
            hoverinfo="skip",
        ))
        # Mineral name at 0% porosity endpoint
        fig.add_annotation(
            x=nphi_ma, y=rho_ma,
            text=f"<b>{name}</b>",
            showarrow=True, arrowhead=2, arrowcolor=color,
            arrowwidth=1.5, ax=30, ay=-20,
            font=dict(color=color, size=10),
        )

    # Shale region (ellipse approximation as a scatter cloud boundary)
    fig.add_annotation(
        x=0.30, y=2.55,
        text="<b>Shale</b>",
        showarrow=False,
        font=dict(color="#7f7f7f", size=11),
        bgcolor="rgba(255,255,255,0.6)",
    )

    fig.update_layout(
        title="RHOB vs NPHI — Lithology Identification",
        xaxis_title="NPHI (v/v)",
        yaxis_title="RHOB (g/cc)",
        yaxis=dict(autorange="reversed"),
        height=560,
        legend=dict(orientation="h", y=-0.15),
    )
    return fig


def _build_rhob_pe_fig(df, fluid):
    """RHOB vs PE crossplot with labelled mineral reference points."""
    fig = go.Figure()

    # ── Data points ───────────────────────────────────────────────────────
    for ftype, color in FLUID_COLORS.items():
        mask = fluid == ftype
        if mask.any():
            fig.add_trace(go.Scatter(
                x=df.loc[mask, "PE"], y=df.loc[mask, "RHOB"],
                mode="markers", name=ftype,
                marker=dict(color=color, size=4, opacity=0.55),
            ))

    # ── Mineral reference points ───────────────────────────────────────────
    # Plotted as large, labelled symbols so the user can read lithology directly
    for name, pe_val, rho_ma, symbol, color in MINERALS_PE:
        short = name.split("\n")[0]   # first line for hover
        fig.add_trace(go.Scatter(
            x=[pe_val], y=[rho_ma],
            mode="markers+text",
            name=short,
            text=[name.replace("\n", "<br>")],
            textposition="top center",
            textfont=dict(size=9, color=color),
            marker=dict(
                symbol=symbol, size=14,
                color=color,
                line=dict(color="black", width=1),
            ),
            showlegend=True,
        ))

    # ── Lithology identification zones (labelled boxes) ───────────────────
    zones = [
        # (x0, x1, y0, y1, label, color)
        (1.4, 2.4, 2.0, 2.7, "Sandstone", "rgba(255,100,100,0.08)"),
        (4.5, 5.5, 2.2, 2.75,"Limestone",  "rgba(150,100,255,0.08)"),
        (2.7, 3.6, 2.5, 2.95,"Dolomite",   "rgba(100,150,100,0.08)"),
        (2.5, 4.5, 2.0, 2.7, "Shale",      "rgba(150,150,150,0.08)"),
    ]
    for x0, x1, y0, y1, lbl, fill in zones:
        fig.add_shape(
            type="rect", x0=x0, x1=x1, y0=y0, y1=y1,
            fillcolor=fill, line=dict(color="gray", width=0.5, dash="dot"),
            layer="below",
        )
        fig.add_annotation(
            x=(x0 + x1) / 2, y=y1,
            text=f"<i>{lbl}</i>",
            showarrow=False,
            font=dict(size=9, color="gray"),
            yanchor="bottom",
        )

    fig.update_layout(
        title="RHOB vs PE — Mineral Identification",
        xaxis_title="PE (b/e)",
        yaxis_title="RHOB (g/cc)",
        yaxis=dict(range=[1.0, 3.6]),
        xaxis=dict(range=[0, 12]),
        height=580,
        legend=dict(orientation="h", y=-0.20, font=dict(size=9)),
    )
    return fig


# ── Analytics figures ─────────────────────────────────────────────────────────

def build_analytics_figures(df, intervals):
    """Bar charts of property distributions per pay zone."""
    if df is None or df.empty or intervals is None or intervals.empty:
        return {}

    figs = {}
    zone_labels = [
        f"Z{i+1} ({z.top_ft:.0f}–{z.base_ft:.0f}ft)"
        for i, (_, z) in enumerate(intervals.iterrows())
    ]

    props = [
        ("avg_phie",    "Avg PHIE (v/v)",  "darkorange"),
        ("avg_sw",      "Avg Sw (v/v)",    "royalblue"),
        ("avg_vsh",     "Avg Vsh (v/v)",   "saddlebrown"),
        ("avg_kint_md", "Avg Kint (mD)",   "mediumseagreen"),
    ]

    for col, title, color in props:
        if col not in intervals.columns:
            continue
        vals = intervals[col].tolist()
        if all(v is None for v in vals):
            continue
        fig = go.Figure(go.Bar(
            x=zone_labels, y=vals,
            marker_color=color,
            text=[f"{v:.3f}" if v is not None else "N/A" for v in vals],
            textposition="outside",
        ))
        fig.update_layout(title=title, xaxis_title="Pay Zone",
                          yaxis_title=title, height=380)
        figs[col] = fig

    combined = go.Figure()
    for col, label, color in props:
        if col in intervals.columns and not intervals[col].isna().all():
            combined.add_trace(go.Bar(
                name=label, x=zone_labels,
                y=intervals[col].tolist(), marker_color=color,
            ))
    combined.update_layout(
        barmode="group", title="All Properties per Pay Zone",
        xaxis_title="Pay Zone", height=420,
    )
    figs["combined"] = combined

    return figs


# ── Helper ─────────────────────────────────────────────────────────────────────

def _add_unity_line(fig, axis_range):
    lo, hi = axis_range
    fig.add_shape(
        type="line", x0=lo, y0=lo, x1=hi, y1=hi,
        line=dict(color="black", dash="dash", width=1),
    )
