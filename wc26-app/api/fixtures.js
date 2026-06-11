// Primary: TheSportsDB Premium (V2 livescore + V1 season schedule)
// Fallback: worldcup26.ir
// Key stored in THESPORTSDB_KEY env var

export default async function handler(req, res) {
  const key = process.env.THESPORTSDB_KEY;

  if (key) {
    try {
      // Fetch live scores + full season schedule in parallel
      const v2Headers = { "X-API-KEY": key };
      const timeout = { signal: AbortSignal.timeout(8000) };

      const [liveRes, seasonRes] = await Promise.all([
        fetch("https://www.thesportsdb.com/api/v2/json/livescore/4429",
          { headers: v2Headers, ...timeout }),
        fetch(`https://www.thesportsdb.com/api/v1/json/${key}/eventsseason.php?id=4429&s=2026`,
          timeout)
      ]);

      const [liveJson, seasonJson] = await Promise.all([
        liveRes.ok  ? liveRes.json()   : Promise.resolve(null),
        seasonRes.ok ? seasonRes.json() : Promise.resolve(null)
      ]);

      // V2 livescore response: { livescore: [...] }
      const live = (liveJson?.livescore || []).map(g => ({
        home:       g.strHomeTeam,
        away:       g.strAwayTeam,
        home_score: g.intHomeScore != null ? parseInt(g.intHomeScore) : null,
        away_score: g.intAwayScore != null ? parseInt(g.intAwayScore) : null,
        status:     g.strStatus,   // "1H", "HT", "2H"
        elapsed:    g.strProgress  ? parseInt(g.strProgress) : null,
        kickoff:    g.dateEvent    ? `${g.dateEvent}T${g.strEventTime || "00:00:00"}Z` : null,
        finished:   false,
        gameId:     null
      }));

      // V1 season schedule: { events: [...] }
      const DONE = new Set(["Match Finished", "FT", "AET", "PEN", "After Extra Time", "After Penalties"]);
      const season = (seasonJson?.events || [])
        .filter(g => g.strHomeTeam && g.strAwayTeam)
        .map(g => ({
          home:       g.strHomeTeam,
          away:       g.strAwayTeam,
          home_score: g.intHomeScore != null && g.intHomeScore !== ""
                        ? parseInt(g.intHomeScore) : null,
          away_score: g.intAwayScore != null && g.intAwayScore !== ""
                        ? parseInt(g.intAwayScore) : null,
          status:     g.strStatus === "Match Finished" ? "FT" : (g.strStatus || "NS"),
          elapsed:    null,
          kickoff:    g.dateEvent ? `${g.dateEvent}T${g.strTime || "00:00:00"}Z` : null,
          finished:   DONE.has(g.strStatus || ""),
          gameId:     null
        }));

      // Merge: live data overrides season data for in-progress matches
      const norm = s => (s || "").toLowerCase().trim();
      const liveMap = {};
      live.forEach(g => { liveMap[norm(g.home) + "|" + norm(g.away)] = g; });

      const fixtures = season.map(g => {
        const key2 = norm(g.home) + "|" + norm(g.away);
        return liveMap[key2] || g;
      });

      // Include any live matches not in the season list (edge case)
      live.forEach(g => {
        const key2 = norm(g.home) + "|" + norm(g.away);
        if (!season.find(s => norm(s.home) + "|" + norm(s.away) === key2)) {
          fixtures.push(g);
        }
      });

      if (fixtures.length > 0) {
        res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
        return res.status(200).json({
          fixtures,
          updated: new Date().toISOString(),
          source: "thesportsdb",
          count: fixtures.length
        });
      }
    } catch (err) {
      console.log("TheSportsDB failed:", err.message, "— trying fallback");
    }
  }

  // Fallback: worldcup26.ir
  try {
    const wc26Token = process.env.WC26_TOKEN || null;
    const headers = { "Content-Type": "application/json" };
    if (wc26Token) headers["Authorization"] = `Bearer ${wc26Token}`;

    const upstream = await fetch("https://worldcup26.ir/get/games", {
      headers,
      signal: AbortSignal.timeout(8000)
    });

    if (!upstream.ok) throw new Error(`worldcup26.ir returned ${upstream.status}`);
    const data = await upstream.json();

    let games = [];
    if      (Array.isArray(data))           games = data;
    else if (Array.isArray(data.data))      games = data.data;
    else if (Array.isArray(data.games))     games = data.games;
    else if (Array.isArray(data.matches))   games = data.matches;
    else throw new Error("Unrecognised response shape");

    const mapStatus = s => {
      if (!s) return "NS";
      s = String(s).toLowerCase();
      if (s === "notstarted") return "NS";
      if (s === "1h")  return "1H";
      if (s === "ht")  return "HT";
      if (s === "2h")  return "2H";
      if (s === "et")  return "ET";
      if (s === "ft" || s === "finished") return "FT";
      if (s === "live") return "1H";
      return "NS";
    };

    const fixtures = games
      .filter(g => !g.type || g.type === "group")
      .map(g => ({
        gameId:     parseInt(g.id),
        home:       g.home_team?.name_en || null,
        away:       g.away_team?.name_en || null,
        home_score: g.home_score != null ? parseInt(g.home_score) : null,
        away_score: g.away_score != null ? parseInt(g.away_score) : null,
        status:     mapStatus(g.time_elapsed),
        elapsed:    g.elapsed_time ? parseInt(g.elapsed_time) : null,
        kickoff:    g.date || null,
        finished:   g.finished === true || g.finished === "true"
      }));

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      fixtures,
      updated: new Date().toISOString(),
      source: "worldcup26.ir (fallback)",
      count: fixtures.length
    });

  } catch (err) {
    return res.status(500).json({ error: "All sources failed: " + err.message });
  }
}
