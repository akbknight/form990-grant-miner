import os
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import Dict, List, Optional

import pandas as pd


# =========================
# USER SETTINGS
# =========================
# Base folder where this script is located
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# All source folders to scan for ZIP / XML files.
# Rules:
#   - "Form 990/"  and  "OneDrive_2026-03-29/Form 990/" are identical mirrors;
#     only ONE of them is listed here to avoid double-counting.
#   - "OneDrive_2026-03-29/new data/" has the 13 ZIPs that failed to sync
#     into the main Form 990 folder; it also contains duplicate "(1)" copies
#     which are filtered out automatically by the deduplication logic below.
#   - "OneDrive_2026-03-29/__Form 990/" contains only error .txt stubs, no ZIPs.
INPUT_FOLDERS = [
    os.path.join(BASE_DIR, "Form 990"),
    os.path.join(BASE_DIR, r"OneDrive_2026-03-29\new data"),
]

# Output CSV file path (CSV has no row limit; Excel caps at 1,048,576 rows)
output_excel_path = os.path.join(BASE_DIR, "form990_extracted_output.csv")

# Value to use when a field cannot be extracted
MISSING_VALUE = "N/A"


# Target column order from Master Raw data 1-500_V2_newdata.xlsm
TARGET_COLUMNS = [
    "Grantmaker Name",
    "Grantmaker State",
    "Recipient Name",
    "Recipient City",
    "Recipient State/Country",
    "Geography",
    "Primary Subject",
    "Tax Year",
    "Year Authorized",
    "Grant Amount",
    "Support Strategies",
    "Description",
    "Expense Type",
    "",
]

SUPPORTED_ZIP_METHODS = {
    zipfile.ZIP_STORED,
    zipfile.ZIP_DEFLATED,
    zipfile.ZIP_BZIP2,
    zipfile.ZIP_LZMA,
}


def _clean(text: Optional[str]) -> str:
    if text is None:
        return ""
    return re.sub(r"\s+", " ", str(text)).strip()


def _ns_uri(root: ET.Element) -> str:
    if root.tag.startswith("{") and "}" in root.tag:
        return root.tag[1 : root.tag.index("}")]
    return ""


def _path_to_xpath(path: str, ns_uri: str) -> str:
    parts = [p for p in path.split("/") if p]
    if ns_uri:
        return ".//" + "/".join(f"{{{ns_uri}}}{p}" for p in parts)
    return ".//" + "/".join(parts)


def _find_first_text(elem: ET.Element, candidate_paths: List[str], ns_uri: str) -> str:
    for path in candidate_paths:
        found = elem.find(_path_to_xpath(path, ns_uri))
        if found is not None and found.text:
            value = _clean(found.text)
            if value:
                return value
    return ""


def _find_all_groups(root: ET.Element, ns_uri: str, group_names: List[str]) -> List[ET.Element]:
    groups: List[ET.Element] = []
    for group_name in group_names:
        xpath = _path_to_xpath(group_name, ns_uri)
        groups.extend(root.findall(xpath))
    return groups


def _extract_year_from_text(value: str) -> str:
    value = _clean(value)
    if not value:
        return ""
    match = re.search(r"(19|20)\d{2}", value)
    return match.group(0) if match else ""


def _extract_year_from_name(file_name: str) -> str:
    # IRS TEOS file names usually start with a 4-digit year, but this also catches years elsewhere.
    match = re.search(r"(19|20)\d{2}", file_name)
    return match.group(0) if match else ""


def _to_number_text(value: str) -> str:
    value = _clean(value)
    if not value:
        return ""
    normalized = value.replace(",", "")
    try:
        amount = float(normalized)
    except ValueError:
        return value
    if amount.is_integer():
        return str(int(amount))
    return str(amount)


def _derive_geography(recipient_state_country: str) -> str:
    if not recipient_state_country:
        return ""
    us_tokens = {
        "US",
        "U.S.",
        "USA",
        "UNITED STATES",
    }
    cleaned = recipient_state_country.strip().upper()
    if cleaned in us_tokens or len(cleaned) == 2:
        return "United States"
    return recipient_state_country


def _derive_primary_subject(description: str) -> str:
    text = description.lower()
    if not text:
        return ""
    keyword_map = {
        "education": ["school", "college", "university", "education", "student", "scholarship"],
        "health": ["health", "hospital", "medical", "maternal", "mental health", "nursing"],
        "housing": ["housing", "shelter", "homeless"],
        "employment": ["workforce", "employment", "job", "career", "entrepreneur"],
        "arts and culture": ["arts", "culture", "artist", "museum", "theater"],
        "food security": ["food", "hunger", "nutrition"],
    }
    for subject, keywords in keyword_map.items():
        if any(word in text for word in keywords):
            return subject.title()
    return ""


def _derive_support_strategy(description: str) -> str:
    text = description.lower()
    if not text:
        return ""
    if any(word in text for word in ["conference", "summit", "exhibit"]):
        return "Conferences and exhibits"
    if any(word in text for word in ["internship", "apprentice"]):
        return "Internships"
    if any(word in text for word in ["training", "capacity", "technical assistance"]):
        return "Capacity building"
    if any(word in text for word in ["leadership", "professional development"]):
        return "Leadership and professional development"
    if any(word in text for word in ["core support", "general support", "operating support"]):
        return "Core support"
    return ""


def _extract_filer_fields(root: ET.Element, ns_uri: str, source_name: str = "") -> Dict[str, str]:
    filer = root.find(_path_to_xpath("Filer", ns_uri))
    if filer is None:
        filer = root

    filer_name = _find_first_text(
        filer,
        [
            "BusinessName/BusinessNameLine1Txt",
            "Name/BusinessNameLine1Txt",
            "BusinessNameLine1Txt",
        ],
        ns_uri,
    )

    filer_state = _find_first_text(
        filer,
        [
            "USAddress/StateAbbreviationCd",
            "FilerUSAddress/StateAbbreviationCd",
            "BusinessUSAddress/StateAbbreviationCd",
            "ForeignAddress/CountryCd",
        ],
        ns_uri,
    )

    tax_year_raw = _find_first_text(
        root,
        [
            "TaxYr",
            "TaxPeriodEndDt",
            "TaxPeriodBeginDt",
        ],
        ns_uri,
    )
    tax_year = _extract_year_from_text(tax_year_raw)
    if not tax_year and source_name:
        tax_year = _extract_year_from_name(source_name)

    return {
        "grantmaker_name": filer_name,
        "grantmaker_state": filer_state,
        "tax_year": tax_year,
        "year_authorized": tax_year,
    }


def _extract_grant_rows_from_root(root: ET.Element, source_name: str = "") -> List[Dict[str, str]]:
    ns_uri = _ns_uri(root)
    filer_info = _extract_filer_fields(root, ns_uri, source_name=source_name)

    grant_group_candidates = [
        "GrantOrContributionPdDurYrGrp",  # Common in 990-PF
        "RecipientTableGrp",              # Common in Schedule I
    ]
    groups = _find_all_groups(root, ns_uri, grant_group_candidates)

    rows: List[Dict[str, str]] = []
    for group in groups:
        recipient_name = _find_first_text(
            group,
            [
                "RecipientBusinessName/BusinessNameLine1Txt",
                "RecipientPersonNm",
                "RecipientNameBusiness/BusinessNameLine1Txt",
                "RecipientNameTxt",
            ],
            ns_uri,
        )

        recipient_city = _find_first_text(
            group,
            [
                "RecipientUSAddress/CityNm",
                "RecipientAddressUS/CityNm",
                "RecipientAddress/CityNm",
            ],
            ns_uri,
        )

        recipient_state_country = _find_first_text(
            group,
            [
                "RecipientUSAddress/StateAbbreviationCd",
                "RecipientAddressUS/StateAbbreviationCd",
                "RecipientForeignAddress/CountryCd",
                "RecipientAddressForeign/CountryCd",
                "RecipientAddress/CountryCd",
            ],
            ns_uri,
        )

        amount = _find_first_text(
            group,
            [
                "Amt",
                "CashGrantAmt",
                "BookValueAmt",
            ],
            ns_uri,
        )

        description = _find_first_text(
            group,
            [
                "GrantOrContributionPurposeTxt",
                "RecipientPurposeOfGrantTxt",
                "PurposeOfGrantTxt",
                "PurposeTxt",
            ],
            ns_uri,
        )

        row = {
            "Grantmaker Name": filer_info["grantmaker_name"],
            "Grantmaker State": filer_info["grantmaker_state"],
            "Recipient Name": recipient_name,
            "Recipient City": recipient_city,
            "Recipient State/Country": recipient_state_country,
            "Geography": _derive_geography(recipient_state_country),
            "Primary Subject": _derive_primary_subject(description),
            "Tax Year": filer_info["tax_year"],
            "Year Authorized": filer_info["year_authorized"],
            "Grant Amount": _to_number_text(amount),
            "Support Strategies": _derive_support_strategy(description),
            "Description": description,
            "Expense Type": "",
            "": "",
        }

        # Keep only meaningful rows where a recipient or amount or description exists.
        if any(_clean(row[key]) for key in ["Recipient Name", "Grant Amount", "Description"]):
            rows.append(row)

    return rows


def _apply_missing_defaults(df: pd.DataFrame, missing_value: str = MISSING_VALUE) -> pd.DataFrame:
    for column in TARGET_COLUMNS:
        if column not in df.columns:
            df[column] = ""
    df = df[TARGET_COLUMNS]
    df = df.fillna("")

    for col in TARGET_COLUMNS:
        if col == "":
            continue
        df[col] = df[col].astype(str).str.strip()
        df[col] = df[col].replace("", missing_value)

    # The intentionally blank template column stays blank.
    df[""] = ""
    return df


def _collect_input_files(input_folders: List[str]) -> Dict[str, List[str]]:
    """
    Walk every folder in *input_folders*, collect all XML and ZIP paths,
    then deduplicate ZIPs by canonical name (stripping trailing ' (N)' suffixes).

    Preference order when duplicates exist:
      1. The clean name (no suffix) wins over a ' (1)' / ' (2)' copy.
      2. The first folder in *input_folders* wins when two different folders
         contain the same canonical file name.
    """
    xml_files: List[str] = []
    # canonical_key -> (full_path, has_suffix)
    zip_seen: Dict[str, tuple] = {}

    for input_folder in input_folders:
        if not os.path.isdir(input_folder):
            print(f"  WARNING: folder not found, skipping: {input_folder}")
            continue
        for root_dir, _, files in os.walk(input_folder):
            for name in files:
                lower_name = name.lower()
                full_path = os.path.join(root_dir, name)
                if lower_name.endswith(".xml"):
                    xml_files.append(full_path)
                elif lower_name.endswith(".zip"):
                    # Canonical key: remove trailing " (N)" before .zip
                    canonical = re.sub(r"\s*\(\d+\)(?=\.zip$)", "", lower_name)
                    has_suffix = canonical != lower_name
                    if canonical not in zip_seen:
                        zip_seen[canonical] = (full_path, has_suffix)
                    else:
                        existing_path, existing_has_suffix = zip_seen[canonical]
                        # Prefer the copy without a numeric suffix
                        if existing_has_suffix and not has_suffix:
                            zip_seen[canonical] = (full_path, has_suffix)
                            print(
                                f"  Dedup: preferring '{name}' over "
                                f"'{os.path.basename(existing_path)}'"
                            )
                        else:
                            print(
                                f"  Dedup: skipping '{name}' "
                                f"(keeping '{os.path.basename(existing_path)}')"
                            )

    xml_files.sort()
    zip_files = sorted(path for path, _ in zip_seen.values())
    return {"xml": xml_files, "zip": zip_files}


def _extract_rows_from_xml_file(xml_path: str) -> List[Dict[str, str]]:
    tree = ET.parse(xml_path)
    root = tree.getroot()
    return _extract_grant_rows_from_root(root, source_name=os.path.basename(xml_path))


def _extract_rows_from_zip_file(zip_path: str) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    skipped_unsupported = 0
    processed_xml_members = 0

    with zipfile.ZipFile(zip_path, "r") as zf:
        xml_infos = [i for i in zf.infolist() if i.filename.lower().endswith(".xml")]
        for info in xml_infos:
            if info.compress_type not in SUPPORTED_ZIP_METHODS:
                skipped_unsupported += 1
                continue
            try:
                xml_bytes = zf.read(info)
                root = ET.fromstring(xml_bytes)
                member_rows = _extract_grant_rows_from_root(root, source_name=info.filename)
                rows.extend(member_rows)
                processed_xml_members += 1
            except ET.ParseError:
                print(f"  Skipping {info.filename} in {os.path.basename(zip_path)}: XML parse error")
            except NotImplementedError:
                skipped_unsupported += 1
            except Exception as exc:
                print(f"  Skipping {info.filename} in {os.path.basename(zip_path)}: {exc}")

    if skipped_unsupported:
        print(
            f"  Skipped {skipped_unsupported} XML members in {os.path.basename(zip_path)} "
            f"due to unsupported compression"
        )
    print(
        f"  Parsed {processed_xml_members} XML members from {os.path.basename(zip_path)}"
    )
    return rows


def extract_form990_folders_to_excel(input_folders: List[str], output_excel: str) -> None:
    """
    Scan *input_folders* for ZIP and XML files, extract grant rows from each,
    deduplicate across folders, and write everything to *output_excel*.
    Writes CSV when the path ends in .csv (no row-count limit), Excel otherwise.
    """
    all_rows: List[Dict[str, str]] = []
    discovered = _collect_input_files(input_folders)
    xml_files = discovered["xml"]
    zip_files = discovered["zip"]

    print(
        f"Source folders : {len(input_folders)}\n"
        f"XML files found: {len(xml_files)}\n"
        f"ZIP files found: {len(zip_files)} (after deduplication)"
    )

    for full_path in xml_files:
        filename = os.path.basename(full_path)
        try:
            rows = _extract_rows_from_xml_file(full_path)
            all_rows.extend(rows)
            print(f"Processed XML {filename}: {len(rows)} rows")
        except ET.ParseError:
            print(f"Skipping {filename}: XML parse error")
        except Exception as exc:
            print(f"Skipping {filename}: unexpected error -> {exc}")

    for zip_path in zip_files:
        zip_name = os.path.basename(zip_path)
        try:
            rows = _extract_rows_from_zip_file(zip_path)
            all_rows.extend(rows)
            print(f"Processed ZIP {zip_name}: {len(rows)} rows")
        except zipfile.BadZipFile:
            print(f"Skipping {zip_name}: invalid ZIP file")
        except Exception as exc:
            print(f"Skipping {zip_name}: unexpected error -> {exc}")

    df = pd.DataFrame(all_rows)
    df = _apply_missing_defaults(df, missing_value=MISSING_VALUE)

    output_dir = os.path.dirname(os.path.abspath(output_excel))
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    if output_excel.lower().endswith(".csv"):
        df.to_csv(output_excel, index=False, encoding="utf-8-sig")
    else:
        df.to_excel(output_excel, index=False)
    print(f"\nDone. Wrote {len(df)} rows to: {output_excel}")


if __name__ == "__main__":
    extract_form990_folders_to_excel(INPUT_FOLDERS, output_excel_path)