const MAX_JSON_BYTES = 16_384;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new ApiError(403, 'Invalid request origin.');
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_JSON_BYTES) throw new ApiError(413, 'Request is too large.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'Expected JSON.');
  const value: unknown = await request.json().catch(() => null);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new ApiError(400, 'Invalid request.');
  return value as Record<string, unknown>;
}

export function cleanText(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'string') throw new ApiError(400, `${field} is required.`);
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (cleaned.length < min || cleaned.length > max) throw new ApiError(400, `${field} must be ${min}-${max} characters.`);
  return cleaned;
}

export function cleanCompanyUrl(value: unknown) {
  const raw = cleanText(value, 'Company website', 8, 500);
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiError(400, 'Enter a valid company website.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new ApiError(400, 'Company website must use a standard HTTPS address.');
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local')) throw new ApiError(400, 'Enter a public company website.');
  url.hash = '';
  return url.toString();
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error(error);
  return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
