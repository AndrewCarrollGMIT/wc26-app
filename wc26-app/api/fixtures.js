// Proxies worldcup26.ir/get/games — free, no rate limit, live scores.
// Game IDs and team IDs match our local data exactly (same source).
// Optional: set WC26_TOKEN in Vercel env vars if the demo endpoint starts
// requiring auth. If not set, tries without auth first.

export default async function handler(req, res) {
  const token = process.env.WC26_TOKEN || null;

  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const upstream = await fetch("https://worldcup26.ir/get/games", { headers });

    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(upstream.status).json({
        error: `worldcup26.ir returned ${upstream.status}`,
        detail: body.slice(0, 300)
      });
    }

    const data = await upstream.json();
    const games = data.data || data || [];

    // Map time_elapsed values to status codes the frontend understands
    const mapStatus = s => {
      if (!s) return "NS";
      s = String(s).toLowerCase();
      if (s === "notstarted" || s === "not_started") return "NS";
      if (s === "1h")          return "1H";
      if (s === "ht")          return "HT";
      if (s === "2h")          return "2H";
      if (s === "et")          return "ET";
      if (s === "pen")         return "P";
      if (s === "ft" || s === "finished") return "FT";
      if (s === "live")        return "1H";   // generic live fallback
      return "NS";
    };

    // Game IDs and team IDs from worldcup26.ir match our local data exactly.
    // Frontend matches by game id directly — no fuzzy name lookup needed.
    const fixtures = games
      .filter(g => g.type === "group" || !g.type)  // group stage only
      .map(g => ({
        gameId:     parseInt(g.id),
        home:       g.home_team?.name_en || null,
        away:       g.away_team?.name_en || null,
        home_score: g.home_score != null ? parseInt(g.home_score) : null,
        away_score: g.away_score != null ? parseInt(g.away_score) : null,
        status:     mapStatus(g.time_elapsed),
        elapsed:    g.elapsed_time ? parseInt(g.elapsed_time) : null,
        kickoff:    g.date || null,
        round:      g.group ? `GROUP_${g.group}` : null,
        finished:   g.finished === true || g.finished === "true"
      }));

    // Cache 60s at the edge — all viewers share one upstream call per minute
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      fixtures,
      updated: new Date().toISOString(),
      source:  "worldcup26.ir",
      count:   fixtures.length
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
