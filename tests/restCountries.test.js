const axios = require("axios");
const { performance } = require("perf_hooks");
const BASE = "https://restcountries.com/v3.1";


const ALL_FIELDS = "name,cca2,population,region,capital";


const anyStatus = { validateStatus: () => true };

function msSince(start) {
  return Math.round(performance.now() - start);
}

describe("REST Countries API — functional", () => {
  test("GET /all returns 200, array, non-empty", async () => {
    const start = performance.now();
    const { status, data } = await axios.get(`${BASE}/all`, {
      ...anyStatus,
      params: { fields: ALL_FIELDS },
    });
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(msSince(start)).toBeLessThan(30_000);
  });

  test("GET /name/ethiopia returns 200 with name, population, region, capital", async () => {
    const { status, data } = await axios.get(`${BASE}/name/ethiopia`, anyStatus);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    const c = data[0];
    expect(c.name.common.toLowerCase()).toContain("ethiopia");
    expect(typeof c.population).toBe("number");
    expect(c.region).toBeTruthy();
    expect(Array.isArray(c.capital)).toBe(true);
    expect(c.capital.length).toBeGreaterThan(0);
  });

  test("GET /name/ethiopia?fields=name,capital returns only requested fields", async () => {
    const { status, data } = await axios.get(
      `${BASE}/name/ethiopia`,
      { ...anyStatus, params: { fields: "name,capital" } }
    );
    expect(status).toBe(200);
    const c = data[0];
    expect(c.name).toBeDefined();
    expect(c.capital).toBeDefined();
    expect(c).not.toHaveProperty("population");
    expect(c).not.toHaveProperty("region");
  });
});

describe("REST Countries API — negative", () => {
  test("invalid country name returns 404", async () => {
    const { status, data } = await axios.get(
      `${BASE}/name/thiscountrydoesnotexist999`,
      anyStatus
    );
    expect(status).toBe(404);
    expect(data).toHaveProperty("status", 404);
  });

  test("empty name path returns 404", async () => {
    const { status } = await axios.get(`${BASE}/name/`, anyStatus);
    expect(status).toBe(404);
  });
});

describe("REST Countries API — performance", () => {
  test("GET /all completes in under 1000ms", async () => {
    const start = performance.now();
    const { status } = await axios.get(`${BASE}/all`, {
      ...anyStatus,
      params: { fields: ALL_FIELDS },
    });
    expect(status).toBe(200);
    expect(msSince(start)).toBeLessThan(1000);
  });

  test("GET /name/ethiopia completes in under 1000ms", async () => {
    const start = performance.now();
    const { status } = await axios.get(`${BASE}/name/ethiopia`, anyStatus);
    expect(status).toBe(200);
    expect(msSince(start)).toBeLessThan(1000);
  });
});

describe("REST Countries API — reliability", () => {
  test("multiple parallel requests to /all succeed", async () => {
    const n = 10;
    const results = await Promise.all(
      Array.from({ length: n }, () =>
        axios.get(`${BASE}/all`, {
          ...anyStatus,
          params: { fields: ALL_FIELDS },
        })
      )
    );
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
    }
  });
});
