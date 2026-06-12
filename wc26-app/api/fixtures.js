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

export default async function handler(req, res) {
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
      ? fetch("https://www.thesportsdb.com/api/v2/json/livescore/4429",
          { headers: { "X-API-KEY": sdbKey }, ...timeout() })
      : Promise.reject(new Error("no key"))
  ]);

  // ── Parse worldcup26.ir (base) ──────────────────────────────────────
  let base = [];
  let baseOk = false;
  if (wc26Result.status === "fulfilled" && wc26Result.value.ok) {
    try {
      const data = await wc26Result.value.json();
      let games = [];
      if      (Array.isArray(data))         games = data;
      else if (Array.isArray(data.data))    games = data.data;
      else if (Array.isArray(data.games))   games = data.games;
      else if (Array.isArray(data.matches)) games = data.matches;

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

      base = games
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
      baseOk = base.length > 0;
    } catch (e) { /* fall through */ }
  }

  // ── Parse TheSportsDB livescore (overlay) ───────────────────────────
  let liveOverlay = [];
  if (sdbResult.status === "fulfilled" && sdbResult.value.ok) {
    try {
      const lj = await sdbResult.value.json();
      liveOverlay = (lj?.livescore || []).map(g => ({
        home:       g.strHomeTeam,
        away:       g.strAwayTeam,
        home_score: g.intHomeScore != null ? parseInt(g.intHomeScore) : null,
        away_score: g.intAwayScore != null ? parseInt(g.intAwayScore) : null,
        status:     g.strStatus,
        elapsed:    g.strProgress ? parseInt(g.strProgress) : null
      }));
    } catch (e) { /* overlay is optional */ }
  }

  // ── Merge: overlay live scores onto base, but never un-finish a game ─
  if (baseOk) {
    const liveMap = {};
    liveOverlay.forEach(g => { liveMap[norm(g.home) + "|" + norm(g.away)] = g; });

    base.forEach(g => {
      if (g.finished) return;                     // wc26 says done — trust it
      const lv = liveMap[norm(g.home) + "|" + norm(g.away)];
      if (!lv) return;
      // Take the fresher score from TheSportsDB during live play
      if (lv.home_score != null) g.home_score = lv.home_score;
      if (lv.away_score != null) g.away_score = lv.away_score;
      if (lv.status)             g.status     = lv.status;
      if (lv.elapsed != null)    g.elapsed    = lv.elapsed;
    });

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      fixtures: base,
      updated:  new Date().toISOString(),
      source:   liveOverlay.length ? "worldcup26.ir + thesportsdb live" : "worldcup26.ir",
      count:    base.length
    });
  }

  // ── Base failed: TheSportsDB season schedule as full fallback ───────
  if (sdbKey) {
    try {
      const sres = await fetch(
        `https://www.thesportsdb.com/api/v1/json/${sdbKey}/eventsseason.php?id=4429&s=2026`,
        timeout()
      );
      if (sres.ok) {
        const sj = await sres.json();
        const DONE = new Set(["Match Finished", "FT", "AET", "PEN"]);
        const liveMap = {};
        liveOverlay.forEach(g => { liveMap[norm(g.home) + "|" + norm(g.away)] = g; });

        const fixtures = (sj?.events || [])
          .filter(g => g.strHomeTeam && g.strAwayTeam)
          .map(g => {
            const fin = DONE.has(g.strStatus || "");
            const f = {
              gameId:     null,
              home:       g.strHomeTeam,
              away:       g.strAwayTeam,
              home_score: g.intHomeScore !== "" && g.intHomeScore != null ? parseInt(g.intHomeScore) : null,
              away_score: g.intAwayScore !== "" && g.intAwayScore != null ? parseInt(g.intAwayScore) : null,
              status:     fin ? "FT" : "NS",
              elapsed:    null,
              kickoff:    g.dateEvent ? `${g.dateEvent}T${g.strTime || "00:00:00"}Z` : null,
              finished:   fin
            };
            const lv = liveMap[norm(f.home) + "|" + norm(f.away)];
            if (lv && !fin) {
              if (lv.home_score != null) f.home_score = lv.home_score;
              if (lv.away_score != null) f.away_score = lv.away_score;
              if (lv.status)             f.status     = lv.status;
              if (lv.elapsed != null)    f.elapsed    = lv.elapsed;
            }
            return f;
          });

        res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
        return res.status(200).json({
          fixtures,
          updated: new Date().toISOString(),
          source:  "thesportsdb (fallback)",
          count:   fixtures.length
        });
      }
    } catch (e) { /* both failed */ }
  }

  return res.status(500).json({ error: "All data sources failed" });
}
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

      // Merge: live overrides season, UNLESS season already says finished
      // (livescore can linger at 90' after full time — let season data win for finished games)
      const norm = s => (s || "").toLowerCase().trim();
      const liveMap = {};
      live.forEach(g => { liveMap[norm(g.home) + "|" + norm(g.away)] = g; });

      const fixtures = season.map(g => {
        if (g.finished) return g;             // season says FT — trust it
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

      // Time-based finished detection: if a game is in 2H at 90'+ and kickoff
      // was 110+ minutes ago, the final whistle has gone regardless of API lag
      const now = Date.now();
      fixtures.forEach(g => {
        if (g.finished) return;
        if (!g.kickoff) return;
        const ko = new Date(g.kickoff).getTime();
        if (isNaN(ko)) return;
        const minsSinceKO = (now - ko) / 60000;
        const inSecondHalf = ["2H","ET"].includes(g.status);
        const elapsed = g.elapsed || 0;
        if (inSecondHalf && elapsed >= 89 && minsSinceKO >= 108) {
          g.status   = "FT";
          g.finished = true;
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

      // Merge: live overrides season, UNLESS season already says finished
      // (livescore can linger at 90' after full time — let season data win for finished games)
      const norm = s => (s || "").toLowerCase().trim();
      const liveMap = {};
      live.forEach(g => { liveMap[norm(g.home) + "|" + norm(g.away)] = g; });

      const fixtures = season.map(g => {
        if (g.finished) return g;             // season says FT — trust it
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
