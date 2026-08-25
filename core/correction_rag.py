"""Local retrieval-augmented correction memory.

The retriever indexes user-approved correction examples in JSON. The generator is
deliberately deterministic: retrieved evidence may recommend an action, but only
approved ``copy_source_to_target`` rules can be executed.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path


def _tokens(value):
    return set(re.findall(r"[A-Z0-9_]+", str(value or "").upper()))


class CorrectionRAG:
    def __init__(self, path):
        self.path = Path(path)

    def _load(self):
        try:
            return json.loads(self.path.read_text()) if self.path.exists() else []
        except Exception:
            return []

    def _save(self, records):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(records, indent=2))

    @staticmethod
    def _identity(item):
        return (
            str(item.get("object", "")).upper(),
            str(item.get("source_field", "")).upper(),
            str(item.get("target_field", "")).upper(),
            str(item.get("action", "")),
        )

    def remember(self, *, object_name, source_field, target_field, issues, examples,
                 action="copy_source_to_target"):
        records = self._load()
        item = {
            "object": str(object_name).upper(),
            "source_field": str(source_field).upper(),
            "target_field": str(target_field).upper(),
            "issues": sorted(set(str(x) for x in issues if x)),
            "examples": list(examples or [])[:5],
            "action": action,
            "approved_count": 1,
            "last_approved_at": datetime.now().isoformat(timespec="seconds"),
        }
        identity = self._identity(item)
        existing = next((r for r in records if self._identity(r) == identity), None)
        if existing:
            existing["approved_count"] = int(existing.get("approved_count", 0)) + 1
            existing["last_approved_at"] = item["last_approved_at"]
            existing["issues"] = sorted(set(existing.get("issues", [])) | set(item["issues"]))
            existing["examples"] = item["examples"] or existing.get("examples", [])
        else:
            records.append(item)
        self._save(records)
        return existing or item

    def retrieve(self, *, object_name, source_field, target_field, issues, examples, limit=3):
        query_tokens = _tokens(" ".join(
            [object_name, source_field, target_field, *issues] +
            [f"{e.get('source_value', '')} {e.get('target_value', '')}" for e in examples[:3]]
        ))
        scored = []
        for record in self._load():
            score = 0.0
            if record.get("source_field") == str(source_field).upper(): score += 0.45
            if record.get("target_field") == str(target_field).upper(): score += 0.25
            if record.get("object") == str(object_name).upper(): score += 0.20
            record_tokens = _tokens(" ".join(
                [record.get("object", ""), record.get("source_field", ""),
                 record.get("target_field", ""), *record.get("issues", [])]
            ))
            union = query_tokens | record_tokens
            if union: score += 0.10 * len(query_tokens & record_tokens) / len(union)
            if score >= 0.45:
                scored.append({**record, "retrieval_score": round(score, 3)})
        return sorted(scored, key=lambda x: (x["retrieval_score"], x.get("approved_count", 0)), reverse=True)[:limit]

