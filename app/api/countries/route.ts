import { getD1 } from '../../../db';
import { jsonError } from '../../../lib/security';
import { stripeIsConfigured } from '../../../lib/stripe';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getD1();
    const { results } = await db.prepare(`
      SELECT code, name, current_bid_cents, company_name, company_url, project_category, logo_key,
             active_since, minimum_guaranteed_until
      FROM countries
      WHERE current_bid_cents > 0
      ORDER BY current_bid_cents DESC
    `).all();

    const countries = results.map((row) => ({
      code: String(row.code).toLowerCase(),
      name: row.name,
      currentBid: Number(row.current_bid_cents) / 100,
      companyName: row.company_name,
      companyUrl: row.company_url,
      projectCategory: row.project_category,
      logoUrl: row.logo_key ? `/api/logo?key=${encodeURIComponent(String(row.logo_key))}` : null,
      activeSince: row.active_since,
      minimumGuaranteedUntil: row.minimum_guaranteed_until,
    }));

    return Response.json({ countries, paymentsEnabled: stripeIsConfigured() }, {
      headers: { 'Cache-Control': 'public, max-age=5, stale-while-revalidate=25' },
    });
  } catch (error) {
    return jsonError(error);
  }
}
