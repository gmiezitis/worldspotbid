import { getD1 } from '../../../db';
import { getCountry } from '../../../lib/countries';
import { jsonError } from '../../../lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const country = getCountry(new URL(request.url).searchParams.get('country'));
    const { results } = await getD1().prepare(`
      SELECT company_name, amount_cents, completed_at
      FROM bid_orders
      WHERE country_code = ? AND status = 'accepted' AND completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 5
    `).bind(country.code).all();

    return Response.json({
      owners: results.map((row) => ({
        companyName: String(row.company_name),
        amount: Number(row.amount_cents) / 100,
        completedAt: Number(row.completed_at),
      })),
    }, { headers: { 'Cache-Control': 'public, max-age=5, stale-while-revalidate=25' } });
  } catch (error) {
    return jsonError(error);
  }
}
