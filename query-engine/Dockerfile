FROM rust:1.75 AS builder

WORKDIR /app
COPY . .

RUN apt-get update && apt-get install -y protobuf-compiler

RUN cargo build --release --bin query-engine

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -r -s /bin/false appuser

COPY --from=builder /app/target/release/query-engine /usr/local/bin/query-engine
RUN chmod +x /usr/local/bin/query-engine

RUN mkdir -p /data && chown appuser:appuser /data

USER appuser

EXPOSE 50051

CMD ["query-engine"]