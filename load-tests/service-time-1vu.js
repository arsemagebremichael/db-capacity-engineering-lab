// =============================================================================
// service-time-1vu.js  —  Uncontended service time (W) per endpoint
// -----------------------------------------------------------------------------
// NOT an incident script. This measures the *service time* of each endpoint with
// exactly one in-flight request, so there is no queueing anywhere: no wait for a
// MySQL pool connection, no InnoDB row-lock wait, no event-loop backlog.
//
// Why this exists: at 50-2000 VUs against a pool of 2 connections, almost all of
// the measured latency is QUEUE time, not service time. Little's Law and the
// pool-capacity math (throughput_max = pool_size / W) need W as an *input*.
// Measuring W under load would be circular.
//
// Run one endpoint at a time so the summary is unambiguous:
//   k6 run -e BASE_URL=http://localhost:3010 -e ENDPOINT=recent load-tests/service-time-1vu.js
//
// ENDPOINT: recent | search | admit | export
// ITERATIONS defaults to 30 (export defaults lower; it is expensive).
// =============================================================================
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ENDPOINT = __ENV.ENDPOINT || 'recent';
const ITERATIONS = Number(__ENV.ITERATIONS || (ENDPOINT === 'export' ? 10 : 30));

export const options = {
  scenarios: {
    service_time: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: ITERATIONS,
      maxDuration: '10m',
    },
  },
  // No thresholds: this is a measurement, not a pass/fail gate.
  summaryTrendStats: ['min', 'avg', 'med', 'p(95)', 'max'],
};

export default function () {
  let res;
  if (ENDPOINT === 'recent') {
    res = http.get(`${BASE_URL}/api/patients/recent`, { timeout: '120s' });
  } else if (ENDPOINT === 'search') {
    res = http.get(`${BASE_URL}/api/patients/search?lastName=Smith`, { timeout: '120s' });
  } else if (ENDPOINT === 'admit') {
    res = http.post(`${BASE_URL}/api/hospitals/1/admit`, JSON.stringify({}), {
      headers: { 'Content-Type': 'application/json' },
      timeout: '120s',
    });
  } else if (ENDPOINT === 'export') {
    res = http.get(`${BASE_URL}/api/patients/export`, { timeout: '120s' });
  } else {
    throw new Error(`unknown ENDPOINT: ${ENDPOINT}`);
  }

  check(res, { 'status is 200': (r) => r.status === 200 });
  // Response body size is itself evidence for OPS-2204 (payload bytes per call).
  console.log(`${ENDPOINT} status=${res.status} bytes=${res.body ? res.body.length : 0} ms=${res.timings.duration.toFixed(1)}`);
}
