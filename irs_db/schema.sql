-- =============================================================================
-- IRS Form 990 — PostgreSQL Schema
-- Run once:  psql -U postgres -d irs990 -f schema.sql
-- =============================================================================

-- Track which ZIP files have been processed (resume safety)
CREATE TABLE IF NOT EXISTS pipeline_state (
    id             SERIAL       PRIMARY KEY,
    zip_filename   TEXT         NOT NULL UNIQUE,
    zip_path       TEXT         NOT NULL,
    status         TEXT         NOT NULL DEFAULT 'pending', -- pending | processing | complete | error
    filings_loaded INTEGER      NOT NULL DEFAULT 0,
    grants_loaded  INTEGER      NOT NULL DEFAULT 0,
    started_at     TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ,
    error_msg      TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- irs_filings: one row per EIN per tax year (organization-level financials)
-- =============================================================================
CREATE TABLE IF NOT EXISTS irs_filings (
    id                    BIGSERIAL   PRIMARY KEY,
    ein                   CHAR(9)     NOT NULL,
    tax_year              SMALLINT    NOT NULL,
    form_type             VARCHAR(10) NOT NULL,   -- 990 | 990EZ | 990PF | 990T
    org_name              TEXT,
    org_name_clean        TEXT,                   -- lowercased, stripped punctuation
    org_state             CHAR(2),
    org_city              TEXT,
    org_zip               VARCHAR(10),
    org_country           CHAR(3),
    -- Financials (whole dollars, NULL if not present in filing)
    gross_receipts        BIGINT,
    total_revenue         BIGINT,
    total_expenses        BIGINT,
    total_assets_eoy      BIGINT,
    total_liabilities_eoy BIGINT,
    net_assets_eoy        BIGINT,
    -- People
    employee_count        INTEGER,
    volunteer_count       INTEGER,
    -- Metadata
    source_zip            TEXT,
    loaded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_filing UNIQUE (ein, tax_year)
);

CREATE INDEX IF NOT EXISTS idx_filings_ein       ON irs_filings (ein);
CREATE INDEX IF NOT EXISTS idx_filings_tax_year  ON irs_filings (tax_year);
CREATE INDEX IF NOT EXISTS idx_filings_form_type ON irs_filings (form_type);
CREATE INDEX IF NOT EXISTS idx_filings_org_state ON irs_filings (org_state);
CREATE INDEX IF NOT EXISTS idx_filings_revenue   ON irs_filings (total_revenue);

-- =============================================================================
-- irs_grants: one row per grant record (~9.7M rows)
-- =============================================================================
CREATE TABLE IF NOT EXISTS irs_grants (
    id                      BIGSERIAL   PRIMARY KEY,
    ein                     CHAR(9),
    tax_year                SMALLINT,
    grantmaker_name         TEXT,
    grantmaker_state        CHAR(2),
    recipient_name          TEXT,
    recipient_city          TEXT,
    recipient_state_country VARCHAR(60),
    geography               VARCHAR(60),
    primary_subject         VARCHAR(60),
    support_strategy        VARCHAR(80),
    grant_amount            BIGINT,
    description             TEXT,
    expense_type            VARCHAR(20) NOT NULL,  -- Jews | Non jews | Miscellaneous
    source_zip              TEXT        NOT NULL,
    source_xml              TEXT,
    loaded_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Build these AFTER bulk load for speed (see pipeline.py --build-indexes flag)
CREATE INDEX IF NOT EXISTS idx_grants_ein           ON irs_grants (ein);
CREATE INDEX IF NOT EXISTS idx_grants_tax_year      ON irs_grants (tax_year);
CREATE INDEX IF NOT EXISTS idx_grants_expense_type  ON irs_grants (expense_type);
CREATE INDEX IF NOT EXISTS idx_grants_grantmaker    ON irs_grants (grantmaker_name);
CREATE INDEX IF NOT EXISTS idx_grants_subject       ON irs_grants (primary_subject);
CREATE INDEX IF NOT EXISTS idx_grants_source_zip    ON irs_grants (source_zip);
CREATE INDEX IF NOT EXISTS idx_grants_amount        ON irs_grants (grant_amount);

-- Partial index: fastest path for Jewish grant queries
CREATE INDEX IF NOT EXISTS idx_grants_jewish
    ON irs_grants (grantmaker_name, tax_year, grant_amount)
    WHERE expense_type = 'Jews';

-- =============================================================================
-- Views for Power BI and analytics
-- =============================================================================

-- Full denormalized view: grants joined with filer financials
CREATE OR REPLACE VIEW v_grants_powerbi AS
SELECT
    g.id,
    g.ein,
    COALESCE(f.org_name, g.grantmaker_name)  AS grantmaker_name,
    g.grantmaker_state,
    g.tax_year,
    g.recipient_name,
    g.recipient_city,
    g.recipient_state_country,
    g.geography,
    g.primary_subject,
    g.support_strategy,
    g.grant_amount,
    g.expense_type,
    g.description,
    f.form_type,
    f.total_revenue,
    f.total_expenses,
    f.total_assets_eoy,
    f.net_assets_eoy,
    f.employee_count,
    f.org_city,
    f.org_zip
FROM  irs_grants  g
LEFT JOIN irs_filings f ON f.ein = g.ein AND f.tax_year = g.tax_year;

-- Summary view: one row per filing, with aggregated grant stats
CREATE OR REPLACE VIEW v_filing_summary AS
SELECT
    f.id,
    f.ein,
    f.tax_year,
    f.form_type,
    f.org_name,
    f.org_state,
    f.org_city,
    f.total_revenue,
    f.total_expenses,
    f.total_assets_eoy,
    f.net_assets_eoy,
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

-- Quick stats view
CREATE OR REPLACE VIEW v_stats AS
SELECT
    tax_year,
    expense_type,
    COUNT(*)            AS grant_count,
    SUM(grant_amount)   AS total_dollars,
    AVG(grant_amount)   AS avg_grant,
    MAX(grant_amount)   AS max_grant
FROM irs_grants
GROUP BY tax_year, expense_type
ORDER BY tax_year, expense_type;
