import { getD1 } from '../../../db';
import { getCountry } from '../../../lib/countries';
import { ApiError, assertSameOrigin, jsonError, readJsonObject } from '../../../lib/security';

export const dynamic = 'force-dynamic';

const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    const db = getD1();
    const since = Date.now() - 24 * 60 * 60_000;
    const [trendingResult, countsResult, activityResult] = await Promise.all([
      db.prepare(`
        SELECT totals.country_code, totals.click_count, COUNT(events.id) AS clicks_24h
        FROM country_click_totals AS totals
        LEFT JOIN country_click_events AS events
          ON events.country_code = totals.country_code AND events.clicked_at >= ?
        GROUP BY totals.country_code, totals.click_count
        ORDER BY clicks_24h DESC, totals.click_count DESC
        LIMIT 6
      `).bind(since).all(),
      db.prepare(`SELECT country_code, click_count FROM country_click_totals ORDER BY click_count DESC`).all(),
      db.prepare(`
        SELECT country_code, country_name, amount_cents, company_name, project_category, completed_at
        FROM bid_orders
        WHERE status = 'accepted' AND completed_at IS NOT NULL
        ORDER BY completed_at DESC
        LIMIT 8
      `).all(),
    ]);

    const trending = trendingResult.results.map((row) => {
      const country = getCountry(String(row.country_code));
      return {
        code: country.code.toLowerCase(),
        name: country.name,
        clicks24h: Number(row.clicks_24h),
        totalClicks: Number(row.click_count),
      };
    });
    const clickCounts = Object.fromEntries(countsResult.results.map((row) => [String(row.country_code).toLowerCase(), Number(row.click_count)]));
    const latestActivity = activityResult.results.map((row) => ({
      code: String(row.country_code).toLowerCase(),
      countryName: row.country_name,
      amount: Number(row.amount_cents) / 100,
      companyName: row.company_name,
      projectCategory: row.project_category,
      completedAt: Number(row.completed_at),
    }));

    return Response.json({ trending, clickCounts, latestActivity }, {
      headers: { 'Cache-Control': 'public, max-age=5, stale-while-revalidate=20' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const country = getCountry(body.countryCode);
    if (typeof body.visitorId !== 'string' || !VISITOR_ID.test(body.visitorId)) throw new ApiError(400, 'Invalid visitor session.');
    const now = Date.now();
    const db = getD1();
    const recent = await db.prepare(`SELECT COUNT(*) AS count FROM country_click_events WHERE visitor_id = ? AND clicked_at > ?`).bind(body.visitorId, now - 10 * 60_000).first<{ count: number }>();
    if (Number(recent?.count ?? 0) >= 50) throw new ApiError(429, 'Click limit reached. Try again shortly.');

    const clickId = crypto.randomUUID();
    const statements = [
      db.prepare(`INSERT INTO country_click_events (id, country_code, visitor_id, clicked_at) VALUES (?, ?, ?, ?)`).bind(clickId, country.code, body.visitorId, now),
      db.prepare(`
        INSERT INTO country_click_totals (country_code, click_count, updated_at)
        VALUES (?, 1, ?)
        ON CONFLICT(country_code) DO UPDATE SET click_count = click_count + 1, updated_at = excluded.updated_at
      `).bind(country.code, now),
    ];
    if (Number.parseInt(clickId.slice(0, 2), 16) === 0) statements.push(db.prepare(`DELETE FROM country_click_events WHERE clicked_at < ?`).bind(now - 30 * 24 * 60 * 60_000));
    await db.batch(statements);

    return Response.json({ counted: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
