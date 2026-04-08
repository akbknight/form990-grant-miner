"""
irs_db/parser.py
================
Parses a single Form 990 XML element into two structured dicts:
  - filing  : organization-level financial data  -> irs_filings table
  - grants  : list of grant records              -> irs_grants table

No database calls here — pure parsing logic.
"""

import re
import xml.etree.ElementTree as ET
from typing import Optional, Tuple, List, Dict, Any

# ── Classification: 57 Jewish keywords ────────────────────────────────────────

JEWISH_KEYWORDS = [
    r"\bjew(?:ish|s)?\b", r"\bjudaism\b", r"\bhebrew\b", r"\bsemitic\b",
    r"\bisrael(?:i)?\b",
    r"\byeshiva[h]?\b", r"\bsynagogue\b", r"\bshul\b",
    r"\brabbi(?:nical)?\b", r"\bchabad\b", r"\blubavitch\b",
    r"\bhillel\b", r"\bjcc\b", r"\bhadassah\b",
    r"\bb['\u2019]?nai\b", r"\bbnai\b",
    r"\btorah\b", r"\btalmud\b", r"\bkabbalah\b",
    r"\bkosher\b", r"\bkippah\b", r"\byarmulke\b",
    r"\bmitzvah\b", r"\bbar mitzvah\b", r"\bbat mitzvah\b",
    r"\bshabbat\b", r"\bshabbos\b",
    r"\bpassover\b", r"\bpesach\b",
    r"\bhanukkah\b", r"\bchanukah\b",
    r"\brosh hashanah\b", r"\byom kippur\b",
    r"\bsukkot\b", r"\bpurim\b",
    r"\bjerusalem\b", r"\bzion(?:ist|ism)?\b",
    r"\bkibbutz\b", r"\bbirthright\b",
    r"\bholocaust\b", r"\bshoah\b", r"\bnazism\b",
    r"\bmenorah\b", r"\bshalom\b", r"\btikva[ht]?\b", r"\bmazel\b",
    r"\bjewish federation\b", r"\bjewish community\b",
    r"\bjewish family\b", r"\bjewish fund\b",
    r"\bjewish foundation\b", r"\bjewish alliance\b",
    r"\bjewish council\b", r"\bjewish board\b",
    r"\bjewish welfare\b", r"\bjewish vocational\b",
    r"\bjewish home\b", r"\bfriends of israel\b",
    r"\bstate of israel\b", r"\bamerican israel\b",
    r"\bamerican jewish\b", r"\bunited jewish\b",
    r"\bnational council of jewish\b",
]
JEWISH_RE = re.compile("|".join(JEWISH_KEYWORDS), re.IGNORECASE)

# ── Subject / Strategy maps ────────────────────────────────────────────────────

_SUBJECT_MAP = [
    ("Education",        ["school","college","university","education","student","scholarship","academic","literacy"]),
    ("Health",           ["health","hospital","medical","mental health","nursing","clinic","disease","cancer","maternal"]),
    ("Housing",          ["housing","shelter","homeless","affordable housing","rent"]),
    ("Employment",       ["workforce","employment","job","career","entrepreneur","vocational","training"]),
    ("Arts And Culture", ["arts","culture","artist","museum","theater","theatre","dance","music","film"]),
    ("Food Security",    ["food","hunger","nutrition","meals","pantry","feeding"]),
    ("Environment",      ["environment","climate","conservation","water","land","wildlife"]),
    ("Civil Rights",     ["civil rights","justice","equity","discrimination","advocacy","policy"]),
    ("Religion",         ["church","mosque","temple","faith","ministry","congregation","diocese"]),
    ("Human Services",   ["family","youth","children","seniors","elderly","disability","veterans"]),
]

_STRATEGY_MAP = [
    ("Conferences and exhibits",                ["conference","summit","exhibit","symposium"]),
    ("Internships",                             ["internship","apprentice","fellowship"]),
    ("Capacity building",                       ["training","capacity","technical assistance","organizational"]),
    ("Leadership and professional development", ["leadership","professional development","executive"]),
    ("Core support",                            ["core support","general support","operating support","general operating"]),
    ("Research",                                ["research","study","evaluation","assessment"]),
    ("Direct services",                         ["direct service","program services","client services"]),
]

# ── Helpers ────────────────────────────────────────────────────────────────────

MISSING = "N/A"


def _ns(root: ET.Element) -> str:
    if root.tag.startswith("{") and "}" in root.tag:
        return root.tag[1:root.tag.index("}")]
    return ""


def _find(elem: ET.Element, path: str, ns: str) -> str:
    parts = [p for p in path.split("/") if p]
    xpath = ".//" + "/".join(f"{{{ns}}}{p}" if ns else p for p in parts)
    found = elem.find(xpath)
    return re.sub(r"\s+", " ", found.text).strip() if found is not None and found.text else ""


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).strip() if text else ""


def _clean_ein(raw: str) -> Optional[str]:
    """Strip hyphens, pad to 9 digits. Returns None if invalid."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 9:
        return digits
    if len(digits) < 9:
        return digits.zfill(9)
    return None


def _to_int(text: str) -> Optional[int]:
    """Convert dollar string to int. Returns None on failure."""
    if not text:
        return None
    try:
        return int(float(text.replace(",", "").replace("$", "").strip()))
    except (ValueError, AttributeError):
        return None


def _year(text: str) -> Optional[int]:
    m = re.search(r"(19|20)\d{2}", str(text or ""))
    return int(m.group(0)) if m else None


def _geography(state_country: str) -> str:
    if not state_country:
        return ""
    up = state_country.strip().upper()
    if up in {"US", "U.S.", "USA", "UNITED STATES"} or (len(up) == 2 and up.isalpha()):
        return "United States"
    return state_country


def _subject(desc: str) -> str:
    t = (desc or "").lower()
    for subj, kws in _SUBJECT_MAP:
        if any(w in t for w in kws):
            return subj
    return ""


def _strategy(desc: str) -> str:
    t = (desc or "").lower()
    for strat, kws in _STRATEGY_MAP:
        if any(w in t for w in kws):
            return strat
    return ""


def classify(recipient: str, description: str, subject: str, strategy: str) -> str:
    """Returns 'Jews' | 'Non jews' | 'Miscellaneous'"""
    combined = f"{recipient} {description} {subject} {strategy}".strip()
    blanks = {"", "n/a", "nan", MISSING.lower()}
    if JEWISH_RE.search(combined):
        return "Jews"
    if any(p.strip().lower() not in blanks for p in [recipient, description, subject, strategy]):
        return "Non jews"
    return "Miscellaneous"


def _org_name_clean(name: str) -> str:
    """Lowercase, strip punctuation — for dedup / fuzzy matching."""
    return re.sub(r"[^\w\s]", "", (name or "").lower()).strip()


# ── Financial extraction (handles 990, 990EZ, 990PF) ──────────────────────────

def _extract_financials(root: ET.Element, ns: str, form_type: str) -> Dict[str, Any]:
    """
    Returns a dict with financial fields. NULL (None) for any missing value.
    Handles different field paths across 990 / 990EZ / 990PF.
    """
    fin: Dict[str, Any] = {
        "gross_receipts":        None,
        "total_revenue":         None,
        "total_expenses":        None,
        "total_assets_eoy":      None,
        "total_liabilities_eoy": None,
        "net_assets_eoy":        None,
        "employee_count":        None,
        "volunteer_count":       None,
    }

    def _fi(path: str) -> Optional[int]:
        return _to_int(_find(root, path, ns))

    fin["gross_receipts"] = _fi("GrossReceiptsAmt")

    if form_type == "990":
        fin["total_revenue"]         = _fi("IRS990/CYTotalRevenueAmt")         or _fi("CYTotalRevenueAmt")
        fin["total_expenses"]        = _fi("IRS990/CYTotalExpensesAmt")         or _fi("CYTotalExpensesAmt")
        fin["total_assets_eoy"]      = _fi("IRS990/TotalAssetsEOYAmt")          or _fi("TotalAssetsEOYAmt")
        fin["total_liabilities_eoy"] = _fi("IRS990/TotalLiabilitiesEOYAmt")     or _fi("TotalLiabilitiesEOYAmt")
        fin["net_assets_eoy"]        = _fi("IRS990/NetAssetsOrFundBalancesEOYAmt") or _fi("NetAssetsOrFundBalancesEOYAmt")
        fin["employee_count"]        = _fi("IRS990/TotalEmployeeCnt")           or _fi("TotalEmployeeCnt")
        fin["volunteer_count"]       = _fi("IRS990/TotalVolunteersCnt")         or _fi("TotalVolunteersCnt")

    elif form_type == "990EZ":
        fin["total_revenue"]         = _fi("IRS990EZ/TotalRevenueAmt")          or _fi("TotalRevenueAmt")
        fin["total_expenses"]        = _fi("IRS990EZ/TotalExpensesAmt")          or _fi("TotalExpensesAmt")
        fin["total_assets_eoy"]      = _fi("IRS990EZ/TotalAssetsEOYAmt")         or _fi("TotalAssetsEOYAmt")
        fin["total_liabilities_eoy"] = _fi("IRS990EZ/TotalLiabilitiesAmt")       or _fi("TotalLiabilitiesAmt")
        fin["net_assets_eoy"]        = _fi("IRS990EZ/NetAssetsOrFundBalancesEOYAmt") or _fi("NetAssetsOrFundBalancesEOYAmt")

    elif form_type == "990PF":
        fin["total_revenue"]         = _fi("IRS990PF/TotalRevenueAndExpnsAmt")  or _fi("TotalRevAndExpnssAmt")
        fin["total_expenses"]        = _fi("IRS990PF/TotalExpensesRevAndExpnssAmt") or _fi("TotalExpensesRevAndExpnssAmt")
        fin["total_assets_eoy"]      = _fi("IRS990PF/TotalAssetsEOYAmt")        or _fi("TotalAssetsEOYAmt")
        fin["total_liabilities_eoy"] = _fi("IRS990PF/TotalLiabilitiesEOYAmt")   or _fi("TotalLiabilitiesEOYAmt")
        fin["net_assets_eoy"]        = _fi("IRS990PF/TotNetAstOrFundBalancesEOYAmt") or _fi("TotNetAstOrFundBalancesEOYAmt")

    return fin


# ── Grant extraction ───────────────────────────────────────────────────────────

_GRANT_GROUP_TAGS = [
    "GrantOrContributionPdDurYrGrp",
    "RecipientTableGrp",
    "GrantOrContriPdDurYrGrp",
]


def _extract_grants(root: ET.Element, ns: str,
                    ein: Optional[str], gmaker_name: str,
                    gmaker_state: str, tax_year: Optional[int],
                    source_zip: str, source_xml: str) -> List[Dict]:
    grants = []
    for grp_tag in _GRANT_GROUP_TAGS:
        xpath = f".//{{{ns}}}{grp_tag}" if ns else f".//{grp_tag}"
        for grp in root.findall(xpath):
            rname = (
                _find(grp, "RecipientBusinessName/BusinessNameLine1Txt", ns)
                or _find(grp, "RecipientPersonNm", ns)
                or _find(grp, "RecipientNameTxt", ns)
            )
            rcity = (
                _find(grp, "RecipientUSAddress/CityNm", ns)
                or _find(grp, "RecipientForeignAddress/CityNm", ns)
                or _find(grp, "RecipientAddress/CityNm", ns)
            )
            rstate = (
                _find(grp, "RecipientUSAddress/StateAbbreviationCd", ns)
                or _find(grp, "RecipientForeignAddress/CountryCd", ns)
                or _find(grp, "RecipientAddress/CountryCd", ns)
            )
            amount_raw = (
                _find(grp, "Amt", ns)
                or _find(grp, "CashGrantAmt", ns)
                or _find(grp, "GrantOrContributionAmt", ns)
            )
            desc = (
                _find(grp, "GrantOrContributionPurposeTxt", ns)
                or _find(grp, "PurposeOfGrantTxt", ns)
                or _find(grp, "PurposeTxt", ns)
            )

            if not any([rname, amount_raw, desc]):
                continue

            amount  = _to_int(amount_raw)
            subj    = _subject(desc)
            strat   = _strategy(desc)
            geo     = _geography(rstate)
            exp     = classify(rname, desc, subj, strat)

            grants.append({
                "ein":                     ein,
                "tax_year":                tax_year,
                "grantmaker_name":         gmaker_name  or None,
                "grantmaker_state":        gmaker_state[:2] if gmaker_state else None,
                "recipient_name":          rname        or None,
                "recipient_city":          rcity        or None,
                "recipient_state_country": rstate       or None,
                "geography":               geo          or None,
                "primary_subject":         subj         or None,
                "support_strategy":        strat        or None,
                "grant_amount":            amount,
                "description":             desc         or None,
                "expense_type":            exp,
                "source_zip":              source_zip,
                "source_xml":              source_xml,
            })
    return grants


# ── Main entry point ───────────────────────────────────────────────────────────

def parse_filing(
    xml_bytes: bytes,
    source_zip: str,
    source_xml: str,
) -> Tuple[Optional[Dict], List[Dict]]:
    """
    Parse a raw Form 990 XML byte string.

    Returns:
        (filing_dict, [grant_dict, ...])
        filing_dict is None if the XML cannot be parsed or has no EIN.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return None, []

    ns = _ns(root)

    # ── Header fields ────────────────────────────────────────────────────────
    filer = root.find(f".//{{{ns}}}Filer" if ns else ".//Filer") or root

    ein_raw    = _find(filer, "EIN", ns) or _find(root, "EIN", ns)
    ein        = _clean_ein(ein_raw)

    form_type_raw = _find(root, "ReturnTypeCd", ns) or _find(root, "ReturnType", ns)
    form_type     = _clean(form_type_raw).upper().replace(" ", "")  # "990", "990EZ", "990PF"
    if not form_type:
        form_type = "990"

    tax_year = (
        _year(_find(root, "TaxYr", ns))
        or _year(_find(root, "TaxPeriodEndDt", ns))
        or _year(source_zip)
    )

    org_name = (
        _find(filer, "BusinessName/BusinessNameLine1Txt", ns)
        or _find(filer, "Name/BusinessNameLine1Txt", ns)
        or _find(filer, "BusinessNameLine1Txt", ns)
    )
    org_state = (
        _find(filer, "USAddress/StateAbbreviationCd", ns)
        or _find(filer, "ForeignAddress/CountryCd", ns)
    )
    org_city  = (
        _find(filer, "USAddress/CityNm", ns)
        or _find(filer, "ForeignAddress/CityNm", ns)
    )
    org_zip   = _find(filer, "USAddress/ZIPCd", ns)
    org_country = _find(filer, "ForeignAddress/CountryCd", ns) or "US"

    # ── Financials ───────────────────────────────────────────────────────────
    fin = _extract_financials(root, ns, form_type)

    filing = {
        "ein":                    ein,
        "tax_year":               tax_year,
        "form_type":              form_type[:10] if form_type else None,
        "org_name":               org_name   or None,
        "org_name_clean":         _org_name_clean(org_name),
        "org_state":              org_state[:2] if org_state else None,
        "org_city":               org_city   or None,
        "org_zip":                org_zip    or None,
        "org_country":            org_country[:3] if org_country else None,
        "source_zip":             source_zip,
        **fin,
    }

    if not ein or not tax_year:
        filing = None   # Cannot uniquely identify — skip filing insert

    # ── Grants ───────────────────────────────────────────────────────────────
    grants = _extract_grants(
        root, ns,
        ein, org_name or "", org_state or "",
        tax_year, source_zip, source_xml,
    )

    return filing, grants
