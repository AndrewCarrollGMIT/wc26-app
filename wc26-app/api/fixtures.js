// HYBRID:
//   Base    = worldcup26.ir  (game IDs match local data, finished flags -> standings)
//   Overlay = TheSportsDB V2 livescore (paid, fast in-match score updates)
// 100% ASCII source - safe to copy/paste through any editor.

const ALIASES = {
  "turkey": "turkiye",
  "south korea": "korea republic",
  "czech republic": "czechia",
  "bosnia and herzegovina": "bosnia-herzegovina",
  "dr congo": "congo dr",
  "democratic republic of congo": "congo dr",
  "cape verde": "cape verde islands",
  "usa": "united states",
  "cote d'ivoire": "ivory coast",
  "ir iran": "iran"
};

function norm(s) {
  // strip diacritics so Turkiye/Curacao match no matter how they're spelled
  let n = String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  return ALIASES[n] || n;
}

async function fetchWc26() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.WC26_TOKEN || null;
  if (token) headers["Authorization"] = "Bearer " + token;

  const r = await fetch("https://worldcup26.ir/get/games", {
    headers: headers,
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error("wc26 status " + r.status);
  const data = await r.json();

  let games = [];
  if (Array.isArray(data)) games = data;
  else if (Array.isArray(data.data)) games = data.data;
  else if (Array.isArray(data.games)) games = data.games;
  else if (Array.isArray(data.matches)) games = data.matches;
  if (!games.length) throw new Error("wc26 empty");

  function mapStatus(s) {
    if (!s) return "NS";
    s = String(s).toLowerCase();
    if (s === "notstarted") return "NS";
    if (s === "1h") return "1H";
    if (s === "ht") return "HT";
    if (s === "2h") return "2H";
    if (s === "et") return "ET";
    if (s === "ft" || s === "finished") return "FT";
    if (s === "live") return "1H";
    return "NS";
  }

  return games
    .filter(function (g) { return !g.type || g.type === "group"; })
    .map(function (g) {
      return {
        gameId: parseInt(g.id),
        home: (g.home_team && g.home_team.name_en) || null,
        away: (g.away_team && g.away_team.name_en) || null,
        home_score: g.home_score != null ? parseInt(g.home_score) : null,
        away_score: g.away_score != null ? parseInt(g.away_score) : null,
        status: mapStatus(g.time_elapsed),
        elapsed: g.elapsed_time ? parseInt(g.elapsed_time) : null,
        kickoff: g.date || null,
        finished: g.finished === true || g.finished === "true"
      };
    });
}

async function fetchSdbLive(key) {
  const r = await fetch("https://www.thesportsdb.com/api/v2/json/livescore/4429", {
    headers: { "X-API-KEY": key },
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) return [];
  const j = await r.json();
  const list = (j && j.livescore) || [];
  return list.map(function (g) {
    return {
      home: g.strHomeTeam,
      away: g.strAwayTeam,
      home_score: g.intHomeScore != null ? parseInt(g.intHomeScore) : null,
      away_score: g.intAwayScore != null ? parseInt(g.intAwayScore) : null,
      status: g.strStatus,
      elapsed: g.strProgress ? parseInt(g.strProgress) : null
    };
  });
}

async function fetchSdbSeason(key) {
  const r = await fetch(
    "https://www.thesportsdb.com/api/v1/json/" + key + "/eventsseason.php?id=4429&s=2026",
    { signal: AbortSignal.timeout(8000) }
  );
  if (!r.ok) throw new Error("sdb season status " + r.status);
  const j = await r.json();
  const DONE = { "Match Finished": 1, "FT": 1, "AET": 1, "PEN": 1 };
  return ((j && j.events) || [])
    .filter(function (g) { return g.strHomeTeam && g.strAwayTeam; })
    .map(function (g) {
      const fin = !!DONE[g.strStatus || ""];
      return {
        gameId: null,
        home: g.strHomeTeam,
        away: g.strAwayTeam,
        home_score: g.intHomeScore !== "" && g.intHomeScore != null ? parseInt(g.intHomeScore) : null,
        away_score: g.intAwayScore !== "" && g.intAwayScore != null ? parseInt(g.intAwayScore) : null,
        status: fin ? "FT" : "NS",
        elapsed: null,
        kickoff: g.dateEvent ? g.dateEvent + "T" + (g.strTime || "00:00:00") + "Z" : null,
        finished: fin
      };
    });
}

function overlayLive(fixtures, live) {
  const liveMap = {};
  for (let i = 0; i < live.length; i++) {
    liveMap[norm(live[i].home) + "|" + norm(live[i].away)] = live[i];
  }
  for (let i = 0; i < fixtures.length; i++) {
    const g = fixtures[i];
    if (g.finished) continue;
    const lv = liveMap[norm(g.home) + "|" + norm(g.away)];
    if (!lv) continue;
    if (lv.home_score != null) g.home_score = lv.home_score;
    if (lv.away_score != null) g.away_score = lv.away_score;
    if (lv.status) g.status = lv.status;
    if (lv.elapsed != null) g.elapsed = lv.elapsed;
  }
}

module.exports = async function handler(req, res) {
  try {
    const sdbKey = process.env.THESPORTSDB_KEY || null;

    // Fire all requests in parallel
    const wc26P = fetchWc26().catch(function (e) { return { error: e.message }; });
    const liveP = sdbKey
      ? fetchSdbLive(sdbKey).catch(function () { return []; })
      : Promise.resolve([]);

    const wc26 = await wc26P;
    const live = await liveP;

    // Path 1: wc26 base + live overlay
    if (Array.isArray(wc26)) {
      overlayLive(wc26, live);
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({
        fixtures: wc26,
        updated: new Date().toISOString(),
        source: live.length ? "worldcup26.ir + thesportsdb live" : "worldcup26.ir",
        count: wc26.length
      });
    }

    // Path 2: wc26 down -> TheSportsDB season + live overlay
    if (sdbKey) {
      const season = await fetchSdbSeason(sdbKey);
      overlayLive(season, live);
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({
        fixtures: season,
        updated: new Date().toISOString(),
        source: "thesportsdb (fallback)",
        count: season.length
      });
    }

    return res.status(503).json({ error: "wc26 failed and no THESPORTSDB_KEY set" });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message || err) });
  }
}
