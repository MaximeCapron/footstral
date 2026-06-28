require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = 3001;
const API_KEY = process.env.THE_ODDS_API_KEY;
const ODDS_BASE = 'https://api.the-odds-api.com/v4';
const SPORT = 'soccer_fifa_world_cup';

// ── Auth basique ──────────────────────────────────────────────────────────────

const PUBLIC_PATHS = ['/icon-180.png', '/icon-192.png', '/icon-512.png', '/manifest.json', '/sw.js'];

app.use((req, res, next) => {
  if (PUBLIC_PATHS.includes(req.path)) return next();
  if (!process.env.APP_PASSWORD) return next(); // pas de protection en local
  const auth = req.headers.authorization;
  if (auth?.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const [username, ...rest] = decoded.split(':');
    const password = rest.join(':'); // supporte les ':' dans le mdp
    if (username === process.env.APP_USERNAME && password === process.env.APP_PASSWORD) return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Footstral", charset="UTF-8"');
  res.status(401).send('Mot de passe requis');
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Cache simple (5 min) ──────────────────────────────────────────────────────

let cache = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

async function fetchMatches() {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  const url =
    `${ODDS_BASE}/sports/${SPORT}/odds/` +
    `?apiKey=${API_KEY}&regions=eu&markets=h2h,totals&oddsFormat=decimal&bookmakers=pinnacle`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds API : HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(data.message || 'Réponse inattendue de l\'API');

  cache = { data, ts: Date.now() };
  return data;
}

// ── Noms officiels (FR) ← noms API (EN) ──────────────────────────────────────

const EN_TO_OFFICIAL = {
  'South Africa':        'Afrique du Sud',
  'Algeria':             'Algérie',
  'Germany':             'Allemagne',
  'England':             'Angleterre',
  'Argentina':           'Argentine',
  'Australia':           'Australie',
  'Austria':             'Autriche',
  'Belgium':             'Belgique',
  'Bosnia & Herzegovina':'Bosnie-Herzégovine',
  'Brazil':              'Brésil',
  'Canada':              'Canada',
  'Cape Verde':          'Cap-Vert',
  'Colombia':            'Colombie',
  'DR Congo':            'RD Congo',
  'South Korea':         'Corée du Sud',
  'Ivory Coast':         "Côte d'Ivoire",
  'Croatia':             'Croatie',
  'Scotland':            'Écosse',
  'Egypt':               'Égypte',
  'Ecuador':             'Équateur',
  'Spain':               'Espagne',
  'USA':                 'États-Unis',
  'France':              'France',
  'Wales':               'Pays de Galles',
  'Ghana':               'Ghana',
  'Japan':               'Japon',
  'Morocco':             'Maroc',
  'Mexico':              'Mexique',
  'Norway':              'Norvège',
  'Paraguay':            'Paraguay',
  'Netherlands':         'Pays-Bas',
  'Portugal':            'Portugal',
  'Senegal':             'Sénégal',
  'Sweden':              'Suède',
  'Switzerland':         'Suisse',
  'Turkey':              'Turquie',
  'Uruguay':             'Uruguay',
};

function officialName(enName) {
  return EN_TO_OFFICIAL[enName] ?? enName;
}

// ── Glossaire FR → EN ─────────────────────────────────────────────────────────

const FR_TO_EN = {
  'afrique du sud': 'South Africa',
  'algerie': 'Algeria',
  'allemagne': 'Germany',
  'angleterre': 'England',
  'argentine': 'Argentina',
  'australie': 'Australia',
  'autriche': 'Austria',
  'belgique': 'Belgium',
  'bosnie': 'Bosnia & Herzegovina',
  'bosnie-herzegovine': 'Bosnia & Herzegovina',
  'bresil': 'Brazil',
  'canada': 'Canada',
  'cap-vert': 'Cape Verde',
  'colombie': 'Colombia',
  'congo rd': 'DR Congo',
  'rd congo': 'DR Congo',
  'republique democratique du congo': 'DR Congo',
  'coree': 'South Korea',
  'coree du sud': 'South Korea',
  "cote d'ivoire": 'Ivory Coast',
  'cote divoire': 'Ivory Coast',
  'croatie': 'Croatia',
  'ecosse': 'Scotland',
  'egypte': 'Egypt',
  'equateur': 'Ecuador',
  'espagne': 'Spain',
  'etats-unis': 'USA',
  'etats unis': 'USA',
  'france': 'France',
  'galles': 'Wales',
  'ghana': 'Ghana',
  'japon': 'Japan',
  'maroc': 'Morocco',
  'mexique': 'Mexico',
  'norvege': 'Norway',
  'paraguay': 'Paraguay',
  'pays-bas': 'Netherlands',
  'pays bas': 'Netherlands',
  'hollande': 'Netherlands',
  'portugal': 'Portugal',
  'senegal': 'Senegal',
  'suede': 'Sweden',
  'suisse': 'Switzerland',
  'turquie': 'Turkey',
  'uruguay': 'Uruguay',
};

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

function translateTeam(name) {
  const key = norm(name);

  // 1. Correspondance exacte
  if (FR_TO_EN[key]) return FR_TO_EN[key];

  // 2. Levenshtein sur les clés françaises + valeurs anglaises
  const candidates = [
    ...Object.entries(FR_TO_EN),                          // [fr_key, en_value]
    ...Object.values(FR_TO_EN).map((en) => [norm(en), en]), // [norm(en), en_value]
  ];

  let best = null, bestDist = Infinity;
  for (const [candidate, en] of candidates) {
    const d = levenshtein(key, candidate);
    if (d < bestDist) { bestDist = d; best = en; }
  }

  // Accepte le résultat si la distance est raisonnable (≤ 40% de la longueur du mot saisi)
  const threshold = Math.max(3, Math.floor(key.length * 0.4));
  return bestDist <= threshold ? best : name;
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

function norm(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Les mots significatifs d'un nom (> 2 caractères)
function keywords(name) {
  return norm(name).split(/\s+/).filter((w) => w.length > 2);
}

function teamMatches(teamName, candidate) {
  const kws = keywords(teamName);
  const c = norm(candidate);
  return kws.some((w) => c.includes(w));
}

// Retire la marge du bookmaker et normalise les probas
function normalizeOdds(outcomes) {
  const implied = outcomes.map((o) => 1 / o.price);
  const total = implied.reduce((a, b) => a + b, 0);
  return outcomes.map((o, i) => ({ ...o, prob: implied[i] / total }));
}

// ── Modèle de Poisson ─────────────────────────────────────────────────────────

function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // calcul en log pour éviter les overflows
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Estime λ_total à partir du marché totals Pinnacle.
 * Recherche binaire : on cherche λ tel que P(X ≥ ceil(line + 0.5)) = pOver.
 */
function lambdaFromTotals(totalsMarket) {
  const over  = totalsMarket?.outcomes?.find((o) => o.name === 'Over');
  const under = totalsMarket?.outcomes?.find((o) => o.name === 'Under');
  if (!over) return 2.5; // fallback raisonnable pour le foot international

  const line = over.point ?? 2.5;
  // Normalisation : retire la marge bookmaker pour obtenir la vraie proba
  const impOver  = 1 / over.price;
  const impUnder = under ? 1 / under.price : impOver;
  const pOver = impOver / (impOver + impUnder);
  const threshold = Math.ceil(line + 0.5); // 2.5 → 3

  let lo = 0.01, hi = 12;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    let pUnder = 0;
    for (let k = 0; k < threshold; k++) pUnder += poissonPMF(k, mid);
    if (1 - pUnder < pOver) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Génère la matrice de probabilités de scores et retourne les scores
 * favorables au vainqueur, triés par probabilité desc puis total buts asc.
 */
function computeScores(lambdaA, lambdaB, winner) {
  const MAX = 8;
  const scores = [];

  for (let a = 0; a <= MAX; a++) {
    for (let b = 0; b <= MAX; b++) {
      const aWins = a > b;
      const bWins = b > a;
      const isDraw = a === b;
      if (winner === 'teamA' && !aWins) continue;
      if (winner === 'teamB' && !bWins) continue;
      if (winner === 'draw' && !isDraw) continue;

      const prob = poissonPMF(a, lambdaA) * poissonPMF(b, lambdaB);
      scores.push({
        score: `${a}-${b}`,
        goalsA: a,
        goalsB: b,
        totalGoals: a + b,
        probability: Math.round(prob * 10000) / 100,
      });
    }
  }

  scores.sort((a, b) => {
    const d = b.probability - a.probability;
    return Math.abs(d) > 0.005 ? d : a.totalGoals - b.totalGoals;
  });

  return scores;
}

// ── Route principale ──────────────────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const { teamA, teamB, oddsA, oddsDraw, oddsB } = req.body;

  if (!teamA || !teamB || oddsA == null || oddsB == null) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  const teamAen = translateTeam(teamA);
  const teamBen = translateTeam(teamB);

  try {
    const matches = await fetchMatches();

    // Trouver le match par noms d'équipes (après traduction FR→EN)
    const match = matches.find(
      (m) =>
        (teamMatches(teamAen, m.home_team) || teamMatches(teamAen, m.away_team)) &&
        (teamMatches(teamBen, m.home_team) || teamMatches(teamBen, m.away_team))
    );

    if (!match) {
      return res.status(404).json({
        error: `Match "${teamA} vs ${teamB}" introuvable.`,
        available: matches.map((m) => `${m.home_team} vs ${m.away_team}`),
      });
    }

    const pinnacle = match.bookmakers?.[0];
    if (!pinnacle) {
      return res.status(404).json({ error: 'Cotes Pinnacle indisponibles pour ce match.' });
    }

    // ── H2H → probas normalisées ──────────────────────────────────────────────
    const h2h = pinnacle.markets.find((m) => m.key === 'h2h');
    if (!h2h) return res.status(404).json({ error: 'Marché H2H introuvable.' });

    const h2hNorm = normalizeOdds(h2h.outcomes);
    const homeEntry = h2hNorm.find((o) => o.name === match.home_team);
    const awayEntry = h2hNorm.find((o) => o.name === match.away_team);
    const drawEntry = h2hNorm.find((o) => o.name === 'Draw');

    const homeProb = homeEntry?.prob ?? 0;
    const awayProb = awayEntry?.prob ?? 0;
    const drawProb = drawEntry?.prob ?? 0;

    // teamA = home ou away ?
    const aIsHome = teamMatches(teamAen, match.home_team);
    const probA = aIsHome ? homeProb : awayProb;
    const probB = aIsHome ? awayProb : homeProb;

    // ── Totals → λ_total ──────────────────────────────────────────────────────
    const totals = pinnacle.markets.find((m) => m.key === 'totals');
    const lambdaTotal = lambdaFromTotals(totals);

    // λ de chaque équipe, proportionnel à leur force offensive relative
    // (approximation : on utilise les probas de victoire comme proxy)
    // Facteur correctif : le Poisson indépendant surestime les scores à buts multiples
    const LAMBDA_CORRECTION = 0.88;
    const strengthRatio = probA / (probA + probB);
    const lambdaA = lambdaTotal * strengthRatio * LAMBDA_CORRECTION;
    const lambdaB = lambdaTotal * (1 - strengthRatio) * LAMBDA_CORRECTION;

    // ── Calcul EV ─────────────────────────────────────────────────────────────
    const oA = parseFloat(oddsA);
    const oD = oddsDraw != null ? parseFloat(oddsDraw) : 0;
    const oB = parseFloat(oddsB);

    const evA = Math.round(oA * probA * 100) / 100;
    const evD = Math.round(oD * drawProb * 100) / 100;
    const evB = Math.round(oB * probB * 100) / 100;

    const evMap = { teamA: evA, draw: evD, teamB: evB };
    const bestBet = Object.keys(evMap).reduce((a, b) => (evMap[a] >= evMap[b] ? a : b));

    // ── Scores exacts ─────────────────────────────────────────────────────────
    const allScores = computeScores(lambdaA, lambdaB, bestBet);

    const nameA = officialName(aIsHome ? match.home_team : match.away_team);
    const nameB = officialName(aIsHome ? match.away_team : match.home_team);

    return res.json({
      nameA,
      nameB,
      commenceTime: match.commence_time,
      probabilities: {
        teamA: Math.round(probA * 10000) / 100,
        draw: Math.round(drawProb * 10000) / 100,
        teamB: Math.round(probB * 10000) / 100,
      },
      expectedValues: { teamA: evA, draw: evD, teamB: evB },
      bestBet,
      bestScore: allScores[0] || null,
      allScores: allScores.slice(0, 10),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Liste des matchs disponibles (pour debug / affichage)
app.get('/api/matches', async (req, res) => {
  try {
    const matches = await fetchMatches();
    res.json(
      matches.map((m) => ({
        home: m.home_team,
        away: m.away_team,
        time: m.commence_time,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Footstral en ligne → http://localhost:${PORT}`);
});
