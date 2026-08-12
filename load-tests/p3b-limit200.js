// P3b — out-of-sample test of the OPS-2201 cost model at limit=200.
// Identical shape to reproduce-OPS-2201.js; only the page size differs.
import http from 'k6/http';
import { check } from 'k6';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const options = {
  scenarios: { p3b: { executor: 'constant-vus', vus: 200, duration: '30s' } },
};
export default function () {
  const res = http.get(`${BASE_URL}/api/patients/search?lastName=Smith&limit=200`);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
