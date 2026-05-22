# -*- coding: utf-8 -*-
"""
Autonomous Hydrocarbon Analysis Software
Run:  python app.py
Then open  http://localhost:8050  in your browser.
"""
import threading
import webbrowser
from datetime import datetime
from pathlib import Path

import pandas as pd
import numpy as np

import dash
from dash import dcc, html, dash_table, Input, Output, State, no_update
import plotly.graph_objects as go

import las_loader
import engine
import log_display


# ── App init ──────────────────────────────────────────────────────────────────

app = dash.Dash(__name__, suppress_callback_exceptions=True)
app.title = "Hydrocarbon Analysis"

_RESULTS_DIR = None   # set when first analysis is run


# ── Colour palette ────────────────────────────────────────────────────────────
COLORS = {
    "header_bg": "#1a3a4a",
    "tab_bg":    "#f0f4f8",
    "accent":    "#2ca02c",
    "button":    "#1f77b4",
    "danger":    "#d62728",
}


# ── Reusable style helpers ────────────────────────────────────────────────────

def _card(children, style=None):
    base = {
        "background": "white",
        "borderRadius": "8px",
        "boxShadow": "0 2px 6px rgba(0,0,0,.1)",
        "padding": "18px 22px",
        "marginBottom": "18px",
    }
    if style:
        base.update(style)
    return html.Div(children, style=base)


def _btn(label, btn_id, color=None, style=None):
    base = {
        "fontSize": "14px",
        "padding": "8px 22px",
        "borderRadius": "6px",
        "border": "none",
        "cursor": "pointer",
        "backgroundColor": color or COLORS["button"],
        "color": "white",
        "marginRight": "10px",
    }
    if style:
        base.update(style)
    return html.Button(label, id=btn_id, n_clicks=0, style=base)


def _label(text):
    return html.Label(text, style={"fontWeight": "600", "marginTop": "10px", "display": "block"})


# ── Tab 1: Batch Loading & Configuration ──────────────────────────────────────

def _tab1():
    return html.Div([
        _card([
            html.H4("File Selection", style={"marginTop": 0}),
            _btn("Browse Files…", "btn-browse"),
            html.Div(id="file-list", style={
                "marginTop": "12px", "padding": "10px",
                "background": "#f5f8fa", "borderRadius": "6px",
                "minHeight": "55px", "fontSize": "13px", "color": "#555",
            }),
        ]),

        _card([
            html.H4("Detection Parameters", style={"marginTop": 0}),
            html.Div([
                # Left column
                html.Div([
                    _label("Vsh cutoff (max shale volume)"),
                    dcc.Slider(0, 1, 0.05, value=0.35, id="slider-vsh",
                               marks={0: "0", 0.5: "0.5", 1: "1"},
                               tooltip={"placement": "bottom", "always_visible": True}),

                    _label("Minimum effective porosity (PHIE)"),
                    dcc.Slider(0, 0.45, 0.01, value=0.05, id="slider-phi",
                               marks={0: "0", 0.2: "0.2", 0.4: "0.4"},
                               tooltip={"placement": "bottom", "always_visible": True}),

                    _label("Maximum water saturation (Sw)"),
                    dcc.Slider(0, 1, 0.05, value=0.65, id="slider-sw",
                               marks={0: "0", 0.5: "0.5", 1: "1"},
                               tooltip={"placement": "bottom", "always_visible": True}),

                    _label("N-D crossover threshold (gas flag)"),
                    dcc.Slider(0, 0.15, 0.005, value=0.02, id="slider-xover",
                               marks={0: "0", 0.05: "0.05", 0.10: "0.10", 0.15: "0.15"},
                               tooltip={"placement": "bottom", "always_visible": True}),
                ], style={"width": "48%", "display": "inline-block", "verticalAlign": "top",
                           "paddingRight": "3%"}),

                # Right column
                html.Div([
                    _label("Min deep resistivity Rt (ohm·m)"),
                    dcc.Input(id="input-rt", type="number", value=10.0, step=1,
                              style={"width": "140px", "marginTop": "4px"}),

                    _label("Formation water resistivity Rw (ohm·m)"),
                    dcc.Input(id="input-rw", type="number", value=0.05, step=0.001,
                              style={"width": "140px", "marginTop": "4px"}),

                    _label("Matrix density ρ_ma (g/cc)"),
                    dcc.Input(id="input-rhomat", type="number", value=2.65, step=0.01,
                              style={"width": "140px", "marginTop": "4px"}),

                    _label("Fluid target"),
                    dcc.Dropdown(
                        id="dropdown-target",
                        options=[
                            {"label": "Hydrocarbon (oil + gas)", "value": "hc"},
                            {"label": "CO2", "value": "co2"},
                            {"label": "All fluids", "value": "all"},
                        ],
                        value="hc",
                        clearable=False,
                        style={"marginTop": "4px"},
                    ),
                ], style={"width": "48%", "display": "inline-block", "verticalAlign": "top"}),
            ]),
        ]),

        _card([
            _btn("▶  Run Analysis", "btn-run", color=COLORS["accent"]),
            html.Span(id="run-status", style={"marginLeft": "14px", "color": "#555", "fontSize": "13px"}),
        ]),
    ], style={"padding": "20px", "maxWidth": "1100px", "margin": "auto"})


# ── Tab 2: Pay Zone Summary ───────────────────────────────────────────────────

def _tab2():
    return html.Div([
        _card([
            html.Div([
                html.H4(id="well-title", children="Well: —", style={"display": "inline-block", "marginTop": 0}),
                html.Div([
                    _btn("⬇  Download Results", "btn-download", color="#6c757d",
                         style={"float": "right", "marginTop": "2px"}),
                    dcc.Download(id="dl-results"),
                ], style={"display": "inline-block", "float": "right"}),
            ], style={"overflow": "hidden"}),

            html.Div([
                html.Span("Depth range (ft): ", style={"fontWeight": "600"}),
                dcc.RangeSlider(
                    id="depth-slider",
                    min=0, max=20000, step=50,
                    value=[0, 20000],
                    tooltip={"placement": "bottom", "always_visible": True},
                    marks={},
                ),
            ], style={"marginTop": "10px"}),
        ]),

        _card([
            html.H4("Detected Pay Zones", style={"marginTop": 0}),
            html.Div(id="interval-table"),
        ]),

        _card([
            html.H4("Well Log Tracks", style={"marginTop": 0}),
            dcc.Loading(
                dcc.Graph(id="log-tracks", config={"scrollZoom": True}, style={"height": "870px"}),
                type="circle",
            ),
        ]),
    ], style={"padding": "20px", "maxWidth": "1400px", "margin": "auto"})


# ── Tab 3: Crossover Validation ───────────────────────────────────────────────

def _tab3():
    return html.Div([
        _card([
            html.H4("N-D Crossover — Full Interval", style={"marginTop": 0}),
            dcc.Loading(dcc.Graph(id="xplot-nd-full"), type="circle"),
        ]),
        _card([
            html.H4("N-D Crossover per Pay Zone", style={"marginTop": 0}),
            dcc.Loading(dcc.Graph(id="xplot-nd-zones"), type="circle"),
        ]),
        html.Div([
            _card([
                html.H4("RHOB vs NPHI — Lithology", style={"marginTop": 0}),
                dcc.Loading(dcc.Graph(id="xplot-litho"), type="circle"),
            ], style={"width": "48%", "display": "inline-block", "verticalAlign": "top",
                      "marginRight": "3%"}),
            _card([
                html.H4("RHOB vs PE — Mineral ID", style={"marginTop": 0}),
                dcc.Loading(dcc.Graph(id="xplot-rhob-pe"), type="circle"),
            ], style={"width": "48%", "display": "inline-block", "verticalAlign": "top"}),
        ]),
    ], style={"padding": "20px", "maxWidth": "1300px", "margin": "auto"})


# ── Tab 4: Production Analytics ───────────────────────────────────────────────

def _tab4():
    return html.Div([
        _card([
            html.H4("Property Overview per Pay Zone", style={"marginTop": 0}),
            dcc.Loading(dcc.Graph(id="analytics-combined"), type="circle"),
        ]),
        html.Div([
            _card([
                html.H4("Effective Porosity (PHIE)", style={"marginTop": 0}),
                dcc.Loading(dcc.Graph(id="analytics-phie"), type="circle"),
            ], style={"width": "48%", "display": "inline-block", "verticalAlign": "top",
                      "marginRight": "3%"}),
            _card([
                html.H4("Water Saturation (Sw)", style={"marginTop": 0}),
                dcc.Loading(dcc.Graph(id="analytics-sw"), type="circle"),
            ], style={"width": "48%", "display": "inline-block", "verticalAlign": "top"}),
        ]),
        html.Div([
            _card([
                html.H4("Shale Volume (Vsh)", style={"marginTop": 0}),
                dcc.Loading(dcc.Graph(id="analytics-vsh"), type="circle"),
            ], style={"width": "48%", "display": "inline-block", "verticalAlign": "top",
                      "marginRight": "3%"}),
            _card([
                html.H4("Permeability (Kint)", style={"marginTop": 0}),
                dcc.Loading(dcc.Graph(id="analytics-kint"), type="circle"),
            ], style={"width": "48%", "display": "inline-block", "verticalAlign": "top"}),
        ]),
    ], style={"padding": "20px", "maxWidth": "1300px", "margin": "auto"})


# ── Main layout ───────────────────────────────────────────────────────────────

app.layout = html.Div([
    # Persistent stores
    dcc.Store(id="store-df"),           # full result DataFrame as JSON
    dcc.Store(id="store-intervals"),    # pay interval DataFrame as JSON
    dcc.Store(id="store-well-name"),
    dcc.Store(id="store-paths"),        # selected file paths

    # Header
    html.Div(
        html.H2("⛽Hydrocarbon Analysis", style={
            "color": "white", "margin": 0, "padding": "14px 28px",
            "fontFamily": "sans-serif",
        }),
        style={"background": COLORS["header_bg"]},
    ),

    # Tabs
    dcc.Tabs(
        id="tabs",
        value="tab-1",
        style={"fontFamily": "sans-serif"},
        children=[
            dcc.Tab(label="1 · Load & Configure",    value="tab-1", children=_tab1()),
            dcc.Tab(label="2 · Pay Zone Summary",    value="tab-2", children=_tab2()),
            dcc.Tab(label="3 · Crossover Validation",value="tab-3", children=_tab3()),
            dcc.Tab(label="4 · Analytics",           value="tab-4", children=_tab4()),
        ],
    ),
], style={"fontFamily": "sans-serif", "background": COLORS["tab_bg"], "minHeight": "100vh"})


# ── Callback: browse files ────────────────────────────────────────────────────

@app.callback(
    Output("store-paths", "data"),
    Output("file-list", "children"),
    Input("btn-browse", "n_clicks"),
    prevent_initial_call=True,
)
def browse_files(_):
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.wm_attributes("-topmost", True)
    paths = filedialog.askopenfilenames(
        title="Select LAS Files",
        filetypes=[("LAS Files", "*.las *.LAS"), ("All Files", "*.*")],
    )
    root.destroy()

    if not paths:
        return no_update, html.Em("No files selected.", style={"color": "#999"})

    paths = list(paths)
    items = [
        html.Li(Path(p).name, title=p, style={"marginBottom": "2px"})
        for p in paths
    ]
    return paths, html.Ul(items, style={"margin": 0, "paddingLeft": "18px"})


# ── Callback: run analysis ────────────────────────────────────────────────────

@app.callback(
    Output("store-df",        "data"),
    Output("store-intervals", "data"),
    Output("store-well-name", "data"),
    Output("run-status",      "children"),
    Input("btn-run", "n_clicks"),
    State("store-paths",      "data"),
    State("slider-vsh",       "value"),
    State("slider-phi",       "value"),
    State("slider-sw",        "value"),
    State("slider-xover",     "value"),
    State("input-rt",         "value"),
    State("input-rw",         "value"),
    State("input-rhomat",     "value"),
    prevent_initial_call=True,
)
def run_analysis(_, paths, vsh_cut, phi_cut, sw_cut, xover, rt_cut, rw, rho_mat):
    global _RESULTS_DIR

    if not paths:
        return no_update, no_update, no_update, "⚠ No files selected — use Browse Files first."

    cfg = dict(
        vsh_cut=vsh_cut or 0.35,
        phi_cut=phi_cut or 0.05,
        sw_cut=sw_cut or 0.65,
        rt_cut=rt_cut or 10.0,
        xover_threshold=xover or 0.02,
        rw=rw or 0.05,
        rho_matrix=rho_mat or 2.65,
    )

    try:
        well_name, df = las_loader.merge_las_files(paths)
    except Exception as exc:
        return no_update, no_update, no_update, f"❌ Load error: {exc}"

    if df.empty:
        return no_update, no_update, no_update, "❌ Could not load curves from the selected files."

    try:
        result_df  = engine.detect_pay_zones(df, cfg)
        intervals  = engine.get_pay_intervals(result_df)
    except Exception as exc:
        return no_update, no_update, no_update, f"❌ Engine error: {exc}"

    # Auto-save results
    _RESULTS_DIR = Path(paths[0]).parent / "results"
    _save_results(_RESULTS_DIR, well_name, result_df, intervals, cfg)

    n_pay = len(intervals)
    status = (
        f"✅ Done — {n_pay} pay zone(s) detected across "
        f"{result_df['DEPTH'].min():.0f}–{result_df['DEPTH'].max():.0f} ft. "
        f"Results saved to results/"
    )

    return (
        result_df.to_json(orient="split", date_format="iso"),
        intervals.to_json(orient="split") if not intervals.empty else "{}",
        well_name,
        status,
    )


# ── Callback: update depth slider bounds ──────────────────────────────────────

@app.callback(
    Output("depth-slider", "min"),
    Output("depth-slider", "max"),
    Output("depth-slider", "value"),
    Output("depth-slider", "marks"),
    Input("store-df", "data"),
)
def update_slider(store_data):
    if not store_data:
        return 0, 20000, [0, 20000], {}
    df = pd.read_json(store_data, orient="split")
    lo = float(df["DEPTH"].min())
    hi = float(df["DEPTH"].max())
    step = (hi - lo) / 5
    marks = {int(lo + i * step): f"{int(lo + i * step)}" for i in range(6)}
    return lo, hi, [lo, hi], marks


# ── Callback: well title ──────────────────────────────────────────────────────

@app.callback(
    Output("well-title", "children"),
    Input("store-well-name", "data"),
)
def update_well_title(name):
    return f"Well: {name or '—'}"


# ── Callback: interval table ──────────────────────────────────────────────────

@app.callback(
    Output("interval-table", "children"),
    Input("store-intervals", "data"),
)
def update_interval_table(store_intervals):
    if not store_intervals or store_intervals == "{}":
        return html.Em("No pay zones detected yet.", style={"color": "#999"})

    iv = pd.read_json(store_intervals, orient="split")
    if iv.empty:
        return html.Em("No pay zones detected.", style={"color": "#999"})

    # Rename columns for display
    display_cols = {
        "top_ft":       "Top (ft)",
        "base_ft":      "Base (ft)",
        "thickness_ft": "Thickness (ft)",
        "avg_vsh":      "Avg Vsh",
        "avg_phie":     "Avg PHIE",
        "avg_sw":       "Avg Sw",
        "avg_kint_md":  "Avg Kint (mD)",
        "fluid_type":   "Fluid",
    }
    iv_renamed = iv.rename(columns=display_cols)
    keep_cols  = [c for c in display_cols.values() if c in iv_renamed.columns]
    iv_disp    = iv_renamed[keep_cols]

    return dash_table.DataTable(
        data=iv_disp.to_dict("records"),
        columns=[{"name": c, "id": c} for c in iv_disp.columns],
        style_table={"overflowX": "auto"},
        style_cell={"textAlign": "center", "padding": "6px 10px", "fontSize": "13px"},
        style_header={"backgroundColor": COLORS["header_bg"], "color": "white", "fontWeight": "bold"},
        style_data_conditional=[
            {"if": {"filter_query": '{Fluid} = "gas"'},   "backgroundColor": "#cce5ff"},
            {"if": {"filter_query": '{Fluid} = "oil"'},   "backgroundColor": "#d4edda"},
            {"if": {"filter_query": '{Fluid} = "CO2"'},   "backgroundColor": "#ffe5cc"},
            {"if": {"filter_query": '{Fluid} = "water"'}, "backgroundColor": "#f8f9fa"},
        ],
        page_size=15,
    )


# ── Callback: log tracks ──────────────────────────────────────────────────────

@app.callback(
    Output("log-tracks", "figure"),
    Input("store-df",        "data"),
    Input("store-intervals", "data"),
    Input("depth-slider",    "value"),
)
def update_log_tracks(store_df, store_intervals, depth_range):
    if not store_df:
        return go.Figure()
    df = pd.read_json(store_df, orient="split")
    iv = pd.read_json(store_intervals, orient="split") if store_intervals and store_intervals != "{}" else pd.DataFrame()
    return log_display.build_log_figure(df, iv, depth_range)


# ── Callback: crossover plots (auto-generated on data load) ───────────────────

@app.callback(
    Output("xplot-nd-full",   "figure"),
    Output("xplot-nd-zones",  "figure"),
    Output("xplot-litho",     "figure"),
    Output("xplot-rhob-pe",   "figure"),
    Input("store-df",        "data"),
    Input("store-intervals", "data"),
    Input("depth-slider",    "value"),
)
def update_crossplots(store_df, store_intervals, depth_range):
    empty = go.Figure()
    if not store_df:
        return empty, empty, empty, empty

    df = pd.read_json(store_df, orient="split")
    iv = pd.read_json(store_intervals, orient="split") if store_intervals and store_intervals != "{}" else pd.DataFrame()

    # Apply depth filter for highlighting
    if depth_range:
        lo, hi = depth_range
        mask = (df["DEPTH"] >= lo) & (df["DEPTH"] <= hi)
        df_view = df.copy()
        df_view["_in_range"] = mask
    else:
        df_view = df

    figs = log_display.build_crossover_figures(df_view, iv)
    return (
        figs.get("nd_full",   empty),
        figs.get("nd_zones",  empty),
        figs.get("litho",     empty),
        figs.get("rhob_pe",   empty),
    )


# ── Callback: analytics plots ─────────────────────────────────────────────────

@app.callback(
    Output("analytics-combined", "figure"),
    Output("analytics-phie",     "figure"),
    Output("analytics-sw",       "figure"),
    Output("analytics-vsh",      "figure"),
    Output("analytics-kint",     "figure"),
    Input("store-df",        "data"),
    Input("store-intervals", "data"),
)
def update_analytics(store_df, store_intervals):
    empty = go.Figure()
    if not store_df or not store_intervals or store_intervals == "{}":
        return empty, empty, empty, empty, empty

    df = pd.read_json(store_df, orient="split")
    iv = pd.read_json(store_intervals, orient="split")
    if iv.empty:
        return empty, empty, empty, empty, empty

    figs = log_display.build_analytics_figures(df, iv)
    return (
        figs.get("combined",    empty),
        figs.get("avg_phie",    empty),
        figs.get("avg_sw",      empty),
        figs.get("avg_vsh",     empty),
        figs.get("avg_kint_md", empty),
    )


# ── Callback: download results ────────────────────────────────────────────────

@app.callback(
    Output("dl-results", "data"),
    Input("btn-download", "n_clicks"),
    State("store-df",        "data"),
    State("store-intervals", "data"),
    State("store-well-name", "data"),
    prevent_initial_call=True,
)
def download_results(_, store_df, store_intervals, well_name):
    if not store_df:
        return no_update

    df = pd.read_json(store_df, orient="split")
    iv = pd.read_json(store_intervals, orient="split") if store_intervals and store_intervals != "{}" else pd.DataFrame()

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = (well_name or "well").replace(" ", "_").replace("#", "").replace("/", "-")
    filename = f"{safe}_{ts}_results.xlsx"

    import io
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        if not iv.empty:
            iv.to_excel(writer, sheet_name="Pay_Zones", index=False)
        df.to_excel(writer, sheet_name="Depth_Log", index=False)
    buf.seek(0)

    return dcc.send_bytes(buf.read(), filename)


# ── Results auto-save helper ──────────────────────────────────────────────────

def _save_results(out_dir, well_name, df, intervals, config):
    try:
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe = well_name.replace(" ", "_").replace("#", "").replace("/", "-")
        path = out_dir / f"{safe}_{ts}_results.xlsx"

        with pd.ExcelWriter(path, engine="openpyxl") as writer:
            if not intervals.empty:
                intervals.to_excel(writer, sheet_name="Pay_Zones", index=False)
            df.to_excel(writer, sheet_name="Depth_Log", index=False)
            pd.DataFrame([config]).to_excel(writer, sheet_name="Config", index=False)

        print(f"[app] Results saved → {path}")
    except Exception as exc:
        print(f"[app] Could not save results: {exc}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    threading.Timer(1.5, lambda: webbrowser.open("http://localhost:8050")).start()
    app.run(debug=False, host="localhost", port=8050)
