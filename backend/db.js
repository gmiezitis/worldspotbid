import pg from 'pg';

const { Pool } = pg;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(name, fallback, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function postgresConnectionString() {
  const connectionString = requiredEnvironment('DATABASE_URL');
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol');
  }

  // Render external database hosts require TLS. The internal Render hostname is
  // private-network traffic and does not require this query parameter.
  if (url.hostname.endsWith('.render.com') && !url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
  }
  return url.toString();
}

export const pool = new Pool({
  connectionString: postgresConnectionString(),
  max: positiveInteger('DB_POOL_MAX', 10, 50),
  min: 0,
  connectionTimeoutMillis: positiveInteger('DB_CONNECT_TIMEOUT_MS', 5_000, 60_000),
  idleTimeoutMillis: positiveInteger('DB_IDLE_TIMEOUT_MS', 30_000, 300_000),
  maxLifetimeSeconds: positiveInteger('DB_CONNECTION_LIFETIME_SECONDS', 300, 3_600),
  statement_timeout: positiveInteger('DB_STATEMENT_TIMEOUT_MS', 15_000, 120_000),
  query_timeout: positiveInteger('DB_QUERY_TIMEOUT_MS', 20_000, 180_000),
  application_name: 'worldspotbid-api',
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', { message: error.message });
});

export function query(text, values = []) {
  return pool.query(text, values);
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('PostgreSQL rollback failed', { message: rollbackError.message });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabase() {
  const result = await pool.query('SELECT 1 AS healthy');
  return result.rows[0]?.healthy === 1;
}

export function poolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export function closePool() {
  return pool.end();
}
