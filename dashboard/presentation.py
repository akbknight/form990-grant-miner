"""Theme, formatting, and chart builders for the Streamlit dashboard."""

from __future__ import annotations

import html
from typing import Iterable

import plotly.express as px
import plotly.graph_objects as go


PALETTE = {
    "Jews": "#b74d24",
    "Non jews": "#1c6277",
    "Miscellaneous": "#8d7b68",
    "Uncategorized": "#d1a054",
}

PLOT_THEME = {
    "paper_bgcolor": "rgba(0, 0, 0, 0)",
    "plot_bgcolor": "rgba(0, 0, 0, 0)",
    "font_family": "Trebuchet MS, Verdana, sans-serif",
    "font_color": "#173042",
    "margin": {"t": 52, "r": 18, "b": 18, "l": 18},
}


def inject_theme(streamlit_module) -> None:
    """Inject the global dashboard theme into the Streamlit app."""
    streamlit_module.markdown(
        """
        <style>
            :root {
                --paper: #f4efe7;
                --paper-strong: #efe3d2;
                --ink: #173042;
                --ink-soft: #4f6670;
                --accent: #b74d24;
                --accent-soft: #dfb76b;
                --teal: #1c6277;
                --card: rgba(255, 255, 255, 0.75);
                --border: rgba(23, 48, 66, 0.10);
            }

            .stApp {
                background:
                    radial-gradient(circle at 12% 10%, rgba(223, 183, 107, 0.20), transparent 28%),
                    radial-gradient(circle at 88% 12%, rgba(28, 98, 119, 0.16), transparent 24%),
                    linear-gradient(180deg, #f7f2ea 0%, #f2ebdf 52%, #f4efe7 100%);
                color: var(--ink);
            }

            [data-testid="stSidebar"] {
                background: linear-gradient(180deg, rgba(23, 48, 66, 0.96), rgba(28, 98, 119, 0.92));
            }

            [data-testid="stSidebar"] * {
                color: #f7efe5 !important;
            }

            .block-container {
                padding-top: 1.4rem;
                padding-bottom: 2.2rem;
            }

            .dashboard-shell {
                background: linear-gradient(135deg, rgba(23, 48, 66, 0.95), rgba(28, 98, 119, 0.88));
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 28px;
                padding: 1.8rem 2rem;
                box-shadow: 0 30px 80px rgba(23, 48, 66, 0.16);
                color: #f7efe5;
                animation: rise-in 0.6s ease-out;
            }

            .dashboard-shell h1 {
                font-family: Georgia, "Book Antiqua", serif;
                font-size: 2.6rem;
                line-height: 1.05;
                margin: 0 0 0.45rem 0;
                letter-spacing: -0.03em;
            }

            .dashboard-shell p {
                margin: 0;
                max-width: 58rem;
                font-size: 1.02rem;
                color: rgba(247, 239, 229, 0.84);
            }

            .kpi-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 0.95rem;
                margin: 1.15rem 0 0.7rem;
            }

            .kpi-card {
                background: var(--card);
                backdrop-filter: blur(14px);
                border: 1px solid var(--border);
                border-radius: 22px;
                padding: 1rem 1rem 0.95rem;
                box-shadow: 0 16px 40px rgba(23, 48, 66, 0.08);
                animation: rise-in 0.7s ease-out;
            }

            .kpi-label {
                font-size: 0.78rem;
                text-transform: uppercase;
                letter-spacing: 0.12em;
                color: var(--ink-soft);
                margin-bottom: 0.35rem;
            }

            .kpi-value {
                font-family: Georgia, "Book Antiqua", serif;
                font-size: 1.85rem;
                line-height: 1.05;
                color: var(--ink);
                margin-bottom: 0.3rem;
            }

            .kpi-subtitle {
                font-size: 0.9rem;
                color: var(--ink-soft);
            }

            .section-note {
                background: rgba(255, 255, 255, 0.68);
                border: 1px solid var(--border);
                border-radius: 18px;
                padding: 0.9rem 1rem;
                color: var(--ink-soft);
            }

            @keyframes rise-in {
                from {
                    opacity: 0;
                    transform: translateY(12px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_hero(streamlit_module, source_label: str, profile: dict) -> None:
    """Render the dashboard masthead."""
    total_grants = compact_number(profile.get("total_grants", 0))
    total_dollars = format_currency(profile.get("total_dollars", 0))
    first_year = profile.get("first_year") or "N/A"
    last_year = profile.get("last_year") or "N/A"
    streamlit_module.markdown(
        f"""
        <section class="dashboard-shell">
            <div style="font-size:0.82rem; text-transform:uppercase; letter-spacing:0.18em; opacity:0.78; margin-bottom:0.55rem;">
                Form 990 Intelligence Layer
            </div>
            <h1>Grant Atlas 990</h1>
            <p>
                A read-only analytics cockpit for the extracted filing data. The dashboard sits on top of
                <strong>{html.escape(source_label)}</strong>, covering tax years <strong>{first_year}</strong> through
                <strong>{last_year}</strong>, with <strong>{total_grants}</strong> grant records and
                <strong>{total_dollars}</strong> in tracked disbursements.
            </p>
        </section>
        """,
        unsafe_allow_html=True,
    )


def render_metric_cards(streamlit_module, metrics: Iterable[dict[str, str]]) -> None:
    """Render custom KPI cards."""
    cards = []
    for metric in metrics:
        cards.append(
            """
            <article class="kpi-card">
                <div class="kpi-label">{label}</div>
                <div class="kpi-value">{value}</div>
                <div class="kpi-subtitle">{subtitle}</div>
            </article>
            """.format(
                label=html.escape(metric["label"]),
                value=html.escape(metric["value"]),
                subtitle=html.escape(metric["subtitle"]),
            )
        )

    streamlit_module.markdown(
        '<section class="kpi-grid">' + "".join(cards) + "</section>",
        unsafe_allow_html=True,
    )


def compact_number(value: float | int) -> str:
    """Render a large number in human scale."""
    amount = float(value or 0)
    abs_amount = abs(amount)
    if abs_amount >= 1_000_000_000:
        return f"{amount / 1_000_000_000:.1f}B"
    if abs_amount >= 1_000_000:
        return f"{amount / 1_000_000:.1f}M"
    if abs_amount >= 1_000:
        return f"{amount / 1_000:.1f}K"
    return f"{amount:,.0f}"


def format_currency(value: float | int) -> str:
    """Format currency with abbreviated units."""
    amount = float(value or 0)
    abs_amount = abs(amount)
    if abs_amount >= 1_000_000_000:
        return f"${amount / 1_000_000_000:.2f}B"
    if abs_amount >= 1_000_000:
        return f"${amount / 1_000_000:.2f}M"
    if abs_amount >= 1_000:
        return f"${amount / 1_000:.1f}K"
    return f"${amount:,.0f}"


def build_trend_chart(frame) -> go.Figure:
    """Build the annual dollars-by-category chart."""
    if frame.empty:
        return _empty_figure("No trend data for the current filter set.")

    chart = px.area(
        frame,
        x="tax_year",
        y="total_dollars",
        color="expense_type",
        line_group="expense_type",
        markers=True,
        color_discrete_map=PALETTE,
        title="Annual disbursement mix",
        labels={"tax_year": "Tax year", "total_dollars": "Total grant dollars", "expense_type": "Category"},
    )
    chart.update_traces(mode="lines+markers", line={"width": 3})
    chart.update_layout(**PLOT_THEME, legend_title_text="Category", hovermode="x unified")
    chart.update_yaxes(tickprefix="$", separatethousands=True, gridcolor="rgba(23, 48, 66, 0.10)")
    chart.update_xaxes(gridcolor="rgba(23, 48, 66, 0.06)")
    return chart


def build_category_chart(frame) -> go.Figure:
    """Build the category comparison chart."""
    if frame.empty:
        return _empty_figure("No category mix available.")

    ordered = frame.sort_values("total_dollars", ascending=True)
    chart = px.bar(
        ordered,
        x="total_dollars",
        y="expense_type",
        orientation="h",
        color="expense_type",
        color_discrete_map=PALETTE,
        text="grant_count",
        title="Category exposure by dollars",
        labels={"total_dollars": "Total grant dollars", "expense_type": ""},
    )
    chart.update_traces(texttemplate="%{text:,} grants", textposition="outside")
    chart.update_layout(**PLOT_THEME, showlegend=False)
    chart.update_xaxes(tickprefix="$", separatethousands=True, gridcolor="rgba(23, 48, 66, 0.10)")
    return chart


def build_subject_chart(frame) -> go.Figure:
    """Build the subject-area ranking chart."""
    if frame.empty:
        return _empty_figure("No subject data available.")

    ordered = frame.sort_values("total_dollars", ascending=True)
    chart = px.bar(
        ordered,
        x="total_dollars",
        y="primary_subject",
        orientation="h",
        color="grant_count",
        color_continuous_scale=["#e9dccb", "#dfb76b", "#b74d24"],
        title="Top subject areas",
        labels={"total_dollars": "Total grant dollars", "primary_subject": ""},
    )
    chart.update_layout(**PLOT_THEME, coloraxis_colorbar_title="Grant count")
    chart.update_xaxes(tickprefix="$", separatethousands=True, gridcolor="rgba(23, 48, 66, 0.10)")
    return chart


def build_state_chart(frame) -> go.Figure:
    """Build the state or country ranking chart."""
    if frame.empty:
        return _empty_figure("No geography data available.")

    ordered = frame.sort_values("total_dollars", ascending=False)
    chart = px.bar(
        ordered,
        x="geography_label",
        y="total_dollars",
        color="grant_count",
        color_continuous_scale=["#d7e7ec", "#6da4b3", "#1c6277"],
        title="Recipient geography concentration",
        labels={"geography_label": "Recipient state or country", "total_dollars": "Total grant dollars"},
    )
    chart.update_layout(**PLOT_THEME, coloraxis_colorbar_title="Grant count")
    chart.update_xaxes(tickangle=-35, gridcolor="rgba(23, 48, 66, 0.06)")
    chart.update_yaxes(tickprefix="$", separatethousands=True, gridcolor="rgba(23, 48, 66, 0.10)")
    return chart


def build_grantmaker_chart(frame) -> go.Figure:
    """Build the largest-grantmaker chart."""
    if frame.empty:
        return _empty_figure("No grantmaker data available.")

    ordered = frame.sort_values("total_dollars", ascending=True)
    chart = px.bar(
        ordered,
        x="total_dollars",
        y="grantmaker_name",
        orientation="h",
        color="grant_count",
        color_continuous_scale=["#e7d3c0", "#dfb76b", "#b74d24"],
        title="Largest grantmakers in the slice",
        labels={"grantmaker_name": "", "total_dollars": "Total grant dollars"},
    )
    chart.update_layout(**PLOT_THEME, coloraxis_colorbar_title="Grant count")
    chart.update_xaxes(tickprefix="$", separatethousands=True, gridcolor="rgba(23, 48, 66, 0.10)")
    return chart


def _empty_figure(message: str) -> go.Figure:
    chart = go.Figure()
    chart.add_annotation(
        text=message,
        x=0.5,
        y=0.5,
        xref="paper",
        yref="paper",
        showarrow=False,
        font={"family": PLOT_THEME["font_family"], "size": 16, "color": "#4f6670"},
    )
    chart.update_layout(**PLOT_THEME, xaxis={"visible": False}, yaxis={"visible": False})
    return chart
