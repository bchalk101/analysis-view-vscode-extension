FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install uv

# Create non-root user first
RUN useradd -r -m -s /bin/false appuser

# Create and set ownership of working directory
RUN mkdir -p /app && chown -R appuser:appuser /app
WORKDIR /app

# Switch to non-root user early
USER appuser

COPY --chown=appuser:appuser pyproject.toml uv.lock ./
COPY --chown=appuser:appuser proto ./proto

RUN uv sync --frozen

COPY --chown=appuser:appuser . .

RUN uv run python -m grpc_tools.protoc \
    --python_out=src/mcp_server \
    --grpc_python_out=src/mcp_server \
    --proto_path=proto \
    proto/analysis.proto

RUN sed -i 's/import analysis_pb2/from . import analysis_pb2/' src/mcp_server/analysis_pb2_grpc.py

EXPOSE 8080

CMD ["uv", "run", "python", "main.py"]