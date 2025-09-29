FROM rust:latest AS builder

RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY build.rs ./
COPY proto ./proto

RUN mkdir src && echo "fn main() {}" > src/main.rs

RUN cargo build --release
RUN rm -rf src

COPY . .

RUN cargo build --release --bin query-engine

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -r -s /bin/false appuser

COPY --from=builder /app/target/release/query-engine /usr/local/bin/query-engine
RUN chmod +x /usr/local/bin/query-engine

RUN mkdir -p /data && chown appuser:appuser /data

USER appuser

EXPOSE 50051

CMD ["query-engine"]