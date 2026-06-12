// PRIMARY:  TheSportsDB (paid) - season schedule + live scores, matches official FIFA schedule
// FALLBACK: worldcup26.ir - id-based feed translated to names via embedded lookup
// All matching downstream is by team name. 100% ASCII source.

const GAME_TEAMS = {"1":["mexico","south africa"],"2":["south korea","czechia"],"3":["canada","bosnia and herzegovina"],"4":["united states","paraguay"],"5":["haiti","scotland"],"6":["australia","turkiye"],"7":["brazil","morocco"],"8":["qatar","switzerland"],"9":["ivory coast","ecuador"],"10":["germany","curacao"],"11":["netherlands","japan"],"12":["sweden","tunisia"],"13":["iran","new zealand"],"14":["spain","cape verde"],"15":["belgium","egypt"],"16":["saudi arabia","uruguay"],"17":["france","senegal"],"18":["iraq","norway"],"19":["argentina","algeria"],"20":["austria","jordan"],"21":["portugal","dr congo"],"22":["england","croatia"],"23":["uzbekistan","colombia"],"24":["ghana","panama"],"25":["mexico","south korea"],"26":["switzerland","bosnia and herzegovina"],"27":["canada","qatar"],"28":["czechia","south africa"],"29":["brazil","haiti"],"30":["scotland","morocco"],"31":["united states","australia"],"32":["turkiye","paraguay"],"33":["germany","ivory coast"],"34":["ecuador","curacao"],"35":["netherlands","sweden"],"36":["tunisia","japan"],"37":["belgium","iran"],"38":["new zealand","egypt"],"39":["spain","saudi arabia"],"40":["uruguay","cape verde"],"41":["france","iraq"],"42":["norway","senegal"],"43":["argentina","austria"],"44":["jordan","algeria"],"45":["portugal","uzbekistan"],"46":["panama","croatia"],"47":["colombia","dr congo"],"48":["england","ghana"],"49":["scotland","brazil"],"50":["morocco","haiti"],"51":["south africa","south korea"],"52":["czechia","mexico"],"53":["bosnia and herzegovina","canada"],"54":["qatar","switzerland"],"55":["curacao","ivory coast"],"56":["ecuador","germany"],"57":["paraguay","australia"],"58":["turkiye","united states"],"59":["japan","sweden"],"60":["tunisia","netherlands"],"61":["senegal","iraq"],"62":["norway","france"],"63":["egypt","iran"],"64":["new zealand","belgium"],"65":["cape verde","saudi arabia"],"66":["uruguay","spain"],"67":["panama","england"],"68":["croatia","ghana"],"69":["algeria","austria"],"70":["jordan","argentina"],"71":["colombia","portugal"],"72":["dr congo","uzbekistan"]};

const ALIASES = {
  "turkey": "turkiye",
  "korea republic": "south korea",
  "czech republic": "czechia",
  "bosnia-herzegovina": "bosnia and herzegovina",
  "congo dr": "dr congo",
  "democratic republic of congo": "dr congo",
  "cape verde islands": "cape verde",
  "usa": "united states",
  "cote d'ivoire": "ivory coast",
  "ir iran": "iran"
};

function norm(s) {
  let n = String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  return ALIASES[n] || n;
}

async function fetchSdbSeason(key) {
  const r = await fetch(
    "https://www.thesportsdb.com/api/v1/json/" + key + "/eventsseason.php?id=4429&s=2026",
    { signal: AbortSignal.timeout(8000) }
  );
  if (!r.ok) throw new Error("sdb season " + r.status);
  const j = await r.json();
  const DONE = { "Match Finished": 1, "FT": 1, "AET": 1, "PEN": 1 };
  const events = (j && j.events) || [];
  if (!events.length) throw new Error("sdb season empty");
  return events
    .filter(function (g) { return g.strHomeTeam && g.strAwayTeam; })
    .map(function (g) {
      const fin = !!DONE[g.strStatus || ""];
      return {
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

async function fetchSdbLive(key) {
  try {
    const r = await fetch("https://www.thesportsdb.com/api/v2/json/livescore/4429", {
      headers: { "X-API-KEY": key },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return [];
    const j = await r.json();
    return ((j && j.livescore) || []).map(function (g) {
      return {
        home: g.strHomeTeam,
        away: g.strAwayTeam,
        home_score: g.intHomeScore != null ? parseInt(g.intHomeScore) : null,
        away_score: g.intAwayScore != null ? parseInt(g.intAwayScore) : null,
        status: g.strStatus,
        elapsed: g.strProgress ? parseInt(g.strProgress) : null
      };
    });
  } catch (e) { return []; }
}

async function fetchWc26() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.WC26_TOKEN || null;
  if (token) headers["Authorization"] = "Bearer " + token;
  const r = await fetch("https://worldcup26.ir/get/games", {
    headers: headers,
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error("wc26 " + r.status);
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
      const id = parseInt(g.id);
      const names = GAME_TEAMS[id] || [null, null];
      return {
        home: (g.home_team && g.home_team.name_en) || names[0],
        away: (g.away_team && g.away_team.name_en) || names[1],
        home_score: g.home_score != null ? parseInt(g.home_score) : null,
        away_score: g.away_score != null ? parseInt(g.away_score) : null,
        status: mapStatus(g.time_elapsed),
        elapsed: g.elapsed_time ? parseInt(g.elapsed_time) : null,
        kickoff: g.date || null,
        finished: g.finished === true || g.finished === "true"
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
    if (g.finished || !g.home) continue;
    const lv = liveMap[norm(g.home) + "|" + norm(g.away)];
    if (!lv) continue;
    if (lv.home_score != null) g.home_score = lv.home_score;
    if (lv.away_score != null) g.away_score = lv.away_score;
    if (lv.status) g.status = lv.status;
    if (lv.elapsed != null) g.elapsed = lv.elapsed;
  }
}

function timeBasedFT(fixtures) {
  // If a game is deep in the second half and kicked off 108+ min ago,
  // the final whistle has gone even if the feed lags.
  const now = Date.now();
  for (let i = 0; i < fixtures.length; i++) {
    const g = fixtures[i];
    if (g.finished || !g.kickoff) continue;
    const ko = new Date(g.kickoff).getTime();
    if (isNaN(ko)) continue;
    const mins = (now - ko) / 60000;
    const lateInGame = (g.status === "2H" || g.status === "ET") && (g.elapsed || 0) >= 89;
    if (lateInGame && mins >= 108) {
      g.status = "FT";
      g.finished = true;
    }
  }
}

module.exports = async function handler(req, res) {
  try {
    const key = process.env.THESPORTSDB_KEY || null;

    // PRIMARY: TheSportsDB season + live
    if (key) {
      try {
        const seasonP = fetchSdbSeason(key);
        const liveP = fetchSdbLive(key);
        const season = await seasonP;
        const live = await liveP;
        overlayLive(season, live);
        timeBasedFT(season);
        res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
        return res.status(200).json({
          fixtures: season,
          updated: new Date().toISOString(),
          source: live.length ? "thesportsdb + live" : "thesportsdb",
          count: season.length
        });
      } catch (e) {
        // fall through to wc26
      }
    }

    // FALLBACK: worldcup26.ir
    const wc26 = await fetchWc26();
    timeBasedFT(wc26);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      fixtures: wc26,
      updated: new Date().toISOString(),
      source: "worldcup26.ir (fallback)",
      count: wc26.length
    });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
};
