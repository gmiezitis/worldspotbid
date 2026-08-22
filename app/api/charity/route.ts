import { getD1 } from '../../../db';
import { CHARITY_CAUSES, CHARITY_SHARE_PERCENT } from '../../../lib/charity';
import { jsonError } from '../../../lib/security';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const result = await getD1().prepare(`
      SELECT charity_cause, COUNT(*) AS votes, COALESCE(SUM(amount_cents + border_addon_cents), 0) AS gross_cents
      FROM bid_orders
      WHERE status = 'accepted' AND completed_at >= ? AND completed_at < ? AND charity_cause IS NOT NULL
      GROUP BY charity_cause
    `).bind(monthStart, monthEnd).all();
    const byCause = new Map(result.results.map((row) => [String(row.charity_cause), {
      votes: Number(row.votes),
      pledgedCents: Math.floor(Number(row.gross_cents) * CHARITY_SHARE_PERCENT / 100),
    }]));
    const causes = CHARITY_CAUSES.map((cause) => ({ ...cause, votes: byCause.get(cause.id)?.votes ?? 0, pledgedCents: byCause.get(cause.id)?.pledgedCents ?? 0 }));
    return Response.json({
      monthLabel: now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      sharePercent: CHARITY_SHARE_PERCENT,
      totalVotes: causes.reduce((total, cause) => total + cause.votes, 0),
      totalPledgedCents: causes.reduce((total, cause) => total + cause.pledgedCents, 0),
      causes,
    }, { headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=45' } });
  } catch (error) {
    return jsonError(error);
  }
}
