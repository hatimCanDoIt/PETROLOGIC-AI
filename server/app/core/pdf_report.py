"""Well report HTML + PDF export with zone summaries and AI interpretation."""

from __future__ import annotations

import html
import io
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any

DISCLAIMER = (
    "This AI-generated interpretation requires validation by a licensed "
    "petrophysicist before use in any well or business decision."
)


def _esc(s: Any) -> str:
    return html.escape("" if s is None else str(s))


def _pdf_text(text: str) -> str:
    """Make text safe for fpdf2 core fonts (Latin-1 / Helvetica).

    AI narratives often contain en-dashes, smart quotes, and other Unicode
    punctuation that triggers ``FPDFUnicodeEncodingException``.
    """
    if not text:
        return ""
    repl = {
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2026": "...",
        "\u00a0": " ",
        "\u03c6": "phi",
        "\u03a9": "Ohm",
        "\u2126": "Ohm",
    }
    out = unicodedata.normalize("NFKC", str(text))
    for src, dst in repl.items():
        out = out.replace(src, dst)
    out = out.encode("latin-1", errors="replace").decode("latin-1")
    # fpdf line-breaker fails on very long unbroken tokens (URLs, mnemonics).
    out = re.sub(
        r"(\S{72,})",
        lambda m: " ".join(m.group(1)[i : i + 48] for i in range(0, len(m.group(1)), 48)),
        out,
    )
    return out


def _zone_ai_text(ai: dict | None, zone_index: int) -> str:
    if not isinstance(ai, dict):
        return ""
    for entry in ai.get("zone_interpretations") or []:
        try:
            idx = int(entry.get("zone_index", -1))
        except (TypeError, ValueError):
            continue
        if idx == zone_index:
            parts = [
                entry.get("interpretation") or "",
                entry.get("producibility_assessment") or "",
            ]
            concerns = entry.get("concerns") or []
            if concerns:
                parts.append("Concerns: " + "; ".join(concerns))
            return "\n".join(p for p in parts if p)
    return ""


def build_report_html(
    well: Any,
    zones: list[Any],
    ai_interpretation: dict | None,
) -> str:
    """Return a self-contained HTML document for preview or print."""
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    ai = ai_interpretation if isinstance(ai_interpretation, dict) else {}

    zone_cards: list[str] = []
    for i, z in enumerate(zones):
        tone = "#c9a227" if z.zone_type == "OIL" else "#e85d75"
        ai_text = _zone_ai_text(ai, i) or (z.ai_note or "") or (z.ai_rationale or "")
        zone_cards.append(
            f"""
            <article class="zone" style="border-left:4px solid {tone}">
              <header>
                <span class="badge" style="background:{tone}22;color:{tone}">{_esc(z.zone_type)}</span>
                <h3>Zone {i + 1} · {z.top_ft:.0f} – {z.bot_ft:.0f} ft</h3>
                <p class="meta">{z.thick_ft:.1f} ft · {_esc(z.lith_flag)} lith</p>
              </header>
              <div class="metrics">
                <div><label>Shc</label><strong>{z.shc_pct:.1f}%</strong></div>
                <div><label>Sw</label><strong>{z.sw_pct:.1f}%</strong></div>
                <div><label>ϕ eff</label><strong>{z.phi_pct:.1f}%</strong></div>
                <div><label>Vsh</label><strong>{z.vsh_pct:.1f}%</strong></div>
                <div><label>Rt</label><strong>{z.rt_mean:.1f} Ω·m</strong></div>
                <div><label>GR</label><strong>{z.gr_mean:.0f} GAPI</strong></div>
                <div><label>PEF</label><strong>{z.pef_mean:.2f}</strong></div>
                <div><label>Producible</label><strong>{z.producible_pct:.0f}%</strong></div>
              </div>
              {"<section class='ai'><h4>Interpretation</h4><p>" + _esc(ai_text).replace(chr(10), "<br/>") + "</p></section>" if ai_text else ""}
            </article>
            """
        )

    well_narrative = ai.get("well_narrative") or ""
    reservoir = ai.get("reservoir_context") or ""
    lith = ai.get("lithology_summary") or ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>{_esc(well.well_name)} — PETROLOGIC AI Report</title>
  <style>
    :root {{
      --bg: #0d1117; --panel: #161b22; --text: #e6edf3; --muted: #8b949e;
      --accent: #117e9a; --border: #30363d;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; padding: 2rem; font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg); color: var(--text); line-height: 1.55;
    }}
    .wrap {{ max-width: 920px; margin: 0 auto; }}
    h1 {{ font-size: 1.75rem; letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 0.25rem; }}
    .sub {{ color: var(--muted); font-size: 0.9rem; margin-bottom: 2rem; }}
    .hero {{
      background: linear-gradient(135deg, #161b22 0%, #1c2836 100%);
      border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem 1.75rem;
      margin-bottom: 2rem;
    }}
    .chips {{ display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }}
    .chip {{
      font-size: 0.75rem; padding: 0.25rem 0.65rem; border-radius: 999px;
      background: #21262d; border: 1px solid var(--border); color: var(--muted);
    }}
    .chip strong {{ color: var(--text); margin-left: 0.35rem; }}
    section.block {{
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem;
    }}
    section.block h2 {{
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em;
      color: var(--accent); margin: 0 0 0.75rem;
    }}
    .zone {{
      background: #0d1117; border: 1px solid var(--border); border-radius: 10px;
      padding: 1rem 1.25rem; margin-bottom: 1rem;
    }}
    .zone header h3 {{ margin: 0.35rem 0 0; font-size: 1.05rem; }}
    .zone .meta {{ margin: 0; color: var(--muted); font-size: 0.85rem; }}
    .badge {{
      display: inline-block; font-size: 0.65rem; font-weight: 700;
      letter-spacing: 0.08em; padding: 0.2rem 0.5rem; border-radius: 4px;
    }}
    .metrics {{
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem;
      margin: 1rem 0 0;
    }}
    .metrics label {{ display: block; font-size: 0.65rem; text-transform: uppercase;
      color: var(--muted); letter-spacing: 0.06em; }}
    .metrics strong {{ font-size: 1rem; }}
    .zone .ai {{ margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border); }}
    .zone .ai h4 {{ margin: 0 0 0.35rem; font-size: 0.7rem; text-transform: uppercase;
      color: var(--muted); }}
    .disclaimer {{
      font-size: 0.75rem; color: var(--muted); border-top: 1px solid var(--border);
      padding-top: 1.25rem; margin-top: 2rem;
    }}
    @media print {{
      body {{ background: #fff; color: #111; padding: 1rem; }}
      .hero, section.block, .zone {{ background: #f8f9fa; border-color: #ccc; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>{_esc(well.well_name)}</h1>
      <p class="sub">PETROLOGIC AI · Pay-zone report · Generated {generated}</p>
      <div class="chips">
        {"<span class='chip'>API<strong>" + _esc(well.api_number) + "</strong></span>" if well.api_number else ""}
        {"<span class='chip'>Operator<strong>" + _esc(well.operator) + "</strong></span>" if well.operator else ""}
        {"<span class='chip'>Field<strong>" + _esc(well.field) + "</strong></span>" if well.field else ""}
        <span class="chip">Depth<strong>{well.depth_start:.0f}–{well.depth_stop:.0f} ft</strong></span>
        <span class="chip">Zones<strong>{len(zones)}</strong></span>
      </div>
    </div>

    {"<section class='block'><h2>Well narrative</h2><p>" + _esc(well_narrative) + "</p></section>" if well_narrative else ""}
    {"<section class='block'><h2>Reservoir context</h2><p>" + _esc(reservoir) + "</p></section>" if reservoir else ""}
    {"<section class='block'><h2>Lithology</h2><p>" + _esc(lith) + "</p></section>" if lith else ""}

    <section class="block">
      <h2>Hydrocarbon pay zones ({len(zones)})</h2>
      {"".join(zone_cards) if zone_cards else "<p>No pay zones in this analysis.</p>"}
    </section>

    <p class="disclaimer">{_esc(ai.get("disclaimer") or DISCLAIMER)}</p>
  </div>
</body>
</html>"""


def build_report_pdf(
    well: Any,
    zones: list[Any],
    ai_interpretation: dict | None,
) -> bytes:
    """PDF bytes via fpdf2 (lightweight server-side generation)."""
    from fpdf import FPDF
    from fpdf.enums import XPos, YPos

    ai = ai_interpretation if isinstance(ai_interpretation, dict) else {}
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    w_full = pdf.epw

    def para(
        text: str,
        *,
        h: float = 5,
        style: str = "",
        size: int = 9,
        color: tuple[int, int, int] | None = None,
    ) -> None:
        pdf.set_x(pdf.l_margin)
        pdf.set_font("Helvetica", style, size)
        if color is not None:
            pdf.set_text_color(*color)
        pdf.multi_cell(
            w_full,
            h,
            _pdf_text(text),
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )

    def heading(text: str, *, size: int = 10, color: tuple[int, int, int] | None = None) -> None:
        para(text, h=7, style="B", size=size, color=color)

    heading(_pdf_text(well.well_name or "Well Report"), size=16)
    para(
        f"PETROLOGIC AI - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        h=6,
        size=9,
        color=(100, 100, 100),
    )
    pdf.set_text_color(0, 0, 0)
    pdf.ln(2)

    chips = []
    if well.api_number:
        chips.append(f"API {_pdf_text(well.api_number)}")
    if well.operator:
        chips.append(f"Op: {_pdf_text(well.operator)}")
    chips.append(f"Depth {well.depth_start:.0f}-{well.depth_stop:.0f} ft")
    para(" | ".join(chips), h=5, size=8)
    pdf.ln(2)

    def section(title: str, body: str) -> None:
        if not body.strip():
            return
        heading(title.upper(), size=10, color=(17, 126, 154))
        pdf.set_text_color(0, 0, 0)
        para(body, h=5, size=9)
        pdf.ln(1)

    section("Well narrative", ai.get("well_narrative") or "")
    section("Reservoir context", ai.get("reservoir_context") or "")
    section("Lithology", ai.get("lithology_summary") or "")

    heading(f"Hydrocarbon pay zones ({len(zones)})", size=11)

    for i, z in enumerate(zones):
        heading(
            f"Zone {i + 1} - {z.zone_type} - {z.top_ft:.0f}-{z.bot_ft:.0f} ft ({z.thick_ft:.1f} ft)",
            size=10,
        )
        metrics = (
            f"Shc {z.shc_pct:.1f}% | Sw {z.sw_pct:.1f}% | phi {z.phi_pct:.1f}% | "
            f"Vsh {z.vsh_pct:.1f}% | Rt {z.rt_mean:.1f} | GR {z.gr_mean:.0f} | "
            f"Producible {z.producible_pct:.0f}% | {_pdf_text(z.lith_flag)}"
        )
        para(metrics, h=4, size=8)
        ai_text = _zone_ai_text(ai, i) or (z.ai_note or "") or (z.ai_rationale or "")
        if ai_text:
            para(ai_text[:1200], h=4, size=8, style="I")
        pdf.ln(2)

    pdf.ln(2)
    pdf.set_text_color(120, 120, 120)
    para(ai.get("disclaimer") or DISCLAIMER, h=4, size=7, style="I")

    out = io.BytesIO()
    pdf.output(out)
    return out.getvalue()
