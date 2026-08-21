'use strict';

/**
 * database.js
 * -----------------------------------------------------------------------------
 * Connection factories for MySQL and MongoDB.
 */

const mysql = require('mysql2/promise');
const { MongoClient } = require('mongodb');

// ---------------------------------------------------------------------------
// Environment configuration (with defaults for local runs)
// ---------------------------------------------------------------------------
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'mysql-db',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'labpassword',
  database: process.env.MYSQL_DATABASE || 'capacity_lab',

  // OPS-2202. Sized from Little's Law rather than by feel:
  //   N = lambda x W_db = 3,391.6 req/s x 0.0531 ms = 0.18 connections.
  // Two connections were already ~11x more than the measured load needs; during
  // the 2000-VU surge the pool ran at 9.0% utilization and Max_used_connections
  // never exceeded 3. The pool was NOT the bottleneck -- the single JS thread
  // was, at 0.295 ms/req => 3,391 req/s.
  //
  // 25 is set for headroom against the slow path that DOES hold connections:
  // POST /admit holds one for ~508 ms (OPS-2203), so N = lambda x W there is
  // the sizing case, not the fast reads. It is deliberately well under MySQL's
  // max_connections=151.
  //
  // This change is expected to be a NO-OP for throughput; see LAB_JOURNAL.md
  // prediction P3a. It is committed because the old value was wrong for the
  // admit path, not because it fixes OPS-2202.
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 25),
  queueLimit: 0,
  connectTimeout: 10_000,
  maxIdle: 10,
  idleTimeout: 60_000,
  enableKeepAlive: true,
};

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo-db:27017';
const MONGO_DB_NAME = process.env.MONGO_DB || 'capacity_lab';

// ---------------------------------------------------------------------------
// MySQL pool (singleton)
// ---------------------------------------------------------------------------
let pool;

/**
 * Repoint the pool at the credentials resolved from Secrets Manager (C3).
 * Called once at boot, before the first query. Aiven requires TLS.
 */
function applySecret(secret) {
  MYSQL_CONFIG.host = secret.host;
  MYSQL_CONFIG.port = Number(secret.port);
  MYSQL_CONFIG.user = secret.username;
  MYSQL_CONFIG.password = secret.password;
  MYSQL_CONFIG.database = secret.dbname;
  // Aiven enforces TLS. VERIFY_CA would need the CA bundle inside the image;
  // REQUIRED gives an encrypted transport, which is what C3 is about.
  MYSQL_CONFIG.ssl = { rejectUnauthorized: false };
  pool = undefined;
}

/**
 * Pool occupancy for /readyz (C4). mysql2 has used both arrays and Denque for
 * these internals across versions, so read defensively — a readiness probe
 * must never throw.
 */
function poolStats() {
  const size = (c) => {
    if (!c) return 0;
    if (typeof c.length === 'number') return c.length;
    if (typeof c.size === 'function') return c.size();
    return 0;
  };
  const inner = pool && pool.pool ? pool.pool : null;
  if (!inner) return { limit: MYSQL_CONFIG.connectionLimit, all: 0, free: 0, queued: 0 };
  return {
    limit: MYSQL_CONFIG.connectionLimit,
    all: size(inner._allConnections),
    free: size(inner._freeConnections),
    queued: size(inner._connectionQueue),
  };
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool(MYSQL_CONFIG);
  }
  return pool;
}

// ---------------------------------------------------------------------------
// MongoDB client (singleton, lazily connected)
// ---------------------------------------------------------------------------
let mongoClient;
let mongoDb;

async function getMongo() {
  if (!mongoDb) {
    mongoClient = new MongoClient(MONGO_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5_000,
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGO_DB_NAME);
  }
  return mongoDb;
}

// ---------------------------------------------------------------------------
// Graceful shutdown helpers
// ---------------------------------------------------------------------------
async function closeAll() {
  if (pool) {
    try { await pool.end(); } catch (_) { /* ignore */ }
    pool = undefined;
  }
  if (mongoClient) {
    try { await mongoClient.close(); } catch (_) { /* ignore */ }
    mongoClient = undefined;
    mongoDb = undefined;
  }
}

module.exports = {
  MYSQL_CONFIG,
  applySecret,
  poolStats,
  MONGO_URI,
  MONGO_DB_NAME,
  getPool,
  getMongo,
  closeAll,
};
