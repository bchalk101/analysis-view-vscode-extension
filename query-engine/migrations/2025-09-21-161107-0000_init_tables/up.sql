CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    uuid UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    format TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    row_count INTEGER NOT NULL,
    tags TEXT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    dataset_path TEXT NOT NULL,
    metadata_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_files (
    dataset_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    row_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (dataset_id, filename),
    FOREIGN KEY (dataset_id) REFERENCES datasets(id)
);

CREATE TABLE IF NOT EXISTS dataset_columns (
    dataset_id TEXT NOT NULL,
    name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    nullable BOOLEAN NOT NULL,
    description TEXT NOT NULL,
    statistics JSONB NOT NULL,
    PRIMARY KEY (dataset_id, name),
    FOREIGN KEY (dataset_id) REFERENCES datasets(id)
);

CREATE TABLE IF NOT EXISTS dataset_statistics (
    dataset_id TEXT NOT NULL,
    stat_key TEXT NOT NULL,
    stat_value TEXT NOT NULL,
    PRIMARY KEY (dataset_id, stat_key),
    FOREIGN KEY (dataset_id) REFERENCES datasets(id)
);
