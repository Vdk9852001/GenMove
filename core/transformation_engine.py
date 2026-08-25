"""Rule-driven source transformation for SAP legacy-to-S/4 validation.

Rulebook columns (CSV/XLSX): OBJECT, SOURCE_FIELD, TARGET_FIELD,
SOURCE_VALUE, TARGET_VALUE, ACTIVE.  OBJECT may be ``*`` to share a rule.
Original uploads are never modified; callers receive a temporary transformed file.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Iterable

import pandas as pd


REQUIRED_COLUMNS = {"SOURCE_FIELD", "TARGET_FIELD", "SOURCE_VALUE", "TARGET_VALUE"}
OPTIONAL_DEFAULTS = {"OBJECT": "*", "ACTIVE": "YES", "DESCRIPTION": ""}


@dataclass
class TransformationResult:
    path: str
    applied_rules: int
    changed_cells: int
    changed_rows: int
    audit: list


def _read_table(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path, dtype=str, keep_default_na=False)
    return pd.read_excel(path, dtype=str, keep_default_na=False)


def load_rulebook(path: str | Path) -> list[dict]:
    df = _read_table(path)
    df.columns = [str(c).strip().upper() for c in df.columns]
    missing = sorted(REQUIRED_COLUMNS - set(df.columns))
    if missing:
        raise ValueError("Rulebook is missing column(s): " + ", ".join(missing))
    for column, default in OPTIONAL_DEFAULTS.items():
        if column not in df.columns:
            df[column] = default
    rules = []
    for row_no, row in df.iterrows():
        rule = {column: str(row.get(column, "")).strip() for column in df.columns}
        if not rule["SOURCE_FIELD"] or not rule["TARGET_FIELD"]:
            continue
        if rule["ACTIVE"].upper() in {"NO", "N", "FALSE", "0", "INACTIVE"}:
            continue
        rule["OBJECT"] = (rule["OBJECT"] or "*").upper()
        rule["SOURCE_FIELD"] = rule["SOURCE_FIELD"].upper()
        rule["TARGET_FIELD"] = rule["TARGET_FIELD"].upper()
        rule["ROW_NUMBER"] = int(row_no) + 2
        rules.append(rule)
    if not rules:
        raise ValueError("The rulebook contains no active transformation rules.")
    return rules


def rules_for_object(rules: Iterable[dict], object_name: str) -> list[dict]:
    name = str(object_name).upper()
    return [r for r in rules if r.get("OBJECT", "*").upper() in {"*", name}]


def transform_source(source_path: str | Path, rules: Iterable[dict], object_name: str) -> TransformationResult:
    source_path = Path(source_path)
    df = _read_table(source_path)
    df.columns = [str(c).strip().upper() for c in df.columns]
    applicable = rules_for_object(rules, object_name)
    changed_row_ids, audit, applied = set(), [], 0

    for rule in applicable:
        src = rule["SOURCE_FIELD"]
        tgt = rule["TARGET_FIELD"]
        if src not in df.columns:
            audit.append({"status": "SKIPPED", "reason": f"Source field {src} not found", **rule})
            continue
        values = df[src].astype(str).str.strip()
        mask = values.eq(rule["SOURCE_VALUE"])
        count = int(mask.sum())
        if count:
            # Validator maps SOURCE_FIELD -> TARGET_FIELD, so the converted
            # value must live in the source column of the immutable view.
            df.loc[mask, src] = rule["TARGET_VALUE"]
            changed_row_ids.update(df.index[mask].tolist())
            applied += 1
        audit.append({
            "status": "APPLIED" if count else "NO_MATCH", "affected_rows": count,
            "object": rule["OBJECT"], "source_field": src, "target_field": tgt,
            "source_value": rule["SOURCE_VALUE"], "target_value": rule["TARGET_VALUE"],
            "description": rule.get("DESCRIPTION", ""), "rule_row": rule["ROW_NUMBER"],
        })

    suffix = ".csv" if source_path.suffix.lower() == ".csv" else ".xlsx"
    tmp = NamedTemporaryFile(prefix="genmove_transformed_", suffix=suffix, delete=False)
    tmp.close()
    if suffix == ".csv":
        df.to_csv(tmp.name, index=False)
    else:
        df.to_excel(tmp.name, index=False)
    return TransformationResult(tmp.name, applied, sum(a.get("affected_rows", 0) for a in audit),
                                len(changed_row_ids), audit)


def save_transformed_source(source_path: str | Path, destination: str | Path,
                            rules: Iterable[dict], object_name: str) -> TransformationResult:
    """Create a permanent transformed copy while preserving the original file."""
    result = transform_source(source_path, rules, object_name)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    Path(result.path).replace(destination)
    result.path = str(destination)
    return result


def sample_rulebook() -> pd.DataFrame:
    return pd.DataFrame([
        {"OBJECT": "MATERIAL", "SOURCE_FIELD": "WERKS", "TARGET_FIELD": "WERKS",
         "SOURCE_VALUE": "5302", "TARGET_VALUE": "USP1", "ACTIVE": "YES",
         "DESCRIPTION": "Legacy plant to S/4 plant"},
        {"OBJECT": "MATERIAL", "SOURCE_FIELD": "WERKS", "TARGET_FIELD": "WERKS",
         "SOURCE_VALUE": "5310", "TARGET_VALUE": "CNP1", "ACTIVE": "YES",
         "DESCRIPTION": "Legacy plant to S/4 plant"},
        {"OBJECT": "MATERIAL", "SOURCE_FIELD": "WERKS", "TARGET_FIELD": "WERKS",
         "SOURCE_VALUE": "5336", "TARGET_VALUE": "USP2", "ACTIVE": "YES",
         "DESCRIPTION": "Legacy plant to S/4 plant"},
        {"OBJECT": "*", "SOURCE_FIELD": "MEINS", "TARGET_FIELD": "MEINS",
         "SOURCE_VALUE": "PC", "TARGET_VALUE": "PCE", "ACTIVE": "YES",
         "DESCRIPTION": "Legacy unit of measure to S/4 UOM"},
        {"OBJECT": "*", "SOURCE_FIELD": "MEINS", "TARGET_FIELD": "MEINS",
         "SOURCE_VALUE": "TB", "TARGET_VALUE": "TUB", "ACTIVE": "YES",
         "DESCRIPTION": "Legacy unit of measure to S/4 UOM"},
    ])
