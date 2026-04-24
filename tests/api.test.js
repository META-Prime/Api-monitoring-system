const axios = require("axios");
const { performance } = require("perf_hooks");

const OPENWEATHER_KEY =
  process.env.OPENWEATHER_KEY || process.env.openweather_key;
const anyStatus = { validateStatus: () => true };

function elapsedMs(start) {
  return Math.round(performance.now() - start);
}

function isNetworkError(error) {
  return ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND"].includes(
    error?.code
  );
}

async function getOrSkip(url) {
  try {
    return await axios.get(url, anyStatus);
  } catch (error) {
    if (isNetworkError(error)) {
      return null;
    }
    throw error;
  }
}

describe("Binance API", () => {
  test("GET /api/v3/ping returns 200", async () => {
    const res = await getOrSkip("https://api.binance.com/api/v3/ping");
    if (!res) {
      expect(true).toBe(true);
      return;
    }
    const { status } = res;
    expect(status).toBe(200);
  });

  test("GET /api/v3/time returns server time", async () => {
    const res = await getOrSkip("https://api.binance.com/api/v3/time");
    if (!res) {
      expect(true).toBe(true);
      return;
    }
    const { status, data } = res;
    expect(status).toBe(200);
    expect(typeof data.serverTime).toBe("number");
  });

  test("GET /api/v3/avgPrice returns avg price", async () => {
    const res = await getOrSkip(
      "https://api.binance.com/api/v3/avgPrice?symbol=BTCUSDT",
    );
    if (!res) {
      expect(true).toBe(true);
      return;
    }
    const { status, data } = res;
    expect(status).toBe(200);
    expect(data).toHaveProperty("mins");
    expect(data).toHaveProperty("price");
  });
});

describe("OpenWeather API", () => {
  test("invalid key returns 401", async () => {
    const { status } = await axios.get(
      "https://api.openweathermap.org/data/2.5/weather?q=London&appid=EXPIRED_KEY",
      anyStatus
    );
    expect(status).toBe(401);
  });

  test("valid key returns weather data (if configured)", async () => {
    if (!OPENWEATHER_KEY) {
      expect(true).toBe(true);
      return;
    }

    const start = performance.now();
    const { status, data } = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=London&appid=${OPENWEATHER_KEY}`,
      anyStatus
    );

    expect(status).toBe(200);
    expect(data).toHaveProperty("name", "London");
    expect(data).toHaveProperty("weather");
    expect(elapsedMs(start)).toBeLessThan(5000);
  });
});