/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT) || 3000;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  console.error('DATABASE_URL must be a valid PostgreSQL URL');
  process.exit(1);
}

if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  console.error('DATABASE_URL must use the postgres or postgresql protocol');
  process.exit(1);
}

const poolConfig = {
  connectionString: databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

// Render external PostgreSQL hosts require TLS. If DATABASE_URL already has an
// sslmode parameter, node-postgres applies it directly from the URL.
if (parsedDatabaseUrl.hostname.endsWith('.render.com') && !parsedDatabaseUrl.searchParams.has('sslmode')) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.get('/', (_request, response) => {
  response.json({ status: 'WorldSpotBid server is alive and running!' });
});

app.get('/health/database', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Database health check failed:', error.message);
    response.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`WorldSpotBid server listening on port ${port}`);
});

pool.query('SELECT NOW()')
  .then(() => console.log('PostgreSQL connection pool is ready'))
  .catch((error) => console.error('Initial PostgreSQL connection test failed:', error.message));

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    try {
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error('PostgreSQL pool shutdown failed:', error.message);
      process.exit(1);
    }
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

module.exports = { app, pool, server };
