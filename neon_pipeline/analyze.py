"""
analyze.py  —  Phase 4: Data Story & Visualization
====================================================
Queries clean data from Neon Postgres and generates a comprehensive
fund-flow analysis for 2019-2025.

Outputs (saved to ./output/ folder):
  1. annual_grant_flow.png       — total grants & dollars by year
  2. category_breakdown.png      — Jews / Non-Jews / Misc distribution
  3. subject_heatmap.png         — subject area × year heatmap (normalized)
  4. top_grantmakers.png         — top 20 grantmakers by total disbursed
  5. grant_size_distribution.png — log-scale distribution of grant sizes
  6. data_story_report.txt       — narrative summary (credit-risk style)

Run:
    python analyze.py
    python analyze.py --year 2023 2024     # subset of years
    python analyze.py --category Jews      # filter one category
"""

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import Optional, List

import pandas as pd
import matplotlib
matplotlib.use("Agg")   # headless — no display required
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns
import psycopg2

import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# Consistent color palette
PALETTE = {
    "Jews":          "#1f77b4",
    "Non-Jews":      "#ff7f0e",
    "Miscellaneous": "#7f7f7f",
    "Uncategorized": "#d62728",
}


def get_conn():
    from stream_pipeline import get_db_conn
    return get_db_conn()


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — Data loading
# ═══════════════════════════════════════════════════════════════════════════════

def load_data(conn, years: Optional[List[int]] = None,
              category: Optional[str] = None) -> pd.DataFrame:
    """
    Load grant data from Neon Postgres into a pandas DataFrame.
    Applies optional year and category filters.
    """
    where_clauses = ["amount IS NOT NULL", "amount > 0"]
    params = []

    if years:
        where_clauses.append(f"tax_year IN ({','.join(['%s']*len(years))})")
        params.extend(years)
    if category:
        where_clauses.append("expense_type = %s")
        params.append(category)

    where = " AND ".join(where_clauses)

    sql = f"""
        SELECT
            tax_year,
            expense_type,
            subject,
            grantmaker,
            grantmaker_state,
            recipient,
            state       AS recipient_state,
            amount
        FROM irs_grants
        WHERE {where}
        ORDER BY tax_year, expense_type
    """

    log.info("Loading data from Neon Postgres...")
    df = pd.read_sql(sql, conn, params=params if params else None)
    log.info("  Loaded {:,} rows".format(len(df)))
    return df


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Chart generators
# ═══════════════════════════════════════════════════════════════════════════════

def plot_annual_flow(df: pd.DataFrame):
    """Bar chart: total grant dollars disbursed per year, stacked by category."""
    pivot = (
        df.groupby(["tax_year", "expense_type"])["amount"]
          .sum()
          .unstack(fill_value=0)
    )
    pivot = pivot / 1e9   # convert to billions

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Left: total dollars by year
    ax1 = axes[0]
    pivot.plot(kind="bar", stacked=True, ax=ax1,
               color=[PALETTE.get(c, "#aec7e8") for c in pivot.columns])
    ax1.set_title("Annual Grant Disbursements by Category (2019–2025)",
                  fontsize=13, fontweight="bold")
    ax1.set_xlabel("Tax Year")
    ax1.set_ylabel("Total Grants ($ Billions)")
    ax1.yaxis.set_major_formatter(mticker.FormatStrFormatter("$%.1fB"))
    ax1.tick_params(axis="x", rotation=0)
    ax1.legend(title="Category", loc="upper left")

    # Right: grant count by year
    ax2 = axes[1]
    count_pivot = (
        df.groupby(["tax_year", "expense_type"])
          .size()
          .unstack(fill_value=0)
    )
    count_pivot.plot(kind="bar", stacked=True, ax=ax2,
                     color=[PALETTE.get(c, "#aec7e8") for c in count_pivot.columns])
    ax2.set_title("Annual Grant Count by Category", fontsize=13, fontweight="bold")
    ax2.set_xlabel("Tax Year")
    ax2.set_ylabel("Number of Grants")
    ax2.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x/1e3:.0f}K"))
    ax2.tick_params(axis="x", rotation=0)
    ax2.legend(title="Category", loc="upper left")

    plt.tight_layout()
    out = OUTPUT_DIR / "annual_grant_flow.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("Saved: %s", out)


def plot_category_breakdown(df: pd.DataFrame):
    """Pie + bar showing overall category split."""
    cat_totals = df.groupby("expense_type")["amount"].sum().sort_values(ascending=False)

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Pie: share of total dollars
    colors = [PALETTE.get(c, "#aec7e8") for c in cat_totals.index]
    axes[0].pie(
        cat_totals.values,
        labels=cat_totals.index,
        autopct="%1.1f%%",
        colors=colors,
        startangle=90,
    )
    axes[0].set_title("Share of Total Grant Dollars by Category",
                      fontsize=13, fontweight="bold")

    # Bar: average grant size by category
    avg = df.groupby("expense_type")["amount"].mean().sort_values(ascending=False)
    axes[1].bar(avg.index, avg.values / 1000,
                color=[PALETTE.get(c, "#aec7e8") for c in avg.index])
    axes[1].set_title("Average Grant Size by Category", fontsize=13, fontweight="bold")
    axes[1].set_ylabel("Average Grant ($K)")
    axes[1].yaxis.set_major_formatter(mticker.FormatStrFormatter("$%.0fK"))

    plt.tight_layout()
    out = OUTPUT_DIR / "category_breakdown.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("Saved: %s", out)


def plot_subject_heatmap(df: pd.DataFrame):
    """Heatmap: grant dollars by subject area × tax year (row-normalized)."""
    df_s = df[df["subject"].notna()].copy()
    if df_s.empty:
        log.warning("No subject data — skipping heatmap")
        return

    pivot = (
        df_s.groupby(["subject", "tax_year"])["amount"]
            .sum()
            .unstack(fill_value=0)
    )
    # Row-normalize so each subject shows trend, not raw scale
    pivot_norm = pivot.div(pivot.sum(axis=1), axis=0) * 100

    fig, ax = plt.subplots(figsize=(12, 7))
    sns.heatmap(
        pivot_norm,
        ax=ax,
        cmap="YlOrRd",
        fmt=".0f",
        annot=True,
        linewidths=0.5,
        cbar_kws={"label": "% of subject's total grants"},
    )
    ax.set_title("Grant Flow by Subject Area × Year (row-normalized %)",
                 fontsize=13, fontweight="bold")
    ax.set_xlabel("Tax Year")
    ax.set_ylabel("Subject Area")

    plt.tight_layout()
    out = OUTPUT_DIR / "subject_heatmap.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("Saved: %s", out)


def plot_top_grantmakers(df: pd.DataFrame):
    """Horizontal bar: top 20 grantmakers by total dollars disbursed."""
    top = (
        df.groupby("grantmaker")["amount"]
          .sum()
          .sort_values(ascending=False)
          .head(20)
          .iloc[::-1]   # reverse for horizontal bar readability
    ) / 1e6

    fig, ax = plt.subplots(figsize=(12, 8))
    bars = ax.barh(top.index, top.values, color="#1f77b4", edgecolor="white")

    for bar, val in zip(bars, top.values):
        ax.text(bar.get_width() + 0.5, bar.get_y() + bar.get_height() / 2,
                f"${val:.0f}M", va="center", fontsize=9)

    ax.set_title("Top 20 Grantmakers by Total Disbursement (2019–2025)",
                 fontsize=13, fontweight="bold")
    ax.set_xlabel("Total Grants Disbursed ($M)")
    ax.xaxis.set_major_formatter(mticker.FormatStrFormatter("$%.0fM"))
    ax.set_xlim(right=top.values.max() * 1.15)

    plt.tight_layout()
    out = OUTPUT_DIR / "top_grantmakers.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("Saved: %s", out)


def plot_grant_size_distribution(df: pd.DataFrame):
    """Log-scale histogram of individual grant sizes by category."""
    import numpy as np

    fig, ax = plt.subplots(figsize=(12, 6))
    for cat, grp in df.groupby("expense_type"):
        vals = grp["amount"].dropna()
        vals = vals[vals > 0]
        if len(vals) < 10:
            continue
        ax.hist(
            np.log10(vals),
            bins=60,
            alpha=0.5,
            label=cat,
            color=PALETTE.get(cat, "#aec7e8"),
        )

    ax.set_title("Grant Size Distribution (log₁₀ scale) by Category",
                 fontsize=13, fontweight="bold")
    ax.set_xlabel("Grant Amount (log₁₀ dollars)")
    ax.set_ylabel("Number of Grants")
    ax.xaxis.set_major_formatter(
        mticker.FuncFormatter(lambda x, _: f"${'10K' if x==4 else '100K' if x==5 else '1M' if x==6 else '10M' if x==7 else str(int(10**x))}")
    )
    ax.legend(title="Category")

    plt.tight_layout()
    out = OUTPUT_DIR / "grant_size_distribution.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    log.info("Saved: %s", out)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — Narrative data story (credit-risk style)
# ═══════════════════════════════════════════════════════════════════════════════

def write_data_story(df: pd.DataFrame):
    """
    Generate a structured narrative summary, modelled on credit-risk
    reporting conventions: executive summary → trend analysis →
    concentration risk → anomaly flags → recommendations.
    """
    total_grants  = len(df)
    total_dollars = df["amount"].sum()
    years_covered = sorted(df["tax_year"].dropna().unique())
    cat_counts    = df.groupby("expense_type").size()
    cat_dollars   = df.groupby("expense_type")["amount"].sum()

    yoy = (
        df.groupby("tax_year")["amount"].sum()
          .pct_change()
          .dropna()
          .mul(100)
    )

    top_grantmaker = (
        df.groupby("grantmaker")["amount"]
          .sum()
          .sort_values(ascending=False)
          .head(1)
    )
    top_5_share = (
        df.groupby("grantmaker")["amount"]
          .sum()
          .sort_values(ascending=False)
          .head(5)
          .sum() / total_dollars * 100
    )

    jewish_df   = df[df["expense_type"] == "Jews"]
    jewish_pct  = len(jewish_df) / total_grants * 100 if total_grants else 0
    jewish_usd  = jewish_df["amount"].sum()
    jewish_usd_pct = jewish_usd / total_dollars * 100 if total_dollars else 0

    story = f"""
IRS FORM 990 GRANT DATA — ANALYTICAL REPORT
============================================
Period Covered   : {min(years_covered)} – {max(years_covered)}
Report Generated : by analyze.py (neon_pipeline)
Data Source      : IRS S3 Public Bucket (irs-form-990)

═══════════════════════════════════════════
I. EXECUTIVE SUMMARY
═══════════════════════════════════════════
Total grant disbursements analysed : {total_grants:>12,} grants
Total capital deployed              : ${total_dollars:>12,.0f}
Average grant size                  : ${total_dollars/total_grants:>12,.0f}
Years in scope                      : {', '.join(map(str, years_covered))}

═══════════════════════════════════════════
II. CATEGORY DISTRIBUTION  (exposure by book)
═══════════════════════════════════════════
{"Category":<22} {"Grant Count":>14} {"Total USD":>16} {"Avg Grant":>12}
{"-"*66}"""

    for cat in cat_counts.index:
        n   = cat_counts.get(cat, 0)
        usd = cat_dollars.get(cat, 0)
        avg = usd / n if n else 0
        story += f"\n{cat:<22} {n:>14,} ${usd:>14,.0f} ${avg:>10,.0f}"

    story += f"""

═══════════════════════════════════════════
III. JEWISH GRANT SEGMENT — DEEP DIVE
═══════════════════════════════════════════
Grant count         : {len(jewish_df):,}  ({jewish_pct:.1f}% of total)
Total dollars       : ${jewish_usd:,.0f}  ({jewish_usd_pct:.1f}% of total capital)
Average grant size  : ${jewish_usd/len(jewish_df):,.0f}  (vs. ${total_dollars/total_grants:,.0f} overall avg)

Year-over-year trend (Jewish grants):"""

    jewish_yoy = (
        jewish_df.groupby("tax_year")["amount"]
                 .sum()
                 .pct_change()
                 .dropna()
                 .mul(100)
    )
    for yr, pct in jewish_yoy.items():
        arrow = "▲" if pct > 0 else "▼"
        story += f"\n  {int(yr)}: {arrow} {abs(pct):.1f}%"

    story += f"""

═══════════════════════════════════════════
IV. TREND ANALYSIS  (year-over-year, all grants)
═══════════════════════════════════════════"""
    for yr, pct in yoy.items():
        arrow = "▲" if pct > 0 else "▼"
        story += f"\n  {int(yr)}: {arrow} {abs(pct):.1f}% YoY"

    story += f"""

═══════════════════════════════════════════
V. CONCENTRATION RISK
═══════════════════════════════════════════
Top grantmaker      : {top_grantmaker.index[0]}  (${top_grantmaker.iloc[0]:,.0f})
Top 5 share of total: {top_5_share:.1f}%

Concentration risk is {"HIGH" if top_5_share > 30 else "MODERATE" if top_5_share > 15 else "LOW"}.
{"⚠ Top 5 grantmakers account for over 30% of total capital — sector is highly concentrated." if top_5_share > 30 else ""}

═══════════════════════════════════════════
VI. ANOMALY FLAGS
═══════════════════════════════════════════"""

    # Flag unusually large grants (> 99th percentile)
    p99 = df["amount"].quantile(0.99)
    large = df[df["amount"] > p99]
    story += f"\n  Grants above 99th percentile (>${p99:,.0f}): {len(large):,}"
    story += f"\n  These {len(large):,} grants represent ${large['amount'].sum():,.0f} ({large['amount'].sum()/total_dollars*100:.1f}% of total capital)"

    story += f"""

═══════════════════════════════════════════
VII. RECOMMENDATIONS
═══════════════════════════════════════════
1. Segment review: The Jewish grant segment shows distinct avg grant sizes.
   Recommend separate trend monitoring against overall baseline.

2. Concentration monitoring: Grantmaker HHI should be computed quarterly.
   If top-5 share exceeds 40%, flag for portfolio review.

3. Subject-area gaps: Review subject_heatmap.png for years with <5% share
   in any subject — may indicate reporting gaps or classification issues.

4. Data quality: Grants with NULL description ({df['description'].isna().sum():,} rows, {df['description'].isna().sum()/total_grants*100:.1f}%)
   cannot be reclassified. Recommend outreach to grantmaker EINs for verification.
"""

    out = OUTPUT_DIR / "data_story_report.txt"
    out.write_text(story)
    log.info("Saved: %s", out)
    print(story)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — Main
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Phase 4: Generate data story and charts from Neon Postgres"
    )
    parser.add_argument("--year",     type=int, nargs="+", default=None)
    parser.add_argument("--category", type=str, default=None,
                        choices=["Jews", "Non-Jews", "Miscellaneous", "Uncategorized"])
    args = parser.parse_args()

    conn = get_conn()
    df   = load_data(conn, years=args.year, category=args.category)
    conn.close()

    if df.empty:
        log.error("No data returned — run stream_pipeline.py and categorize.py first.")
        sys.exit(1)

    log.info("Generating charts and narrative...")
    plot_annual_flow(df)
    plot_category_breakdown(df)
    plot_subject_heatmap(df)
    plot_top_grantmakers(df)
    plot_grant_size_distribution(df)
    write_data_story(df)

    log.info("")
    log.info("All outputs saved to: %s", OUTPUT_DIR)


if __name__ == "__main__":
    main()
