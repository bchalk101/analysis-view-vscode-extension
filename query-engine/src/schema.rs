diesel::table! {
    datasets (id) {
        id -> Text,
        uuid -> Uuid,
        name -> Text,
        description -> Text,
        format -> Text,
        size_bytes -> Int8,
        row_count -> Int4,
        tags -> Array<Text>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
        dataset_path -> Text,
        metadata_path -> Text,
    }
}

diesel::table! {
    dataset_files (dataset_id, filename) {
        dataset_id -> Text,
        filename -> Text,
        storage_path -> Text,
        size_bytes -> Int8,
        row_count -> Int4,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    dataset_columns (dataset_id, name) {
        dataset_id -> Text,
        name -> Text,
        data_type -> Text,
        nullable -> Bool,
        description -> Text,
        statistics -> Jsonb,
    }
}

diesel::table! {
    dataset_statistics (dataset_id, stat_key) {
        dataset_id -> Text,
        stat_key -> Text,
        stat_value -> Text,
    }
}

diesel::joinable!(dataset_files -> datasets (dataset_id));
diesel::joinable!(dataset_columns -> datasets (dataset_id));
diesel::joinable!(dataset_statistics -> datasets (dataset_id));

diesel::allow_tables_to_appear_in_same_query!(
    datasets,
    dataset_files,
    dataset_columns,
    dataset_statistics,
);