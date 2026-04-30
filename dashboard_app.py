"""Streamlit dashboard for interactive Form 990 grant exploration."""

from __future__ import annotations

from pathlib import Path

import streamlit as st

from dashboard.data_access import (
    DashboardFilters,
    fetch_category_mix,
    fetch_filter_options,
    fetch_overview_metrics,
    fetch_profile,
    fetch_recent_records,
    fetch_state_mix,
    fetch_subject_mix,
    fetch_top_grantmakers,
    fetch_trend,
    list_sources,
)
from dashboard.presentation import (
    build_category_chart,
    build_grantmaker_chart,
    build_state_chart,
    build_subject_chart,
    build_trend_chart,
    compact_number,
    format_currency,
    inject_theme,
    render_hero,
    render_metric_cards,
)
from project_utils.paths import PROJECT_ROOT


BASE_DIR = PROJECT_ROOT


@st.cache_data(ttl=300, show_spinner=False)
def cached_sources(base_dir: str):
    return list_sources(Path(base_dir))


@st.cache_data(ttl=300, show_spinner=False)
def cached_filter_options(source):
    return fetch_filter_options(source)


@st.cache_data(ttl=300, show_spinner=False)
def cached_profile(source):
    return fetch_profile(source)


@st.cache_data(ttl=300, show_spinner=False)
def cached_metrics(source, filters: DashboardFilters):
    return fetch_overview_metrics(source, filters)


@st.cache_data(ttl=300, show_spinner=False)
def cached_category_mix(source, filters: DashboardFilters):
    return fetch_category_mix(source, filters)


@st.cache_data(ttl=300, show_spinner=False)
def cached_trend(source, filters: DashboardFilters):
    return fetch_trend(source, filters)


@st.cache_data(ttl=300, show_spinner=False)
def cached_subject_mix(source, filters: DashboardFilters):
    return fetch_subject_mix(source, filters)


@st.cache_data(ttl=300, show_spinner=False)
def cached_state_mix(source, filters: DashboardFilters):
    return fetch_state_mix(source, filters)


@st.cache_data(ttl=300, show_spinner=False)
def cached_top_grantmakers(source, filters: DashboardFilters):
    return fetch_top_grantmakers(source, filters)


@st.cache_data(ttl=300, show_spinner=False)
def cached_recent_records(source, filters: DashboardFilters, limit: int):
    return fetch_recent_records(source, filters, limit=limit)


def main() -> None:
    st.set_page_config(
        page_title="Grant Atlas 990",
        page_icon=":bar_chart:",
        layout="wide",
        initial_sidebar_state="expanded",
    )
    inject_theme(st)

    sources = cached_sources(str(BASE_DIR))
    if not sources:
        st.error(
            "No supported SQLite data source was found. "
            "Expected `workspace_data/databases/irs990_2023_2024.db` or "
            "`workspace_data/databases/irs990_pipeline.db`."
        )
        st.stop()

    with st.sidebar:
        st.markdown("## Control Room")
        st.caption("Read-only analytics. No writes, no ad hoc SQL, no secret output.")

        source = st.selectbox(
            "Data source",
            sources,
            format_func=lambda item: item.label,
        )

        options = cached_filter_options(source)
        profile = cached_profile(source)

        selected_years = st.multiselect("Tax years", options["years"], default=options["years"])
        selected_categories = st.multiselect("Categories", options["categories"], default=options["categories"])
        selected_states = st.multiselect("Recipient states/countries", options["states"])
        selected_subjects = st.multiselect("Subject areas", options["subjects"])
        search_text = st.text_input("Search", placeholder="Grantmaker, recipient, or description")
        record_limit = st.slider("Explorer rows", min_value=50, max_value=500, value=150, step=25)

        st.markdown("---")
        st.caption(f"Resolved file: `{source.path}`")
        st.caption(
            f"Coverage: {profile.get('first_year') or 'N/A'}-{profile.get('last_year') or 'N/A'} | "
            f"{compact_number(profile.get('total_grants', 0))} grants"
        )

    filters = DashboardFilters(
        years=tuple(selected_years),
        categories=tuple(selected_categories),
        states=tuple(selected_states),
        subjects=tuple(selected_subjects),
        search_text=search_text,
    )

    metrics = cached_metrics(source, filters)
    category_mix = cached_category_mix(source, filters)
    trend = cached_trend(source, filters)
    subject_mix = cached_subject_mix(source, filters)
    state_mix = cached_state_mix(source, filters)
    top_grantmakers = cached_top_grantmakers(source, filters)
    records = cached_recent_records(source, filters, record_limit)

    render_hero(st, source.label, profile)
    render_metric_cards(
        st,
        [
            {
                "label": "Filtered Grants",
                "value": compact_number(metrics.get("grants", 0)),
                "subtitle": "Records in the active lens",
            },
            {
                "label": "Grantmakers",
                "value": compact_number(metrics.get("grantmakers", 0)),
                "subtitle": "Distinct disbursing organizations",
            },
            {
                "label": "Capital Tracked",
                "value": format_currency(metrics.get("total_dollars", 0)),
                "subtitle": "Total dollars in the active lens",
            },
            {
                "label": "Average Grant",
                "value": format_currency(metrics.get("avg_grant", 0)),
                "subtitle": "Mean grant size",
            },
            {
                "label": "Jewish Grant Share",
                "value": compact_number(metrics.get("jewish_grants", 0)),
                "subtitle": f"{format_currency(metrics.get('jewish_dollars', 0))} in tracked dollars",
            },
        ],
    )

    st.markdown(
        '<div class="section-note">The dashboard reads from SQLite in read-only mode and all data filters are parameterized. '
        "The explorer view is intentionally capped to keep the UI fast even when the warehouse grows.</div>",
        unsafe_allow_html=True,
    )

    overview_tab, sector_tab, explorer_tab = st.tabs(
        ["Portfolio Pulse", "Geography and Sectors", "Explorer"]
    )

    with overview_tab:
        left, right = st.columns([1.55, 1.0], gap="large")
        with left:
            st.plotly_chart(build_trend_chart(trend), use_container_width=True)
        with right:
            st.plotly_chart(build_category_chart(category_mix), use_container_width=True)

        bottom_left, bottom_right = st.columns([1.0, 1.3], gap="large")
        with bottom_left:
            st.plotly_chart(build_state_chart(state_mix), use_container_width=True)
        with bottom_right:
            st.plotly_chart(build_grantmaker_chart(top_grantmakers), use_container_width=True)

    with sector_tab:
        subject_col, table_col = st.columns([1.2, 1.0], gap="large")
        with subject_col:
            st.plotly_chart(build_subject_chart(subject_mix), use_container_width=True)
        with table_col:
            st.markdown("### Category ledger")
            if category_mix.empty:
                st.info("No category totals for the active filters.")
            else:
                category_table = category_mix.rename(
                    columns={
                        "expense_type": "Category",
                        "grant_count": "Grant Count",
                        "total_dollars": "Total Dollars",
                    }
                )
                st.dataframe(
                    category_table,
                    use_container_width=True,
                    hide_index=True,
                    column_config={
                        "Grant Count": st.column_config.NumberColumn(format="%d"),
                        "Total Dollars": st.column_config.NumberColumn(format="$%,d"),
                    },
                )

    with explorer_tab:
        st.markdown("### Filtered records")
        st.caption("CSV export follows the same safe, parameterized filters applied to the dashboard.")
        st.download_button(
            label="Download current slice as CSV",
            data=records.to_csv(index=False).encode("utf-8"),
            file_name="grant_atlas_filtered_slice.csv",
            mime="text/csv",
            use_container_width=False,
        )
        st.dataframe(
            records,
            use_container_width=True,
            hide_index=True,
            column_config={
                "tax_year": st.column_config.NumberColumn("Tax Year", format="%d"),
                "grant_amount": st.column_config.NumberColumn("Grant Amount", format="$%,d"),
                "grantmaker_name": "Grantmaker",
                "recipient_name": "Recipient",
                "recipient_location": "Recipient Location",
                "primary_subject": "Subject",
                "expense_type": "Category",
                "description": st.column_config.TextColumn("Description", width="large"),
            },
        )


if __name__ == "__main__":
    main()
