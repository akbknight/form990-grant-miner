// Multi-year pledge annotations for the dashboard year-drilldown and recipient modals.
// Keyed by either "RecipientName|FoundationName|Year|Amount" (preferred) or
// "RecipientName|FoundationName|Year" (fallback when amount is unknown).
// Each annotation has:
//   label   - short pill label (e.g., "5-yr pledge")
//   text    - full annotation text shown in expanded row + note card
//   tooltip - hover text (optional, defaults to text)
//   total_award, annual_estimate, duration_years, start_date, end_date_estimated, source_url, source_evidence_text
window.PLEDGE_ANNOTATIONS = {
  // Jim Joseph Foundation $7.5M / 5-year general operating support to Prizmah (Center for Jewish Day Schools)
  // Awarded 06/03/2024. Candid CSV row records grantmaker under legal name "Shimon Ben Joseph Foundation"
  // (the foundation's IRS legal name; Jim Joseph Foundation is the public-facing name).
  "Prizmah: Center for Jewish Day Schools|Shimon Ben Joseph Foundation|2024|7500000": {
    label: "5-yr pledge",
    text: "$7,500,000 awarded 06/03/2024 by Jim Joseph Foundation (legal name: Shimon Ben Joseph Foundation) for general operating support over 5 years. Per Candid authorized-amount methodology this is reported in the award year; ~$1,500,000/year is the annualized estimate for FY2024–FY2028. Awaiting Jim Joseph FY2024 990-PF for confirmed annual payment schedule.",
    tooltip: "5-year pledge: $7.5M total / ~$1.5M per year (FY2024–FY2028). Multi-year general operating support, not a single-year grant.",
    total_award: 7500000,
    annual_estimate: 1500000,
    duration_years: 5,
    start_date: "2024-06-03",
    end_date_estimated: "2028",
    payment_schedule_confirmed: false,
    source_url: "https://jimjosephfoundation.org/grants/center-for-jewish-day-schools-inc-national-jewish-day-school-support/",
    source_evidence_text: "Jim Joseph Foundation public grant page: $7,500,000 — 06/03/2024 — 5 Years — General Operating Support"
  }
  // Future multi-year pledges should be added here following the same schema.
};
