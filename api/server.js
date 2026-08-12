'use strict';

/**
 * server.js
 * -----------------------------------------------------------------------------
 * Express API for the Regional Health admissions & patient-lookup service.
 *
 * Endpoints:
 *   GET  /api/patients/recent        Recent patients widget
 *   GET  /api/patients/search        Patient lookup by last name
 *   POST /api/hospitals/:id/admit    Admit a patient (decrement bed count)
 *   GET  /api/patients/export        Full patient export for the analytics team
 *   GET  /api/audit/ping             Mongo audit-store health probe
 *   GET  /metrics                    Prometheus metrics
 */

const cluster = require('node:cluster');
const express = require('express');
const client = require('prom-client');
const { getPool, getMongo } = require('./database');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);

// Search result paging. A search UI renders a page at a time; returning every
// match is what let one query occupy the single JS thread for ~29ms.
const DEFAULT_PAGE_SIZE = Number(process.env.SEARCH_PAGE_SIZE || 50);
const MAX_PAGE_SIZE = Number(process.env.SEARCH_MAX_PAGE_SIZE || 200);

// ---------------------------------------------------------------------------
// Prometheus metrics
// ---------------------------------------------------------------------------
const register = new client.Registry();
register.setDefaultLabels({ app: 'capacity-api' });

// Default process/GC/heap metrics.
client.collectDefaultMetrics({ register, gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5] });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const dbErrorsTotal = new client.Counter({
  name: 'db_errors_total',
  help: 'Total number of database errors by type',
  labelNames: ['route', 'code'],
  registers: [register],
});

const requestsRejectedTotal = new client.Counter({
  name: 'http_requests_rejected_total',
  help: 'Requests shed by admission control because the server was at capacity',
  labelNames: ['route'],
  registers: [register],
});

// Queue depth — the metric that actually detects this failure mode. Event-loop
// lag does not: it samples per-turn timer delay, so it stays flat when many
// cheap callbacks are queued (measured 10ms mean through a 36x brownout in
// OPS-2202). In-flight count reads the queue directly.
const inFlightGauge = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Requests currently being processed (queue depth on the single JS thread)',
  registers: [register],
});

// Per-request timing + counting middleware
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    const labels = { method: req.method, route, status_code: res.statusCode };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
});

// ---------------------------------------------------------------------------
// Admission control (OPS-2202)
// ---------------------------------------------------------------------------
// The server has ONE JS thread and costs ~0.295ms of it per request => a hard
// ceiling of ~3,391 req/s. Offered 2,000 concurrent requests, it accepted all
// of them (nodejs_active_handles{type="Socket"}=2005) and made every caller
// wait: p95 696ms, 36x baseline, with a 0.00% error rate. Everyone was served
// slowly and nothing was reported as broken.
//
// Bounding in-flight work converts that into a choice: a bounded number of
// callers get service inside SLO, the excess is rejected immediately and
// cheaply. N is sized by Little's Law -- N = lambda x W_target -- not by taste.
//
// The second reason this beats simply adding capacity: shedding makes overload
// VISIBLE. Two incidents so far have run at 0.00% error rate through severe
// brownouts, invisible to error-rate alerting. A 503 is something the paging
// stack already understands.
// N=32 chosen from a measured sweep, not from theory. Little's Law suggested
// N = lambda x W_target = 3,391 x 0.05 = ~170, which measured at ~950ms admitted
// p95 -- badly outside SLO. The sweep (evidence/OPS-2202/fix2-inflight-sweep.txt)
// shows why: rejections are not free (~0.09ms of the same JS thread each), and a
// client that retries instantly turns a tight limit into a rejection storm that
// starves real work. N=32 is the largest limit that still holds admitted p95
// inside the 200ms SLO on this host:
//   N=8   -> p95  96ms, admitted  158 rps, 98.0% shed
//   N=16  -> p95  96ms, admitted  354 rps, 96.1% shed
//   N=32  -> p95 198ms, admitted  627 rps, 93.6% shed   <-- shipped
//   N=64  -> p95 242ms, admitted  452 rps, 93.6% shed
//   N=1024-> p95 2293ms, admitted 1541 rps, 84.6% shed
//   N=4096-> p95 963ms, admitted 3448 rps,  0.0% shed  (= no admission control)
const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT || 32);
let inFlight = 0;

app.use((req, res, next) => {
  // Never shed health or metrics: observability must survive the overload it
  // is there to report, and both are cheap.
  if (req.path === '/health' || req.path === '/metrics') return next();

  if (inFlight >= MAX_INFLIGHT) {
    requestsRejectedTotal.inc({ route: req.path });
    res.set('Retry-After', '1');
    return res.status(503).json({
      error: 'OVERLOADED',
      message: `server at capacity (${MAX_INFLIGHT} in flight)`,
    });
  }

  inFlight += 1;
  inFlightGauge.set(inFlight);
  let released = false;
  const release = () => {
    if (released) return;      // 'finish' and 'close' can both fire
    released = true;
    inFlight -= 1;
    inFlightGauge.set(inFlight);
  };
  res.on('finish', release);
  res.on('close', release);    // client aborted before we responded
  return next();
});

// ---------------------------------------------------------------------------
// Health & metrics
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ---------------------------------------------------------------------------
// Recent patients widget
// ---------------------------------------------------------------------------
app.get('/api/patients/recent', async (_req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      'SELECT * FROM patients ORDER BY id DESC LIMIT 50'
    );
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    dbErrorsTotal.inc({ route: '/api/patients/recent', code: err.code || 'UNKNOWN' });
    res.status(500).json({ error: err.code || 'ERROR', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Patient lookup by last name
// ---------------------------------------------------------------------------
app.get('/api/patients/search', async (req, res) => {
  const lastName = req.query.lastName || '';
  try {
    const pool = getPool();
    // Project only the columns a search result list renders. `notes` is a TEXT
    // column averaging 180 chars/row — ~52% of the serialized payload — and is
    // never shown in a result list. Shipping it made every search response
    // 3.47 MiB, which the single JS thread then had to JSON.stringify.
    // /api/patients/export is a separate handler with its own SQL (see below),
    // so the analytics extract is unaffected by this projection.
    // Bound the number of rows a single search can return. 'Smith' matches
    // 10,000 of 100,000 patients (10 distinct last names in this data set), and
    // materializing all of them cost ~1.23 us/row on the single JS thread
    // regardless of how few columns we select. Row count, not column width, is
    // the remaining term in the serialization cost.
    const limit = Math.min(Number(req.query.limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const [rows] = await pool.query(
      'SELECT id, first_name, last_name, email, diagnosis, created_at FROM patients WHERE last_name = ? ORDER BY id LIMIT ? OFFSET ?',
      [lastName, limit, offset]
    );
    res.json({ count: rows.length, lastName, limit, offset, data: rows });
  } catch (err) {
    dbErrorsTotal.inc({ route: '/api/patients/search', code: err.code || 'UNKNOWN' });
    res.status(500).json({ error: err.code || 'ERROR', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Admit a patient to a hospital (decrement available beds).
// We update the bed count, then notify the regional bed registry that the
// count changed before finalizing, so the two systems stay consistent.
// ---------------------------------------------------------------------------
app.post('/api/hospitals/:id/admit', async (req, res) => {
  const hospitalId = Number(req.params.id);
  const pool = getPool();
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    await conn.query(
      'UPDATE hospitals SET available_beds = available_beds - 1 WHERE id = ?',
      [hospitalId]
    );

    // Notify the external regional bed registry of the new count before we
    // commit (simulated here with a network round-trip latency).
    await notifyBedRegistry(hospitalId);

    await conn.commit();
    res.json({ status: 'admitted', hospitalId });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
    }
    dbErrorsTotal.inc({ route: '/api/hospitals/:id/admit', code: err.code || 'UNKNOWN' });
    res.status(500).json({ error: err.code || 'ERROR', message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Stand-in for the external registry client used by the admit flow.
function notifyBedRegistry(_hospitalId) {
  return new Promise((r) => setTimeout(r, 500));
}

// ---------------------------------------------------------------------------
// Full patient export for the analytics/ETL team.
// ---------------------------------------------------------------------------
app.get('/api/patients/export', async (_req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM patients');
    res.json({ count: rows.length, data: rows });
  } catch (err) {
    dbErrorsTotal.inc({ route: '/api/patients/export', code: err.code || 'UNKNOWN' });
    res.status(500).json({ error: err.code || 'ERROR', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Mongo audit-store health probe
// ---------------------------------------------------------------------------
app.get('/api/audit/ping', async (_req, res) => {
  try {
    const db = await getMongo();
    const result = await db.command({ ping: 1 });
    res.json({ mongo: result });
  } catch (err) {
    res.status(500).json({ error: 'MONGO_ERROR', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Boot — optionally clustered (OPS-2202)
// ---------------------------------------------------------------------------
// Admission control changes the SHAPE of overload (some fail fast, the rest stay
// inside SLO). It does not raise the ceiling. Clustering raises the ceiling by
// running one process per core, since the bottleneck is a single JS thread at
// ~0.295ms/request.
//
// Two costs, both real and both measured in LAB_JOURNAL.md:
//  1. MEMORY. Each worker is a full V8 heap. The container cap is 160MB and a
//     single process already sits at ~98MB RSS, so worker count is bounded by
//     memory long before it is bounded by cores. This is the same budget
//     OPS-2204's export is about to exhaust.
//  2. It does NOT change the collapse shape. At 4x the ceiling and 4x the load
//     you get the same unbounded queue and the same brownout -- it moves the
//     cliff without removing it. That is why admission control ships first.
//
// Metrics caveat: each worker keeps its own prom-client registry, and workers
// share the listening socket, so /metrics returns whichever worker answered.
// With WORKERS>1 the Prometheus numbers are per-worker, not per-service, and
// the clustering measurements below rely on k6 and `docker stats` instead.
const WORKERS = Number(process.env.WORKERS || 1);

if (WORKERS > 1 && cluster.isPrimary) {
  // eslint-disable-next-line no-console
  console.log(`capacity-api primary ${process.pid} forking ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i += 1) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    // eslint-disable-next-line no-console
    console.error(`worker ${worker.process.pid} exited (code=${code} signal=${signal}); forking a replacement`);
    cluster.fork();
  });
} else {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`capacity-api listening on :${PORT} (metrics at /metrics, pid ${process.pid}, in-flight cap ${MAX_INFLIGHT})`);
  });
}
