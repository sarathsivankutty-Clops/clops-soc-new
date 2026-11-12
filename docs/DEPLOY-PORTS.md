# Deploying with Configurable Host Ports (`clops-soc`)

`docker-compose.yml` parameterises every published host port as `${VAR:-default}` and scopes containers, networks, and volumes under top-level `name: clops-soc` (no `aisoc-*` container/network/volume names). Container-internal ports remain unchanged so internal service-to-service URLs (`http://api:8000`, `kafka:29092`, etc.) continue to work without modification.

## Final Port Table

| Service | Profile | Env Var | Default Host Port | Container Port | Default Bind |
| --- | --- | --- | --- | --- | --- |
| `web` | core | `WEB_PORT` | `13000` | `3000` | `0.0.0.0` |
| `realtime` | core | `REALTIME_PORT` | `18086` | `4000` | `0.0.0.0` |
| `api` | core | `API_PORT` | `18000` | `8000` | `127.0.0.1` |
| `agents` | core | `AGENTS_PORT` | `18001` | `8084` | `127.0.0.1` |
| `actions` | core | `ACTIONS_PORT` | `18002` | `8085` | `127.0.0.1` |
| `fusion` | core | `FUSION_PORT` | `18003` | `8003` | `127.0.0.1` |
| `threatintel` | core | `THREATINTEL_PORT` | `18005` | `8005` | `127.0.0.1` |
| `ingest-worker` (HTTP) | core | `INGEST_HTTP_PORT` | `18081` | `8080` | `127.0.0.1` |
| `ingest-worker` (metrics) | core | `INGEST_METRICS_PORT` | `19090` | `9090` | `127.0.0.1` |
| `connectors` | core | `CONNECTORS_PORT` | `18088` | `8003` | `127.0.0.1` |
| `qdrant` | core | `QDRANT_PORT` | `16333` | `6333` | `127.0.0.1` |
| `litellm` | core | `LITELLM_PORT` | `14000` | `4000` | `127.0.0.1` |
| `ollama` | core | `OLLAMA_PORT` | `21434` | `11434` | `127.0.0.1` |
| `enrichment` | `full` | `ENRICHMENT_PORT` | `18080` | `8082` | `127.0.0.1` |
| `ueba` | `full` | `UEBA_PORT` | `18007` | `8004` | `127.0.0.1` |
| `kafka-ui` | `full` | `KAFKA_UI_PORT` | `18090` | `8080` | `127.0.0.1` |
| `clickhouse` (HTTP) | `full` | `CLICKHOUSE_HTTP_PORT` | `18123` | `8123` | `127.0.0.1` |
| `clickhouse` (native) | `full` | `CLICKHOUSE_NATIVE_PORT` | `19000` | `9000` | `127.0.0.1` |
| `opensearch` | `full` | `OPENSEARCH_PORT` | `19200` | `9200` | `127.0.0.1` |
| `neo4j` (HTTP) | `full` | `NEO4J_HTTP_PORT` | `17474` | `7474` | `127.0.0.1` |
| `neo4j` (Bolt) | `full` | `NEO4J_BOLT_PORT` | `17687` | `7687` | `127.0.0.1` |
| `purple-team` | `extras` | `PURPLE_TEAM_PORT` | `18006` | `8006` | `127.0.0.1` |
| `honeytokens` | `extras` | `HONEYTOKENS_PORT` | `18008` | `8005` | `127.0.0.1` |
| `slack-bot` | `chatops` | `SLACK_BOT_PORT` | `18009` | `8089` | `127.0.0.1` |
| `teams-bot` | `chatops` | `TEAMS_BOT_PORT` | `18010` | `8090` | `127.0.0.1` |
| `osquery-tls` | `osquery` | `OSQUERY_TLS_PORT` | `18091` | `9001` | `127.0.0.1` |
| `mcp` | `mcp` | `MCP_PORT` | `18096` | `8096` | `127.0.0.1` |
| `prometheus` | `monitoring` | `PROMETHEUS_PORT` | `19091` | `9090` | `127.0.0.1` |
| `alertmanager` | `monitoring` | `ALERTMANAGER_PORT` | `19094` | `9093` | `127.0.0.1` |
| `otel-collector` (gRPC) | `monitoring` | `OTEL_GRPC_PORT` | `14317` | `4317` | `127.0.0.1` |
| `otel-collector` (HTTP) | `monitoring` | `OTEL_HTTP_PORT` | `14318` | `4318` | `127.0.0.1` |
| `tempo` | `monitoring` | `TEMPO_PORT` | `13200` | `3200` | `127.0.0.1` |
| `grafana` | `monitoring` | `GRAFANA_PORT` | `13001` | `3000` | `127.0.0.1` |
| `postgres`, `redis`, `kafka`, `zookeeper` | core | *(internal only)* | — | `5432, 6379, 29092, 2181` | *(none)* |

See `.env.ports.example` for the full list of variables.

## Security Group / Firewall Ports

Open **only two** ports externally in your firewall / security group:
- **`WEB_PORT`** (default `13000/tcp`) — Next.js console and same-origin API proxy
- **`REALTIME_PORT`** (default `18086/tcp`) — WebSocket / SSE realtime gateway

All other published services bind strictly to `127.0.0.1`, and `postgres`, `redis`, `kafka`, and `zookeeper` publish no host ports.

## What Needs a Rebuild

Next.js inlines `NEXT_PUBLIC_*` variables at image build time. If you change **`PUBLIC_HOST`**, **`WEB_PORT`**, **`REALTIME_PORT`**, **`NEXT_PUBLIC_WS_URL`**, or **`NEXT_PUBLIC_REALTIME_URL`** in `.env`, rebuild and recreate `web`:

```bash
docker compose build web
docker compose up -d
```

Changes to runtime-only backend ports (e.g., `API_PORT`, `GRAFANA_PORT`, `AISOC_CORS_ORIGINS`) only require `docker compose up -d` (no image rebuild). Run `./scripts/preflight.sh` before starting to confirm no configured host port is in use and no conflicting `clops-soc-*` containers exist.
