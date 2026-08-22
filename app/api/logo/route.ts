import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { getD1 } from '../../../db';
import { ApiError, assertSameOrigin, jsonError } from '../../../lib/security';

const MAX_LOGO_BYTES = 750_000;
const KEY_PATTERN = /^logos\/[a-f0-9]{64}\/[0-9a-f-]{36}\.(png|jpg|webp)$/;

export const dynamic = 'force-dynamic';

function detectImage(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'image/png', ext: 'png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  throw new ApiError(400, 'Use a PNG, JPEG, or WebP logo.');
}

async function hashUserId(userId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getChatGPTUser();
    if (!user) throw new ApiError(401, 'Sign in to upload a logo.');
    const now = Date.now();
    const db = getD1();
    const recent = await db.prepare(`SELECT COUNT(*) AS count FROM logo_uploads WHERE user_id = ? AND created_at > ?`).bind(user.userId, now - 10 * 60_000).first<{ count: number }>();
    if (Number(recent?.count ?? 0) >= 10) throw new ApiError(429, 'Too many logo uploads. Try again in a few minutes.');
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_LOGO_BYTES + 32_000) throw new ApiError(413, 'Logo must be smaller than 750 KB.');
    const form = await request.formData();
    const file = form.get('logo');
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Choose a logo file.');
    if (file.size > MAX_LOGO_BYTES) throw new ApiError(413, 'Logo must be smaller than 750 KB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectImage(bytes);
    const key = `logos/${await hashUserId(user.userId)}/${crypto.randomUUID()}.${detected.ext}`;
    await env.FILES.put(key, bytes, {
      httpMetadata: { contentType: detected.type, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { ownerUserId: user.userId },
    });
    try {
      await db.prepare(`INSERT INTO logo_uploads (key, user_id, size_bytes, content_type, created_at) VALUES (?, ?, ?, ?, ?)`).bind(key, user.userId, file.size, detected.type, now).run();
    } catch (error) {
      await env.FILES.delete(key);
      throw error;
    }
    return Response.json({ key, url: `/api/logo?key=${encodeURIComponent(key)}` }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get('key') ?? '';
    if (!KEY_PATTERN.test(key)) throw new ApiError(404, 'Logo not found.');
    const object = await env.FILES.get(key);
    if (!object) throw new ApiError(404, 'Logo not found.');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    return new Response(object.body, { headers });
  } catch (error) {
    return jsonError(error);
  }
}
