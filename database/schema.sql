-- GenMove schema (PostgreSQL). Run against a database that already exists;
-- see database/setup_postgres.sh to create the database/role first.
-- Note: the app also creates these tables automatically on startup via
-- SQLAlchemy metadata.create_all() -- this file is provided for manual
-- provisioning / review by a DBA.

CREATE TABLE IF NOT EXISTS validation_runs (
    id SERIAL PRIMARY KEY,
    object_name VARCHAR(191) NOT NULL,
    source_file VARCHAR(500),
    target_file VARCHAR(500),
    status VARCHAR(20),
    summary_json TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_validation_runs_object_name ON validation_runs (object_name);

CREATE TABLE IF NOT EXISTS field_results (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    field_name VARCHAR(191) NOT NULL,
    field_label VARCHAR(255),
    target_field VARCHAR(191),
    status VARCHAR(20),
    total INTEGER,
    matched INTEGER,
    mismatched INTEGER
);

CREATE TABLE IF NOT EXISTS record_results (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    field_name VARCHAR(191) NOT NULL,
    record_type VARCHAR(10) NOT NULL,
    record_key VARCHAR(500),
    source_value TEXT,
    target_value TEXT,
    result_detail VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS idx_record_drilldown ON record_results (run_id, field_name, record_type, id);

CREATE TABLE IF NOT EXISTS uploaded_files (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES validation_runs(id) ON DELETE CASCADE,
    file_role VARCHAR(20) NOT NULL,
    file_path VARCHAR(500),
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendations (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    field_name VARCHAR(191) NOT NULL,
    target_field VARCHAR(191),
    severity VARCHAR(20),
    affected_records INTEGER,
    explanation TEXT
);

CREATE TABLE IF NOT EXISTS correction_rules (
    id SERIAL PRIMARY KEY,
    object_name VARCHAR(191) NOT NULL,
    source_field VARCHAR(191) NOT NULL,
    target_field VARCHAR(191) NOT NULL,
    action VARCHAR(100) NOT NULL,
    approved_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    level VARCHAR(20),
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(500) NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL,
    last_login TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS transformation_rules (
    id SERIAL PRIMARY KEY,
    object_name VARCHAR(191) NOT NULL,
    name VARCHAR(255) NOT NULL,
    source_field VARCHAR(191) NOT NULL,
    target_field VARCHAR(191) NOT NULL,
    source_value VARCHAR(500) NOT NULL,
    target_value VARCHAR(500) NOT NULL,
    description TEXT,
    status VARCHAR(40) NOT NULL,
    version VARCHAR(30) NOT NULL,
    created_by VARCHAR(255),
    approved_by VARCHAR(255),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_transformation_rules_object_name ON transformation_rules (object_name);
CREATE INDEX IF NOT EXISTS ix_transformation_rules_status ON transformation_rules (status);

CREATE TABLE IF NOT EXISTS transformation_jobs (
    id SERIAL PRIMARY KEY,
    object_name VARCHAR(191) NOT NULL,
    source_file VARCHAR(500) NOT NULL,
    output_file VARCHAR(500),
    status VARCHAR(40) NOT NULL,
    applied_rules INTEGER,
    changed_rows INTEGER,
    changed_cells INTEGER,
    created_by VARCHAR(255),
    audit_json TEXT,
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_transformation_jobs_object_name ON transformation_jobs (object_name);
