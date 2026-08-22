import { randomUUID } from 'node:crypto';
import http from 'node:http';
import Stripe from 'stripe';
import { checkDatabase, closePool, poolStats } from './db.js';

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function portNumber() {
  const value = Number(process.env.PORT ?? 3001);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error('PORT must be a valid TCP port');
  }
  return value;
}

const nodeEnvironment = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnvironment === 'production';
const port = portNumber();
const host = '0.0.0.0';

export const stripe = new Stripe(requiredEnvironment('STRIPE_SECRET_KEY'), {
  maxNetworkRetries: 2,
  timeout: 10_000,
  appInfo: { name: 'WorldSpotBid', version: '1.0.0' },
});

let shuttingDown = false;

function securityHeaders(requestId) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': isProduction ? 'max-age=31536000; includeSubDomains' : 'max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Request-Id': requestId,
  };
}

function sendJson(response, status, payload, requestId, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...securityHeaders(requestId),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

async function handleRequest(request, response) {
  const requestId = request.headers['x-request-id']?.toString().slice(0, 100) || randomUUID();
  const method = request.method ?? 'GET';
  let pathname;
  try {
    pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
  } catch {
    sendJson(response, 400, { error: 'Invalid request URL', requestId }, requestId);
    return;
  }

  try {
    if (method === 'GET' && pathname === '/health') {
      sendJson(response, 200, { status: 'ok', service: 'worldspotbid-api', requestId }, requestId);
      return;
    }

    if (method === 'GET' && pathname === '/ready') {
      if (shuttingDown) {
        sendJson(response, 503, { status: 'shutting_down', requestId }, requestId);
        return;
      }
      const databaseHealthy = await checkDatabase();
      sendJson(response, databaseHealthy ? 200 : 503, {
        status: databaseHealthy ? 'ready' : 'not_ready',
        database: databaseHealthy ? 'connected' : 'unavailable',
        stripe: 'configured',
        pool: poolStats(),
        requestId,
      }, requestId);
      return;
    }

    sendJson(response, 404, { error: 'Not found', requestId }, requestId);
  } catch (error) {
    console.error('Request failed', { requestId, method, pathname, message: error.message });
    sendJson(response, 503, { error: 'Service temporarily unavailable', requestId }, requestId, { 'Retry-After': '5' });
  }
}

export const server = http.createServer((request, response) => {
  void handleRequest(request, response);
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

server.on('clientError', (error, socket) => {
  console.warn('Rejected malformed HTTP request', { code: error.code });
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down`);

  const forcedExit = setTimeout(() => {
    console.error('Graceful shutdown timed out');
    process.exit(1);
  }, 12_000);
  forcedExit.unref();

  server.close(async (error) => {
    if (error) console.error('HTTP server close failed', { message: error.message });
    try {
      await closePool();
      clearTimeout(forcedExit);
      process.exit(error ? 1 : 0);
    } catch (poolError) {
      console.error('PostgreSQL pool close failed', { message: poolError.message });
      process.exit(1);
    }
  });
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await checkDatabase();
  server.listen(port, host, () => {
    console.log(`WorldSpotBid API listening on ${host}:${port} (${nodeEnvironment})`);
  });
} catch (error) {
  console.error('Backend startup failed', { message: error.message });
  await closePool().catch(() => undefined);
  process.exit(1);
}
