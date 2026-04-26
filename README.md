# STSE Final Project - API Testing and Monitoring

## What to run

- Run all tests: `npm run test:all`
- Run GitHub tests only: `npm run test:github`
- Run REST Countries tests only: `npm run test:rest`
- Run monitoring server: `npm run monitor`





## Monitoring endpoints

- `http://localhost:4000/health`
- `http://localhost:4000/metrics`

From `/metrics`, the project exposes:

- `external_api_up`
- `external_api_request_duration_ms`
- `external_api_failures_total`
- `external_api_success_total`
- `external_api_requests_total`
- `external_api_last_status_code`
- `external_api_last_check_unix`
- `external_api_last_success_unix`
- `external_api_check_runs_total`
- `external_api_network_errors_total`
- `github_rate_limit`
- `github_rate_remaining`
- `github_rate_reset_unix`

## Grafana panels (12 total)

Use these Prometheus queries to build a full API monitoring dashboard:

- **Availability by endpoint (stat):** `external_api_up`
- **P95 latency by endpoint (time series):** `histogram_quantile(0.95, sum by (le, api, endpoint) (rate(external_api_request_duration_ms_bucket[5m])))`
- **P99 latency by endpoint (time series):** `histogram_quantile(0.99, sum by (le, api, endpoint) (rate(external_api_request_duration_ms_bucket[5m])))`
- **Failure rate (time series):** `sum by (api, endpoint) (rate(external_api_failures_total[5m]))`
- **Success rate (time series):** `sum by (api, endpoint) (rate(external_api_success_total[5m]))`
- **Total request throughput (time series):** `sum by (api, endpoint, result) (rate(external_api_requests_total[5m]))`
- **Last HTTP status code (table/stat):** `external_api_last_status_code`
- **Time since last success in seconds (stat):** `time() - external_api_last_success_unix`
- **Time since last check in seconds (stat):** `time() - external_api_last_check_unix`
- **Monitoring cycle counter (stat):** `external_api_check_runs_total`
- **GitHub remaining quota (gauge):** `github_rate_remaining{resource="core"}`
- **GitHub reset timestamp (stat):** `github_rate_reset_unix{resource="core"}`
- **Top network errors by endpoint (bar chart/table):** `sum by (api, endpoint, error_code) (increase(external_api_network_errors_total[15m]))`
