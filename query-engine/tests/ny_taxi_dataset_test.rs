use query_engine_service::engine::AnalysisEngine;
use std::sync::Once;
use uuid::Uuid;

static INIT: Once = Once::new();

fn init_test_logging() {
    INIT.call_once(|| {
        tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .with_test_writer()
            .init();
    });
}

#[tokio::test]
async fn test_basic_flow_registering_and_querying_ny_taxi_dataset() {
    init_test_logging();

    // Given: A configured analysis engine and NYC taxi dataset directory
    let bucket_name = "agentic_analytics_datasets".to_string();
    let test_id = Uuid::new_v4();
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://analysis_user:analysis_password@localhost:5432/analysis_catalog".to_string());

    let engine = AnalysisEngine::new(bucket_name, database_url)
        .await
        .expect("Failed to create analysis engine");
    let dataset_path = "gs://agentic_analytics_datasets/datasets/ny_taxi_dataset/";
    let dataset_name = format!("NYC Taxi Dataset - Aggregation Test - {}", test_id);
    let dataset_description = Some("NYC taxi trip data for aggregation testing".to_string());
    let tags = Some(vec!["taxi".to_string(), "nyc".to_string()]);

    // When: Loading the dataset from external GCS directory
    let add_dataset_result = engine
        .add_dataset_from_external_path(
            dataset_name,
            dataset_path.to_string(),
            dataset_description,
            tags,
            Some("csv".to_string()),
        )
        .await;

    // Then: Dataset should be successfully loaded
    assert!(
        add_dataset_result.is_ok(),
        "{}",
        add_dataset_result
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default()
    );

    let dataset_id = add_dataset_result.unwrap();

    // And: Dataset should appear in the catalog
    let datasets = engine.list_datasets().await;
    assert!(!datasets.is_empty(), "Should have at least one dataset");
    assert!(
        datasets.iter().any(|d| d.id == dataset_id),
        "Dataset should be listed in available datasets"
    );

    // When
    let metadata = engine.get_metadata(&dataset_id).await;
    assert!(
        metadata.is_ok(),
        "{}",
        metadata.err().map(|e| e.to_string()).unwrap_or_default()
    );
    let metadata = metadata.unwrap();
    assert!(
        metadata
            .columns
            .iter()
            .any(|col| col.name == "trip_distance"),
        "Metadata should contain trip_distance column, found: {:?}",
        metadata.columns
    );

    // When: Executing an aggregation query with filtering
    let aggregation_query = "SELECT AVG(trip_distance) as avg_distance, COUNT(*) as total_trips FROM base WHERE trip_distance > 0 LIMIT 1";
    let query_result = engine
        .execute_query(&dataset_id, aggregation_query, Some(1))
        .await;

    // Then: Aggregation query should execute successfully
    assert!(
        query_result.is_ok(),
        "{}",
        query_result
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default()
    );

    let result = query_result.unwrap();
    assert!(
        !result.chunks.is_empty(),
        "Should return at least one chunk"
    );

    // And: Results should contain expected aggregation columns
    if let Some(metadata) = result.metadata {
        assert_eq!(
            metadata.column_names.len(),
            2,
            "Should return two columns: avg_distance and total_trips"
        );
        assert!(
            metadata
                .column_names
                .iter()
                .any(|col| col == "avg_distance"),
            "Should contain avg_distance column"
        );
        assert!(
            metadata.column_names.iter().any(|col| col == "total_trips"),
            "Should contain total_trips column"
        );
    }
}
