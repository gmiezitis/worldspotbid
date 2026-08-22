import { getD1 } from '../../../db';
import { jsonError } from '../../../lib/security';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { results } = await getD1().prepare(`
      SELECT code, name, current_bid_cents, company_name, business_description, project_category, logo_key, minimum_guaranteed_until
      FROM countries
      WHERE current_bid_cents > 0
      ORDER BY current_bid_cents DESC, updated_at ASC
      LIMIT 10
    `).all();
    return Response.json({ countries: results.map((row) => ({
      code: String(row.code).toLowerCase(),
      name: row.name,
      currentBid: Number(row.current_bid_cents) / 100,
      companyName: row.company_name,
      businessDescription: row.business_description,
      projectCategory: row.project_category,
      logoUrl: row.logo_key ? `/api/logo?key=${encodeURIComponent(String(row.logo_key))}` : null,
      minimumGuaranteedUntil: row.minimum_guaranteed_until,
    })) }, { headers: { 'Cache-Control': 'public, max-age=5, stale-while-revalidate=25' } });
  } catch (error) {
    return jsonError(error);
  }
}
