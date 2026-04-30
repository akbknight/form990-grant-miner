-- =============================================================================
-- IRS Form 990 Grant Pipeline — Neon Postgres Schema
-- Run this once in your Neon SQL Editor before starting the pipeline.
-- =============================================================================

-- ── Progress tracker (one row per IRS filing) ─────────────────────────────────
-- Allows full resume: skip object_ids we already processed.
CREATE TABLE IF NOT EXISTS irs_progress (
    object_id    TEXT        PRIMARY KEY,
    tax_year     SMALLINT,
    status       TEXT        NOT NULL,   -- 'done' | 'failed' | 'no_grants'
    grant_count  INTEGER     DEFAULT 0,
    error_msg    TEXT,
    processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_year   ON irs_progress (tax_year);
CREATE INDEX IF NOT EXISTS idx_progress_status ON irs_progress (status);

-- ── Grant records (one row per grant disbursement) ────────────────────────────
CREATE TABLE IF NOT EXISTS irs_grants (
    id              BIGSERIAL   PRIMARY KEY,
    object_id       TEXT        NOT NULL,
    ein             TEXT,
    tax_year        SMALLINT,
    grantmaker      TEXT,
    grantmaker_state CHAR(2),
    recipient       TEXT,
    city            TEXT,
    state           TEXT,
    amount          BIGINT,
    description     TEXT,
    subject         TEXT,           -- keyword-classified topic area
    strategy        TEXT,           -- keyword-classified grant strategy
    expense_type    TEXT            DEFAULT 'Uncategorized',
    inserted_at     TIMESTAMPTZ     DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grants_object_id  ON irs_grants (object_id);
CREATE INDEX IF NOT EXISTS idx_grants_ein        ON irs_grants (ein);
CREATE INDEX IF NOT EXISTS idx_grants_year       ON irs_grants (tax_year);
CREATE INDEX IF NOT EXISTS idx_grants_expense    ON irs_grants (expense_type);
CREATE INDEX IF NOT EXISTS idx_grants_amount     ON irs_grants (amount);

-- Partial index for fast "give me all uncategorized" queries
CREATE INDEX IF NOT EXISTS idx_grants_uncat ON irs_grants (id)
    WHERE expense_type = 'Uncategorized';

-- ── Convenience view for analysis ─────────────────────────────────────────────
CREATE OR REPLACE VIEW v_grant_summary AS
SELECT
    tax_year,
    expense_type,
    COUNT(*)                        AS grant_count,
    SUM(amount)                     AS total_amount,
    AVG(amount)                     AS avg_amount,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) AS median_amount
FROM irs_grants
WHERE amount IS NOT NULL
GROUP BY tax_year, expense_type
ORDER BY tax_year, expense_type;
