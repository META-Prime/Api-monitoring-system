const express = require("express");
const axios = require("axios");
const client = require("prom-client");
const app = express();
const register = new client.Registry();

require("dotenv").config();

client.collectDefaultMetrics({ register });

const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 30000);
const PORT = Number(process.env.MONITOR_PORT || 4000);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY || process.env.openweather_key;

// ====================== METRICS ======================

const requestDuration = new client.Histogram({
  name: "external_api_request_duration_ms",
  help: "Request duration in milliseconds",
  labelNames: ["api", "endpoint"],
  buckets: [50, 100, 250, 500, 1000, 2000, 5000, 10000],
});

const apiUp = new client.Gauge({
  name: "external_api_up",
  help: "API endpoint current status (1=up, 0=down)",
  labelNames: ["api", "endpoint"],
});

const failuresTotal = new client.Counter({
  name: "external_api_failures_total",
  help: "Total failures",
  labelNames: ["api", "endpoint", "reason"],
});

const successesTotal = new client.Counter({
  name: "external_api_successes_total",
  help: "Total successful requests",
  labelNames: ["api", "endpoint"],
});

const requestsTotal = new client.Counter({
  name: "external_api_requests_total",
  help: "Total requests made",
  labelNames: ["api", "endpoint", "result"], // success / failure
});

const lastStatusCode = new client.Gauge({
  name: "external_api_last_status_code",
  help: "Last HTTP status code received",
  labelNames: ["api", "endpoint"],
});

const lastSuccessUnix = new client.Gauge({
  name: "external_api_last_success_unix",
  help: "Unix timestamp of last successful check",
  labelNames: ["api", "endpoint"],
});

const lastCheckUnix = new client.Gauge({
  name: "external_api_last_check_unix",
  help: "Unix timestamp of last check (success or failure)",
  labelNames: ["api", "endpoint"],
});

const checkRunsTotal = new client.Counter({
  name: "external_api_check_runs_total",
  help: "Total number of monitoring cycles executed",
});

const githubRateRemaining = new client.Gauge({
  name: "github_rate_remaining",
  help: "GitHub remaining rate limit",
  labelNames: ["resource"],
});

const githubRateLimit = new client.Gauge({
  name: "github_rate_limit",
  help: "GitHub rate limit",
  labelNames: ["resource"],
});

// Register all metrics
register.registerMetric(requestDuration);
register.registerMetric(apiUp);
register.registerMetric(failuresTotal);
register.registerMetric(successesTotal);
register.registerMetric(requestsTotal);
register.registerMetric(lastStatusCode);
register.registerMetric(lastSuccessUnix);
register.registerMetric(lastCheckUnix);
register.registerMetric(checkRunsTotal);
register.registerMetric(githubRateRemaining);
register.registerMetric(githubRateLimit);

// ====================== PROBE FUNCTION ======================
async function probe(api, endpoint, url, expectedStatus = 200) {
  const start = Date.now();
  const nowUnix = Math.floor(start / 1000);

  lastCheckUnix.labels(api, endpoint).set(nowUnix);

  try {
    const headers = api === "github" 
      ? {
          "User-Agent": "stse-monitor/1.0",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(GITHUB_TOKEN && { Authorization: `Bearer ${GITHUB_TOKEN}` }),
        }
      : { "User-Agent": "stse-monitor/1.0" };

    const res = await axios.get(url, {
      timeout: 10000,
      validateStatus: () => true,
      headers,
    });

    const duration = Date.now() - start;
    requestDuration.labels(api, endpoint).observe(duration);
    lastStatusCode.labels(api, endpoint).set(res.status);

    if (res.status === expectedStatus) {
      apiUp.labels(api, endpoint).set(1);
      successesTotal.labels(api, endpoint).inc();
      requestsTotal.labels(api, endpoint, "success").inc();
      lastSuccessUnix.labels(api, endpoint).set(nowUnix);
    } else {
      apiUp.labels(api, endpoint).set(0);
      failuresTotal.labels(api, endpoint, `http_${res.status}`).inc();
      requestsTotal.labels(api, endpoint, "failure").inc();
    }

    // GitHub Rate Limit Tracking
    if (api === "github" && res.headers["x-ratelimit-remaining"]) {
      githubRateRemaining.labels("core").set(Number(res.headers["x-ratelimit-remaining"]));
      githubRateLimit.labels("core").set(Number(res.headers["x-ratelimit-limit"] || 60));
    }

  } catch (error) {
    const duration = Date.now() - start;
    requestDuration.labels(api, endpoint).observe(duration);
    apiUp.labels(api, endpoint).set(0);
    lastStatusCode.labels(api, endpoint).set(0);

    const reason = error.code ? `network_${error.code}` : "network_unknown";
    failuresTotal.labels(api, endpoint, reason).inc();
    requestsTotal.labels(api, endpoint, "failure").inc();
  }
}

// ====================== CHECKS ======================
async function runChecks() {
  checkRunsTotal.inc();

  const checks = [
    probe("github", "users_octocat", "https://api.github.com/users/octocat"),
    probe("github", "users_octocat_repos", "https://api.github.com/users/octocat/repos"),

    probe("restcountries", "name_ethiopia", "https://restcountries.com/v3.1/name/ethiopia"),
    probe("restcountries", "all", "https://restcountries.com/v3.1/all?fields=name,cca2,population,region,capital"),

    probe("binance", "ping", "https://api.binance.com/api/v3/ping"),
    probe("binance", "server_time", "https://api.binance.com/api/v3/time"),
    probe("binance", "avg_price_btcusdt", "https://api.binance.com/api/v3/avgPrice?symbol=BTCUSDT"),

    probe("binance", "ping_us", "https://api.binance.us/api/v3/ping"),
  ];

  if (OPENWEATHER_KEY) {
    checks.push(
      probe("openweather", "current_london", 
        `https://api.openweathermap.org/data/2.5/weather?q=London&appid=${OPENWEATHER_KEY}`)
    );
  } else {
    apiUp.labels("openweather", "current_london").set(0);
  }

  await Promise.allSettled(checks);
}


app.get("/health", (_, res) => {
  res.json({ ok: true, service: "stse-monitor", interval: CHECK_INTERVAL_MS });
});

app.get("/metrics", async (_, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.get("/summary", async (_req, res) => {
  try {
    const metrics = await register.getMetricsAsJSON();

    const upMetric = metrics.find(m => m.name === "external_api_up");
    const failureMetric = metrics.find(m => m.name === "external_api_failures_total");
    const statusMetric = metrics.find(m => m.name === "external_api_last_status_code");
    const requestMetric = metrics.find(m => m.name === "external_api_requests_total");

    const upServices = (upMetric?.metrics || []).filter(m => m.value === 1);
    const downServices = (upMetric?.metrics || []).filter(m => m.value === 0);

    const totalRequests =
      (requestMetric?.metrics || []).reduce((sum, m) => sum + m.value, 0) || 0;

    const recentFailures = (failureMetric?.metrics || [])
      .slice(-5)
      .map(f => `• ${f.labels.api}/${f.labels.endpoint} → ${f.labels.reason}`);

    const brokenEndpoints = (statusMetric?.metrics || [])
      .filter(m => Number(m.value) !== 200 && m.value !== 1)
      .map(m => `• ${m.labels.api}/${m.labels.endpoint} (HTTP ${m.value})`);

    let summary = `STSE SYSTEM HEALTH SUMMARY (LAST CHECK CYCLE)\n\n`;

    summary += `Overview:\n`;
    summary += `- Healthy endpoints: ${upServices.length}\n`;
    summary += `- Down endpoints: ${downServices.length}\n`;
    summary += `- Total requests observed: ${totalRequests}\n\n`;

    if (brokenEndpoints.length > 0) {
      summary += `Unhealthy Services:\n${brokenEndpoints.join("\n")}\n\n`;
    } else {
      summary += `All endpoints are currently healthy\n\n`;
    }

    if (recentFailures.length > 0) {
      summary += `Recent Failure Reasons:\n${recentFailures.join("\n")}\n`;
    } else {
      summary += ` No recent failures detected\n`;
    }

    res.json({
      summary,
      status: "ok"
    });

  } catch (err) {
    res.status(500).json({
      summary: "Failed to generate system summary",
      error: err.message
    });
  }
});
app.listen(PORT, async () => {
  console.log(`STSE Monitor running on http://localhost:${PORT}`);
  console.log(` Metrics → http://localhost:${PORT}/metrics`);

  await runChecks();
  setInterval(runChecks, CHECK_INTERVAL_MS);
});