FROM rust:1.75 as builder

WORKDIR /app
COPY . .

# Build the application
RUN cargo build --release --bin mcp-server

# Runtime image
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create app user
RUN useradd -r -s /bin/false appuser

# Copy the binary
COPY --from=builder /app/target/release/mcp-server /usr/local/bin/mcp-server
RUN chmod +x /usr/local/bin/mcp-server

USER appuser

EXPOSE 8080

CMD ["mcp-server"]