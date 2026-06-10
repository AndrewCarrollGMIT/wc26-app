// Serverless function: proxies football-data.org's WC 2026 match feed.
// Keeps FOOTBALL_DATA_TOKEN server-side and shares one upstream call across all viewers via edge cache.

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "FOOTBALL_DATA_TOKEN not set in Vercel environment variables"
    });
  }

  try {
    const upstream = await fetch(
      "https://api.football-data.org/v4/competitions/WC/matches",
      {
        headers: { "X-Auth-Token": token }
      }
    );

    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(upstream.status).json({
        error: `football-data.org returned ${upstream.status}`,
        detail: body.slice(0, 200)
      });
    }

    const data = await upstream.json();

    // Map football-data.org's match shape to what the frontend expects.
    // Status mapping:
    //   SCHEDULED / TIMED → "NS"   (not started)
    //   IN_PLAY           → "LIVE"
    //   PAUSED            → "HT"
    //   FINISHED          → "FT"
    //   POSTPONED/SUSPENDED/CANCELLED → "PST"
    const mapStatus = s => {
      if (s === "IN_PLAY") return "LIVE";
      if (s === "PAUSED") return "HT";
      if (s === "FINISHED") return "FT";
      if (s === "SCHEDULED" || s === "TIMED") return "NS";
      return "PST";
    };

    const fixtures = (data.matches || []).map(m => ({
      home: m.homeTeam?.name,
      away: m.awayTeam?.name,
      home_score: m.score?.fullTime?.home ?? null,
      away_score: m.score?.fullTime?.away ?? null,
      status: mapStatus(m.status),
      elapsed: m.minute,
      kickoff: m.utcDate,
      round: m.group || m.stage || `Matchday ${m.matchday ?? "?"}`
    }));

    // Edge-cache for 60s. Six mates polling = still one upstream call per minute.
    // 60 calls/hour during live windows, well under the 10/min free-tier ceiling.
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      fixtures,
      updated: new Date().toISOString(),
      count: fixtures.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
