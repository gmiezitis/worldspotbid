import { getChatGPTUser } from '../../chatgpt-auth';
import { getD1 } from '../../../db';
import { ApiError, jsonError } from '../../../lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new ApiError(401, 'Sign in to view this order.');
    const sessionId = new URL(request.url).searchParams.get('session_id') ?? '';
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new ApiError(400, 'Invalid order.');
    const row = await getD1().prepare(`SELECT status, country_name, amount_cents, failure_reason FROM bid_orders WHERE stripe_session_id = ? AND user_id = ?`).bind(sessionId, user.userId).first();
    if (!row) throw new ApiError(404, 'Order not found.');
    return Response.json({ status: row.status, countryName: row.country_name, amount: Number(row.amount_cents) / 100, message: row.failure_reason });
  } catch (error) {
    return jsonError(error);
  }
}
