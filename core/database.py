"""Optional persistent database layer for GenMove.

Set DATABASE_URL to enable it, for example:
mysql+pymysql://genmove:change-me@127.0.0.1:3306/genmove
"""
from __future__ import annotations
import json
import os
from datetime import datetime


class DatabaseStore:
    TABLE_MAP = {
        "validation_runs": "runs", "field_results": "fields",
        "record_results": "records", "uploaded_files": "uploads",
        "recommendations": "recommendations", "correction_rules": "rules",
        "audit_log": "audit",
        "transformation_rules": "transform_rules", "transformation_jobs": "transform_jobs",
    }
    def __init__(self, database_url=""):
        self.database_url = database_url.strip()
        self.engine = None
        self.error = "Database disabled (DATABASE_URL is not set)"
        self.tables = {}
        if self.database_url:
            self._connect()

    @classmethod
    def from_environment(cls):
        url = os.environ.get("DATABASE_URL", "").strip()
        if not url and os.environ.get("MYSQL_HOST"):
            from urllib.parse import quote_plus
            user = quote_plus(os.environ.get("MYSQL_USER", "genmove"))
            password = quote_plus(os.environ.get("MYSQL_PASSWORD", ""))
            host = os.environ.get("MYSQL_HOST", "127.0.0.1")
            port = os.environ.get("MYSQL_PORT", "3306")
            database = os.environ.get("MYSQL_DATABASE", "genmove")
            url = f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}"
        return cls(url)

    @property
    def enabled(self):
        return self.engine is not None

    def _connect(self):
        try:
            from sqlalchemy import (create_engine, MetaData, Table, Column, Integer,
                                    String, Text, DateTime, ForeignKey, Index)
            self.engine = create_engine(self.database_url, pool_pre_ping=True,
                                        pool_recycle=1800, future=True)
            metadata = MetaData()
            runs = Table(
                "validation_runs", metadata,
                Column("id", Integer, primary_key=True, autoincrement=True),
                Column("object_name", String(191), nullable=False, index=True),
                Column("source_file", String(500)), Column("target_file", String(500)),
                Column("status", String(20)), Column("summary_json", Text, nullable=False),
                Column("created_at", DateTime, nullable=False),
            )
            fields = Table(
                "field_results", metadata,
                Column("id", Integer, primary_key=True, autoincrement=True),
                Column("run_id", Integer, ForeignKey("validation_runs.id", ondelete="CASCADE"), nullable=False),
                Column("field_name", String(191), nullable=False),
                Column("field_label", String(255)), Column("target_field", String(191)),
                Column("status", String(20)), Column("total", Integer),
                Column("matched", Integer), Column("mismatched", Integer),
            )
            records = Table(
                "record_results", metadata,
                Column("id", Integer, primary_key=True, autoincrement=True),
                Column("run_id", Integer, ForeignKey("validation_runs.id", ondelete="CASCADE"), nullable=False),
                Column("field_name", String(191), nullable=False),
                Column("record_type", String(10), nullable=False),
                Column("record_key", String(500)), Column("source_value", Text),
                Column("target_value", Text), Column("result_detail", String(500)),
            )
            Index("idx_record_drilldown", records.c.run_id, records.c.field_name,
                  records.c.record_type, records.c.id)
            uploads = Table(
                "uploaded_files", metadata,
                Column("id", Integer, primary_key=True, autoincrement=True),
                Column("run_id", Integer, ForeignKey("validation_runs.id", ondelete="CASCADE")),
                Column("file_role", String(20), nullable=False), Column("file_path", String(500)),
                Column("created_at", DateTime, nullable=False),
            )
            recommendations = Table(
                "recommendations", metadata,
                Column("id", Integer, primary_key=True, autoincrement=True),
                Column("run_id", Integer, ForeignKey("validation_runs.id", ondelete="CASCADE"), nullable=False),
                Column("field_name", String(191), nullable=False),
                Column("target_field", String(191)), Column("severity", String(20)),
                Column("affected_records", Integer), Column("explanation", Text),
            )
            correction_rules = Table(
                "correction_rules", metadata,
                Column("id", Integer, primary_key=True, autoincrement=True),
                Column("object_name", String(191), nullable=False),
                Column("source_field", String(191), nullable=False),
                Column("target_field", String(191), nullable=False),
                Column("action", String(100), nullable=False),
                Column("approved_at", DateTime, nullable=False),
            )
            audit = Table(
                "audit_log", metadata,
                Column("id", Integer, primary_key=True, autoincrement=True),
                Column("level", String(20)), Column("message", Text, nullable=False),
                Column("created_at", DateTime, nullable=False),
            )
            users = Table(
                "users", metadata,
                Column("id", Integer, primary_key=True, autoincrement=True),
                Column("email", String(255), nullable=False, unique=True),
                Column("display_name", String(255), nullable=False),
                Column("password_hash", String(500), nullable=False),
                Column("active", Integer, nullable=False, default=1),
                Column("created_at", DateTime, nullable=False),
                Column("last_login", DateTime),
            )
            transform_rules = Table(
                "transformation_rules", metadata,
                Column("id", Integer, primary_key=True, autoincrement=True),
                Column("object_name", String(191), nullable=False, index=True),
                Column("name", String(255), nullable=False),
                Column("source_field", String(191), nullable=False),
                Column("target_field", String(191), nullable=False),
                Column("source_value", String(500), nullable=False),
                Column("target_value", String(500), nullable=False),
                Column("description", Text), Column("status", String(40), nullable=False),
                Column("version", String(30), nullable=False),
                Column("created_by", String(255)), Column("approved_by", String(255)),
                Column("created_at", DateTime, nullable=False), Column("updated_at", DateTime, nullable=False),
            )
            transform_jobs = Table(
                "transformation_jobs", metadata,
                Column("id", Integer, primary_key=True, autoincrement=True),
                Column("object_name", String(191), nullable=False),
                Column("source_file", String(500), nullable=False),
                Column("output_file", String(500)), Column("status", String(40), nullable=False),
                Column("applied_rules", Integer), Column("changed_rows", Integer),
                Column("changed_cells", Integer), Column("created_by", String(255)),
                Column("audit_json", Text), Column("created_at", DateTime, nullable=False),
            )
            self.tables = {"runs": runs, "fields": fields, "records": records,
                           "uploads": uploads, "recommendations": recommendations,
                           "rules": correction_rules, "audit": audit, "users": users,
                           "transform_rules": transform_rules, "transform_jobs": transform_jobs}
            metadata.create_all(self.engine)
            with self.engine.connect() as conn:
                conn.execute(runs.select().limit(1))
            self.error = ""
        except Exception as exc:
            self.engine = None
            self.error = str(exc)

    def status(self):
        return {"enabled": self.enabled,
                "backend": self.database_url.split(":", 1)[0] if self.database_url else "memory",
                "error": self.error or None}

    def list_tables(self):
        """Return approved application tables only; never expose arbitrary SQL."""
        return list(self.TABLE_MAP.keys()) if self.enabled else []

    def get_table_page(self, table_name, page=1, page_size=100):
        if not self.enabled or table_name not in self.TABLE_MAP:
            return None
        from sqlalchemy import select, func
        table = self.tables[self.TABLE_MAP[table_name]]
        page_size = min(500, max(10, int(page_size)))
        page = max(1, int(page))
        with self.engine.connect() as conn:
            total = conn.execute(select(func.count()).select_from(table)).scalar_one()
            query = select(table)
            if "id" in table.c:
                query = query.order_by(table.c.id.desc())
            rows = conn.execute(query.offset((page - 1) * page_size)
                                .limit(page_size)).mappings().all()
        return {"table": table_name, "columns": [column.name for column in table.columns],
                "rows": [{key: (value.isoformat(sep=" ") if hasattr(value, "isoformat") else value)
                          for key, value in row.items()} for row in rows],
                "page": page, "page_size": page_size, "total": total,
                "pages": max(1, (total + page_size - 1) // page_size)}

    def get_table_export(self, table_name, limit=100000):
        if not self.enabled or table_name not in self.TABLE_MAP:
            return None
        from sqlalchemy import select
        table = self.tables[self.TABLE_MAP[table_name]]
        query = select(table)
        if "id" in table.c:
            query = query.order_by(table.c.id.desc())
        with self.engine.connect() as conn:
            rows = conn.execute(query.limit(limit)).mappings().all()
        return [column.name for column in table.columns], rows

    def get_workspace_summary(self):
        if not self.enabled:
            return {"validation_runs": 0, "passed_runs": 0, "failed_runs": 0,
                    "record_results": 0, "recommendations": 0, "recent_runs": []}
        from sqlalchemy import select, func
        runs, records = self.tables["runs"], self.tables["records"]
        recommendations = self.tables["recommendations"]
        with self.engine.connect() as conn:
            total_runs = conn.execute(select(func.count()).select_from(runs)).scalar_one()
            total_records = conn.execute(select(func.count()).select_from(records)).scalar_one()
            total_recommendations = conn.execute(
                select(func.count()).select_from(recommendations)).scalar_one()
            statuses = dict(conn.execute(select(runs.c.status, func.count()).group_by(runs.c.status)).all())
            recent = conn.execute(select(runs.c.object_name, runs.c.status, runs.c.created_at)
                                  .order_by(runs.c.id.desc()).limit(5)).mappings().all()
        return {"validation_runs": total_runs, "passed_runs": statuses.get("PASS", 0),
                "failed_runs": statuses.get("FAIL", 0), "warning_runs": statuses.get("WARNING", 0),
                "record_results": total_records, "recommendations": total_recommendations,
                "recent_runs": [{"name": row["object_name"], "status": row["status"],
                    "created_at": row["created_at"].isoformat(sep=" ") if row["created_at"] else ""}
                    for row in recent]}

    def save_validation(self, result, cached_details):
        if not self.enabled:
            return False
        from sqlalchemy import insert
        summary = json.loads(json.dumps(result, default=str))
        for row in summary.get("field_results", []):
            row.pop("matches", None)
            row["mismatches"] = row.get("mismatches", [])[:20]
        runs, fields, records = self.tables["runs"], self.tables["fields"], self.tables["records"]
        with self.engine.begin() as conn:
            inserted = conn.execute(insert(runs).values(
                object_name=str(result.get("name", "")).upper(),
                source_file=str(result.get("source_file", "")),
                target_file=str(result.get("target_file", "")), status=str(result.get("status", "")),
                summary_json=json.dumps(summary), created_at=datetime.now()))
            run_id = inserted.inserted_primary_key[0]
            conn.execute(insert(self.tables["uploads"]), [
                {"run_id": run_id, "file_role": "source", "file_path": str(result.get("source_file", "")),
                 "created_at": datetime.now()},
                {"run_id": run_id, "file_role": "target", "file_path": str(result.get("target_file", "")),
                 "created_at": datetime.now()},
            ])
            field_rows, record_rows = [], []
            for fr in result.get("field_results", []):
                field_name = str(fr.get("field", "")).upper()
                detail = cached_details.get(field_name, {})
                field_rows.append({"run_id": run_id, "field_name": field_name,
                    "field_label": detail.get("label", field_name),
                    "target_field": detail.get("target_field", field_name),
                    "status": fr.get("status", ""), "total": fr.get("total", 0),
                    "matched": fr.get("matched", 0), "mismatched": fr.get("mismatched", 0)})
                for kind, rows in (("PASS", detail.get("matches", [])),
                                   ("FAIL", detail.get("mismatches", []))):
                    for row in rows:
                        record_rows.append({"run_id": run_id, "field_name": field_name,
                            "record_type": kind, "record_key": str(row.get("material", "")),
                            "source_value": str(row.get("source_value", "")),
                            "target_value": str(row.get("target_value", "")),
                            "result_detail": str(row.get("result") or row.get("issue") or "")})
            if field_rows:
                conn.execute(insert(fields), field_rows)
            recommendation_rows = [{"run_id": run_id,
                "field_name": str(rec.get("field", "")).upper(),
                "target_field": str(rec.get("target_field", "")).upper(),
                "severity": str(rec.get("severity", "")),
                "affected_records": int(rec.get("affected_records", 0) or 0),
                "explanation": str(rec.get("explanation", ""))}
                for rec in result.get("recommendations", [])]
            if recommendation_rows:
                conn.execute(insert(self.tables["recommendations"]), recommendation_rows)
            for start in range(0, len(record_rows), 2000):
                conn.execute(insert(records), record_rows[start:start + 2000])
        return True

    def get_record_page(self, object_name, field_name, record_type, page=1, page_size=500):
        if not self.enabled:
            return None
        from sqlalchemy import select, func, and_
        runs, fields, records = self.tables["runs"], self.tables["fields"], self.tables["records"]
        with self.engine.connect() as conn:
            run_id = conn.execute(select(runs.c.id).where(
                runs.c.object_name == object_name.upper()).order_by(runs.c.id.desc()).limit(1)).scalar()
            if not run_id:
                return None
            info = conn.execute(select(fields).where(and_(fields.c.run_id == run_id,
                fields.c.field_name == field_name.upper()))).mappings().first()
            condition = and_(records.c.run_id == run_id,
                records.c.field_name == field_name.upper(), records.c.record_type == record_type.upper())
            total = conn.execute(select(func.count()).select_from(records).where(condition)).scalar_one()
            rows = conn.execute(select(records.c.record_key, records.c.source_value,
                records.c.target_value, records.c.result_detail).where(condition)
                .order_by(records.c.id).offset((page - 1) * page_size).limit(page_size)).mappings().all()
        return {"rows": [{"material": r["record_key"], "source_value": r["source_value"],
            "target_value": r["target_value"], "result": r["result_detail"],
            "issue": r["result_detail"]} for r in rows], "total": total,
            "label": info["field_label"] if info else field_name,
            "target_field": info["target_field"] if info else field_name}

    def save_correction_rule(self, object_name, source_field, target_field,
                             action="copy_source_to_target"):
        if not self.enabled:
            return False
        from sqlalchemy import insert
        with self.engine.begin() as conn:
            conn.execute(insert(self.tables["rules"]).values(
                object_name=object_name.upper(), source_field=source_field.upper(),
                target_field=target_field.upper(), action=action, approved_at=datetime.now()))
        return True

    def log_event(self, message, level="info"):
        if not self.enabled:
            return False
        from sqlalchemy import insert
        with self.engine.begin() as conn:
            conn.execute(insert(self.tables["audit"]).values(
                level=level, message=message, created_at=datetime.now()))
        return True

    def get_user_by_email(self, email):
        if not self.enabled:
            return None
        from sqlalchemy import select
        with self.engine.connect() as conn:
            row = conn.execute(select(self.tables["users"]).where(
                self.tables["users"].c.email == email.strip().lower())).mappings().first()
        return dict(row) if row else None

    def create_user(self, email, display_name, password_hash):
        if not self.enabled or self.get_user_by_email(email):
            return None
        from sqlalchemy import insert
        with self.engine.begin() as conn:
            result = conn.execute(insert(self.tables["users"]).values(
                email=email.strip().lower(), display_name=display_name.strip(),
                password_hash=password_hash, active=1, created_at=datetime.now()))
        return result.inserted_primary_key[0]

    def mark_user_login(self, user_id):
        if not self.enabled:
            return
        from sqlalchemy import update
        with self.engine.begin() as conn:
            conn.execute(update(self.tables["users"]).where(
                self.tables["users"].c.id == user_id).values(last_login=datetime.now()))

    def list_transform_rules(self, status=None):
        if not self.enabled: return []
        from sqlalchemy import select
        table = self.tables["transform_rules"]
        query = select(table)
        if status: query = query.where(table.c.status == status.upper())
        with self.engine.connect() as conn:
            rows = conn.execute(query.order_by(table.c.updated_at.desc())).mappings().all()
        return [{k: (v.isoformat(sep=" ") if hasattr(v, "isoformat") else v) for k, v in row.items()} for row in rows]

    def save_transform_rule(self, payload, actor):
        if not self.enabled: return None
        from sqlalchemy import insert, update
        table = self.tables["transform_rules"]; now = datetime.now()
        values = {"object_name": str(payload.get("object_name", "*")).upper(),
            "name": str(payload.get("name", "Transformation rule")),
            "source_field": str(payload.get("source_field", "")).upper(),
            "target_field": str(payload.get("target_field", "")).upper(),
            "source_value": str(payload.get("source_value", "")),
            "target_value": str(payload.get("target_value", "")),
            "description": str(payload.get("description", "")),
            "status": str(payload.get("status", "DRAFT")).upper(),
            "version": str(payload.get("version", "1.0")), "updated_at": now}
        with self.engine.begin() as conn:
            if payload.get("id"):
                conn.execute(update(table).where(table.c.id == int(payload["id"])).values(**values))
                return int(payload["id"])
            values.update({"created_by": actor, "created_at": now})
            return conn.execute(insert(table).values(**values)).inserted_primary_key[0]

    def set_transform_rule_status(self, rule_id, status, actor):
        if not self.enabled: return False
        from sqlalchemy import update
        table = self.tables["transform_rules"]
        values = {"status": status.upper(), "updated_at": datetime.now()}
        if status.upper() == "APPROVED": values["approved_by"] = actor
        with self.engine.begin() as conn:
            result = conn.execute(update(table).where(table.c.id == int(rule_id)).values(**values))
        return bool(result.rowcount)

    def get_approved_transform_rules(self, object_name):
        rows = self.list_transform_rules("APPROVED")
        name = str(object_name).upper()
        return [{"OBJECT": r["object_name"], "SOURCE_FIELD": r["source_field"],
                 "TARGET_FIELD": r["target_field"], "SOURCE_VALUE": r["source_value"],
                 "TARGET_VALUE": r["target_value"], "ACTIVE": "YES",
                 "DESCRIPTION": r.get("description", ""), "ROW_NUMBER": r["id"]}
                for r in rows if r["object_name"] in {"*", name}]

    def save_transform_job(self, payload):
        if not self.enabled: return None
        from sqlalchemy import insert
        values = dict(payload); values["audit_json"] = json.dumps(values.pop("audit", []), default=str)
        values["created_at"] = datetime.now()
        with self.engine.begin() as conn:
            return conn.execute(insert(self.tables["transform_jobs"]).values(**values)).inserted_primary_key[0]

    def list_transform_jobs(self, limit=100):
        if not self.enabled: return []
        from sqlalchemy import select
        table = self.tables["transform_jobs"]
        with self.engine.connect() as conn:
            rows = conn.execute(select(table).order_by(table.c.id.desc()).limit(limit)).mappings().all()
        return [{k: (v.isoformat(sep=" ") if hasattr(v, "isoformat") else v) for k, v in row.items()} for row in rows]
