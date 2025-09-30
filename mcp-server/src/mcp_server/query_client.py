import io
import logging

import grpc
import pyarrow as pa

from .analysis_pb2 import (
    Dataset,
    DatasetMetadata,
    ExecuteQueryRequest,
    GetMetadataRequest,
    ListDatasetsRequest,
)
from .analysis_pb2_grpc import AnalysisServiceStub

logger = logging.getLogger(__name__)


class QueryResult:
    def __init__(
        self,
        rows: list[dict[str, str]],
        column_names: list[str],
        total_rows: int,
        execution_time_ms: int,
    ):
        self.rows = rows
        self.column_names = column_names
        self.total_rows = total_rows
        self.execution_time_ms = execution_time_ms


class QueryEngineClient:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint.replace("https://", "").replace("http://", "")
        self.use_ssl = "https://" in endpoint or ":443" in endpoint
        self._channel = None
        self._stub = None

    @property
    def channel(self):
        if self._channel is None:
            if self.use_ssl:
                credentials = grpc.ssl_channel_credentials()
                self._channel = grpc.aio.secure_channel(self.endpoint, credentials)
            else:
                self._channel = grpc.aio.insecure_channel(self.endpoint)
        return self._channel

    @property
    def stub(self):
        if self._stub is None:
            self._stub = AnalysisServiceStub(self.channel)
        return self._stub

    async def close(self) -> None:
        if self._channel:
            await self._channel.close()
            self._channel = None
            self._stub = None

    async def list_datasets(self) -> list[Dataset]:
        request = ListDatasetsRequest()
        response = await self.stub.ListDatasets(request)
        return list(response.datasets)

    async def get_metadata(self, dataset_id: str) -> DatasetMetadata | None:
        request = GetMetadataRequest(dataset_id=dataset_id)
        response = await self.stub.GetMetadata(request)
        return response.metadata if response.HasField("metadata") else None

    async def execute_query(
        self, dataset_id: str, sql_query: str, limit: int | None = None
    ) -> QueryResult:
        request = ExecuteQueryRequest(
            dataset_id=dataset_id, sql_query=sql_query, limit=limit or 1000
        )

        all_rows = []
        column_names = []
        total_execution_time = 0

        stream = self.stub.ExecuteQuery(request)
        async for response in stream:
            if response.HasField("metadata"):
                column_names = list(response.metadata.column_names)
                logger.info(f"Received metadata with {len(column_names)} columns")

            elif response.HasField("data_chunk"):
                chunk_rows = self._convert_arrow_ipc_to_rows(
                    response.data_chunk.arrow_ipc_data, column_names
                )
                all_rows.extend(chunk_rows)
                logger.info(f"Processed chunk with {response.data_chunk.chunk_rows} rows")

            elif response.HasField("complete"):
                try:
                    total_execution_time = int(response.complete.execution_time_ms)
                except ValueError:
                    total_execution_time = 0
                logger.info(f"Query completed in {total_execution_time}ms")
                break

        return QueryResult(
            rows=all_rows,
            column_names=column_names,
            total_rows=len(all_rows),
            execution_time_ms=total_execution_time,
        )

    def _convert_arrow_ipc_to_rows(
        self, arrow_data: bytes, column_names: list[str]
    ) -> list[dict[str, str]]:
        logger.info(
            f"Converting Arrow IPC data ({len(arrow_data)} bytes) to rows "
            f"for {len(column_names)} columns"
        )

        if not arrow_data:
            return []

        try:
            reader = pa.ipc.open_stream(io.BytesIO(arrow_data))
            all_rows = []

            for batch in reader:
                for row_idx in range(batch.num_rows):
                    row = {}
                    for col_idx, column_name in enumerate(column_names):
                        if col_idx < batch.num_columns:
                            column = batch.column(col_idx)
                            value = self._extract_arrow_value_as_string(column, row_idx)
                            row[column_name] = value
                    all_rows.append(row)

            logger.info(f"Successfully converted Arrow IPC data to {len(all_rows)} rows")
            return all_rows

        except Exception as e:
            logger.error(f"Failed to convert Arrow IPC data: {e}")
            return []

    def _extract_arrow_value_as_string(self, column: pa.Array, index: int) -> str:
        if column.is_null(index):
            return "NULL"

        try:
            value = column[index].as_py()
            return str(value) if value is not None else "NULL"
        except Exception:
            return "ERROR"

    async def health_check(self) -> bool:
        try:
            await self.list_datasets()
            return True
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False
