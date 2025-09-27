fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_prost_build::configure()
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .compile_protos(&["proto/analysis.proto"], &["proto"])?;

    // Tell cargo to rerun if proto files change
    println!("cargo:rerun-if-changed=proto/analysis.proto");

    Ok(())
}
