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

    // Log the actual structure so we can see what shape it comes back as
    const keys = Object.keys(data);
    const isArray = Array.isArray(data);
    const firstKey = keys[0];
    const sample = isArray ? data[0] : (data[firstKey] ? data[firstKey][0] || data[firstKey] : null);

    // Flexibly extract the games array wherever it lives
    let games = [];
    if (Array.isArray(data))              games = data;
    else if (Array.isArray(data.data))    games = data.data;
    else if (Array.isArray(data.games))   games = data.games;
    else if (Array.isArray(data.matches)) games = data.matches;
    else {
      // Return raw so we can see the structure
      return res.status(200).json({
        debug: true,
        keys,
        isArray,
        firstKey,
        sample,
        raw: JSON.stringify(data).slice(0, 500)
      });
    }

    const mapStatus = s => {
      if (!s) return "NS";
      s = String(s).toLowerCase();
      if (s === "notstarted" || s === "not_started") return "NS";
      if (s === "1h")       return "1H";
      if (s === "ht")       return "HT";
      if (s === "2h")       return "2H";
      if (s === "et")       return "ET";
      if (s === "pen")      return "P";
      if (s === "ft" || s === "finished") return "FT";
      if (s === "live")     return "1H";
      return "NS";
    };

    const fixtures = games
      .filter(g => !g.type || g.type === "group")
      .map(g => ({
        gameId:     parseInt(g.id),
        home:       g.home_team?.name_en || g.home_team_name || null,
        away:       g.away_team?.name_en || g.away_team_name || null,
        home_score: g.home_score != null ? parseInt(g.home_score) : null,
        away_score: g.away_score != null ? parseInt(g.away_score) : null,
        status:     mapStatus(g.time_elapsed),
        elapsed:    g.elapsed_time ? parseInt(g.elapsed_time) : null,
        kickoff:    g.date || null,
        finished:   g.finished === true || g.finished === "true"
      }));

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
