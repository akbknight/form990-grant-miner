"""
irs_db/exporter.py
==================
Export data FROM the PostgreSQL database to CSV or Excel.

Usage:
    # Export ALL Jewish grants to Excel (fits in one file, ~270k rows)
    .venv312\\Scripts\\python.exe -m irs_db.exporter --jewish-excel

    # Export any filtered subset to CSV
    .venv312\\Scripts\\python.exe -m irs_db.exporter --csv --filter "tax_year=2023"
    .venv312\\Scripts\\python.exe -m irs_db.exporter --csv --filter "expense_type='Jews'"
    .venv312\\Scripts\\python.exe -m irs_db.exporter --csv --filter "grantmaker_state='NY'"

    # Export full dataset to CSV (all 9.7M rows, ~1.4 GB)
    .venv312\\Scripts\\python.exe -m irs_db.exporter --csv --all

    # Export filing summary (one row per org, with grant totals)
    .venv312\\Scripts\\python.exe -m irs_db.exporter --summary-csv

    # Create Power BI views in the DB
    .venv312\\Scripts\\python.exe -m irs_db.exporter --powerbi-views
"""

import sys
import time
import logging
import argparse
from pathlib import Path
from typing import Optional

try:
    import psycopg2
    import pandas as pd
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
except ImportError:
    print("Missing packages. Run:  pip install psycopg2-binary pandas openpyxl")
    sys.exit(1)

from irs_db import loader, config

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])

OUT_DIR = config.BASE_DIR

# ── CSV export via PostgreSQL COPY (fastest possible) ─────────────────────────

def export_csv(
    output_path: str,
    where_clause: str = "",
    table_or_view: str = "irs_grants",
):
    """
    Export a table or view to CSV using PostgreSQL COPY TO STDOUT.
    This streams data directly from Postgres without loading into Python memory.
    Much faster than pandas for large tables.
    """
    conn = loader.get_conn()
    t0   = time.time()
    out  = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    where = f"WHERE {where_clause}" if where_clause else ""
    sql   = f"COPY (SELECT * FROM {table_or_view} {where} ORDER BY id) TO STDOUT WITH CSV HEADER"

    log.info("Exporting: %s", out.name)
    log.info("Query    : %s", sql[:120])

    with conn.cursor() as cur, open(out, "w", encoding="utf-8-sig", newline="") as f:
        cur.copy_expert(sql, f)

    size_mb = out.stat().st_size / 1024 / 1024
    elapsed = time.time() - t0
    log.info("Saved: %s  (%.0f MB, %.0fs)", out, size_mb, elapsed)
    conn.close()


def export_all_csv():
    export_csv(
        str(OUT_DIR / "export_all_grants.csv"),
        table_or_view="v_grants_powerbi",
    )


def export_jewish_csv():
    export_csv(
        str(OUT_DIR / "export_jewish_grants.csv"),
        where_clause="expense_type = 'Jews'",
        table_or_view="irs_grants",
    )


def export_summary_csv():
    export_csv(
        str(OUT_DIR / "export_filing_summary.csv"),
        table_or_view="v_filing_summary",
    )


def export_filtered_csv(filter_expr: str):
    safe = filter_expr.replace("/", "_").replace(" ", "_")[:40]
    out  = str(OUT_DIR / f"export_filtered_{safe}.csv")
    export_csv(out, where_clause=filter_expr)


# ── Excel export (for Jewish grants — fits in Excel) ──────────────────────────

_HDR_FILL   = PatternFill("solid", fgColor="1F4E79")
_JEWISH_FILL = PatternFill("solid", fgColor="FFF2CC")
_ALT_FILL    = PatternFill("solid", fgColor="FFF9E6")
_COLS = [
    "ein", "tax_year", "grantmaker_name", "grantmaker_state",
    "recipient_name", "recipient_city", "recipient_state_country",
    "geography", "primary_subject", "support_strategy",
    "grant_amount", "description", "expense_type",
]
_WIDTHS = [11, 10, 35, 14, 35, 18, 22, 18, 20, 28, 14, 55, 16]


def export_jewish_excel(output_path: Optional[str] = None):
    """Load all Jewish grants into memory and write to a styled Excel file."""
    out = Path(output_path or (OUT_DIR / "Jewish_Grants_Master_DB.xlsx"))
    conn = loader.get_conn()

    log.info("Loading Jewish grants from database...")
    t0 = time.time()

    query = f"""
        SELECT {', '.join(_COLS)}
        FROM irs_grants
        WHERE expense_type = 'Jews'
        ORDER BY tax_year, grantmaker_name, grant_amount DESC
    """
    df = pd.read_sql(query, conn)
    conn.close()

    log.info("Loaded %d rows in %.0fs. Writing Excel...", len(df), time.time() - t0)
    t1 = time.time()

    wb = Workbook()
    ws = wb.active
    ws.title = "Jewish_Grants"
    ws.freeze_panes = "A2"

    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for i, col in enumerate(_COLS, 1):
        ws.column_dimensions[get_column_letter(i)].width = _WIDTHS[i - 1]
        c = ws.cell(row=1, column=i, value=col.replace("_", " ").title())
        c.fill = _HDR_FILL
        c.font = Font(bold=True, color="FFFFFF", size=11)
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = border
    ws.row_dimensions[1].height = 22

    for r_idx, row in enumerate(df.itertuples(index=False), 2):
        fill = _JEWISH_FILL if r_idx % 2 == 0 else _ALT_FILL
        for c_idx, val in enumerate(row, 1):
            c = ws.cell(row=r_idx, column=c_idx, value=val)
            c.fill = fill
            c.font = Font(size=10)
            c.alignment = Alignment(vertical="top")
            c.border = border

    ws.auto_filter.ref = ws.dimensions
    wb.save(str(out))

    size_mb = out.stat().st_size / 1024 / 1024
    log.info("Saved: %s  (%.0f MB, %.0fs)", out.name, size_mb, time.time() - t1)


# ── Power BI view creation ─────────────────────────────────────────────────────

def create_powerbi_views():
    """
    Ensure the Power BI-friendly views exist in the database.
    These are already in schema.sql but this re-runs them if needed.
    """
    conn = loader.get_conn()
    views_sql = """
    CREATE OR REPLACE VIEW v_grants_powerbi AS
    SELECT
        g.id, g.ein,
        COALESCE(f.org_name, g.grantmaker_name)  AS grantmaker_name,
        g.grantmaker_state, g.tax_year,
        g.recipient_name, g.recipient_city, g.recipient_state_country,
        g.geography, g.primary_subject, g.support_strategy,
        g.grant_amount, g.expense_type, g.description,
        f.form_type, f.total_revenue, f.total_expenses,
        f.total_assets_eoy, f.net_assets_eoy, f.employee_count,
        f.org_city, f.org_zip
    FROM  irs_grants  g
    LEFT JOIN irs_filings f ON f.ein = g.ein AND f.tax_year = g.tax_year;

    CREATE OR REPLACE VIEW v_filing_summary AS
    SELECT
        f.id, f.ein, f.tax_year, f.form_type, f.org_name, f.org_state, f.org_city,
        f.total_revenue, f.total_expenses, f.total_assets_eoy, f.net_assets_eoy,
        f.employee_count,
        COUNT(g.id)                                                    AS total_grants,
        SUM(g.grant_amount)                                            AS total_grant_dollars,
        COUNT(g.id)        FILTER (WHERE g.expense_type = 'Jews')      AS jewish_grant_count,
        SUM(g.grant_amount) FILTER (WHERE g.expense_type = 'Jews')     AS jewish_grant_dollars,
        COUNT(g.id)        FILTER (WHERE g.expense_type = 'Non jews')  AS non_jewish_grant_count,
        SUM(g.grant_amount) FILTER (WHERE g.expense_type = 'Non jews') AS non_jewish_grant_dollars
    FROM  irs_filings f
    LEFT JOIN irs_grants g ON g.ein = f.ein AND g.tax_year = f.tax_year
    GROUP BY f.id;

    CREATE OR REPLACE VIEW v_stats AS
    SELECT tax_year, expense_type,
           COUNT(*)          AS grant_count,
           SUM(grant_amount) AS total_dollars,
           AVG(grant_amount) AS avg_grant,
           MAX(grant_amount) AS max_grant
    FROM irs_grants
    GROUP BY tax_year, expense_type
    ORDER BY tax_year, expense_type;
    """
    with conn.cursor() as cur:
        cur.execute(views_sql)
    conn.commit()
    conn.close()
    log.info("Power BI views created: v_grants_powerbi, v_filing_summary, v_stats")
    log.info("Connect Power BI: Data -> Get Data -> PostgreSQL -> host/database -> select view")


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Export IRS data from PostgreSQL")
    parser.add_argument("--jewish-excel",   action="store_true", help="Export Jewish grants to Excel")
    parser.add_argument("--jewish-csv",     action="store_true", help="Export Jewish grants to CSV")
    parser.add_argument("--all",            action="store_true", help="Export all grants to CSV (large)")
    parser.add_argument("--summary-csv",    action="store_true", help="Export filing summary to CSV")
    parser.add_argument("--csv",            action="store_true", help="Export filtered CSV (use with --filter)")
    parser.add_argument("--filter",         type=str, default="",
                        help="SQL WHERE clause for --csv (e.g. \"tax_year=2023\")")
    parser.add_argument("--powerbi-views",  action="store_true", help="Create Power BI views in DB")
    parser.add_argument("--output",         type=str, help="Custom output file path")
    args = parser.parse_args()

    if args.jewish_excel:
        export_jewish_excel(args.output)
    elif args.jewish_csv:
        export_jewish_csv()
    elif args.all:
        export_all_csv()
    elif args.summary_csv:
        export_summary_csv()
    elif args.csv:
        if not args.filter:
            log.error("--csv requires --filter. Example: --filter \"expense_type='Jews'\"")
            sys.exit(1)
        export_filtered_csv(args.filter)
    elif args.powerbi_views:
        create_powerbi_views()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
