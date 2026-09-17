export type SetScore = { a: string; b: string };
// 4 Elemente: [Satz1, Satz2, Satz3, Meta]. Der 4. Eintrag ist kein echter
// Satz, sondern ein versteckter Meta-Slot für Sieger-Overrides (W.O. /
// nachträgliche Verletzungswertung) - wird nie als Eingabefeld angezeigt.
export type MatchSets = [SetScore, SetScore, SetScore, SetScore];
export type SetsMap = Record<string, MatchSets>;

export function emptySet(): SetScore {
  return { a: '', b: '' };
}

export function emptyMatchSets(): MatchSets {
  return [emptySet(), emptySet(), emptySet(), emptySet()];
}

export function getMatchSets(sets: SetsMap, id: string): MatchSets {
  return sets[id] || emptyMatchSets();
}

export type EvalResult = {
  aSets: number;
  bSets: number;
  winner: 'p1' | 'p2' | null;
  /** Sieg durch Aufgabe/Nichtantreten - Original-Sätze bleiben unverändert stehen. */
  walkover?: 'p1' | 'p2';
};

function realSets(arr: MatchSets): [SetScore, SetScore, SetScore] {
  return [arr[0], arr[1], arr[2]];
}

export function evalMatch(sets: MatchSets | undefined): EvalResult {
  const arr = sets || emptyMatchSets();
  const meta = arr[3];

  if (meta) {
    // "Aufgabe" (z. B. Rückzug mitten im Match bei 5:3): Sieger wird erzwungen,
    // die Sätze 1-3 bleiben exakt so stehen, wie sie eingetragen wurden.
    if (meta.a === 'WO') return { ...evalRealSets(realSets(arr)), winner: 'p2', walkover: 'p1' };
    if (meta.b === 'WO') return { ...evalRealSets(realSets(arr)), winner: 'p1', walkover: 'p2' };
  }

  // Abwärtskompatibilität: eine ältere Version dieses Tools speicherte den
  // W.O.-Marker direkt in Satz 1 statt im Meta-Slot (Index 3).
  const legacy = arr[0];
  if (legacy) {
    if (legacy.a === 'WO') return { aSets: 0, bSets: 2, winner: 'p2', walkover: 'p1' };
    if (legacy.b === 'WO') return { aSets: 2, bSets: 0, winner: 'p1', walkover: 'p2' };
  }

  return evalRealSets(realSets(arr));
}

function evalRealSets(sets: [SetScore, SetScore, SetScore]): EvalResult {
  let aSets = 0;
  let bSets = 0;
  sets.forEach((s) => {
    if (s.a !== '' && s.b !== '') {
      const av = Number(s.a);
      const bv = Number(s.b);
      if (!isNaN(av) && !isNaN(bv) && av !== bv) {
        if (av > bv) aSets++;
        else bSets++;
      }
    }
  });
  let winner: 'p1' | 'p2' | null = null;
  if (aSets >= 2) winner = 'p1';
  else if (bSets >= 2) winner = 'p2';
  return { aSets, bSets, winner };
}

export type SimpleMatch = { id: string; p1: string; p2: string };

function makePairs(list: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  }
  return out;
}

export type GroupInfo = {
  label: string;
  players: string[];
  matches: SimpleMatch[];
};

const GROUP_LETTERS = 'ABCDEFGHIJKLMNOP'.split('');

/**
 * Wählt die Gruppenanzahl (immer eine Zweierpotenz, damit die KO-Runde danach
 * ohne Freilose aufgeht) so, dass jede Gruppe maximal 5 Spieler:innen hat.
 */
export function chooseGroupCount(n: number): number {
  let g = 1;
  while (g * 2 <= n && Math.ceil(n / g) > 5) g *= 2;
  return g;
}

export function buildGroups(participants: string[], groupCount: number): GroupInfo[] {
  const buckets: string[][] = Array.from({ length: groupCount }, () => []);
  participants.forEach((p, i) => buckets[i % groupCount].push(p));
  return buckets.map((players, gi) => {
    const label = GROUP_LETTERS[gi] || String(gi + 1);
    const matches = makePairs(players).map((pr, i) => ({
      id: `G${label}-${i}`,
      p1: pr[0],
      p2: pr[1]
    }));
    return { label, players, matches };
  });
}

/** Mischt eine Liste zufällig (Fisher-Yates), ohne das Original-Array zu verändern. */
export function shuffleArray<T>(list: T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export type StandingRow = {
  name: string;
  points: number;
  played: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  withdrawn: boolean;
};

/**
 * @param withdrawn Namen von Spieler:innen, die verletzungsbedingt aus dem
 * Turnier zurückgezogen wurden. Deren Spiele (gespielt oder nicht) fallen
 * komplett aus der Wertung - weder als Sieg noch als Niederlage.
 */
export function groupStandings(
  matches: SimpleMatch[],
  sets: SetsMap,
  players: string[],
  withdrawn: string[] = []
): StandingRow[] {
  const stat: Record<string, StandingRow> = {};
  players.forEach((p) => {
    stat[p] = {
      name: p,
      points: 0,
      played: 0,
      setsWon: 0,
      setsLost: 0,
      gamesWon: 0,
      gamesLost: 0,
      withdrawn: withdrawn.includes(p)
    };
  });
  matches.forEach((m) => {
    if (withdrawn.includes(m.p1) || withdrawn.includes(m.p2)) return;
    const r = evalMatch(sets[m.id]);
    stat[m.p1].setsWon += r.aSets;
    stat[m.p1].setsLost += r.bSets;
    stat[m.p2].setsWon += r.bSets;
    stat[m.p2].setsLost += r.aSets;

    const g = matchGames(sets[m.id]);
    stat[m.p1].gamesWon += g.a;
    stat[m.p1].gamesLost += g.b;
    stat[m.p2].gamesWon += g.b;
    stat[m.p2].gamesLost += g.a;

    if (r.winner) {
      stat[m.p1].played++;
      stat[m.p2].played++;
      if (r.winner === 'p1') stat[m.p1].points += 2;
      else stat[m.p2].points += 2;
    }
  });
  return sortStandings(Object.values(stat), matches, sets);
}

/**
 * Sortiert die Tabelle: Punkte, dann bei GENAU 2 punktgleichen Personen der
 * direkte Vergleich (wer hat gegen wen gewonnen); bei 3 oder mehr
 * punktgleichen Personen (oder wenn der direkte Vergleich nicht ermittelbar
 * ist) stattdessen Satzdifferenz, dann Anzahl gewonnener Sätze. Zurückgezogene
 * Spieler:innen landen immer ganz am Ende.
 */
function sortStandings(rows: StandingRow[], matches: SimpleMatch[], sets: SetsMap): StandingRow[] {
  function headToHead(aName: string, bName: string): 'a' | 'b' | null {
    const m = matches.find((mm) => (mm.p1 === aName && mm.p2 === bName) || (mm.p1 === bName && mm.p2 === aName));
    if (!m) return null;
    const r = evalMatch(sets[m.id]);
    if (!r.winner) return null;
    const winnerName = r.winner === 'p1' ? m.p1 : m.p2;
    if (winnerName === aName) return 'a';
    if (winnerName === bName) return 'b';
    return null;
  }

  const bySetDiff = (x: StandingRow, y: StandingRow) => {
    const dx = x.setsWon - x.setsLost;
    const dy = y.setsWon - y.setsLost;
    if (dy !== dx) return dy - dx;
    return y.setsWon - x.setsWon;
  };

  const active = rows.filter((r) => !r.withdrawn);
  const withdrawnRows = rows.filter((r) => r.withdrawn);
  active.sort((x, y) => y.points - x.points);

  const result: StandingRow[] = [];
  let i = 0;
  while (i < active.length) {
    let j = i;
    while (j < active.length && active[j].points === active[i].points) j++;
    const group = active.slice(i, j);
    if (group.length === 2) {
      const [x, y] = group;
      const h2h = headToHead(x.name, y.name);
      if (h2h === 'a') result.push(x, y);
      else if (h2h === 'b') result.push(y, x);
      else result.push(...group.sort(bySetDiff));
    } else {
      result.push(...group.sort(bySetDiff));
    }
    i = j;
  }

  return [...result, ...withdrawnRows];
}

export function groupComplete(matches: SimpleMatch[], sets: SetsMap, withdrawn: string[] = []): boolean {
  return matches.every(
    (m) => withdrawn.includes(m.p1) || withdrawn.includes(m.p2) || evalMatch(sets[m.id]).winner !== null
  );
}

/**
 * Baut die Startaufstellung der KO-Runde aus den Gruppensiegern/-zweiten.
 * Kreuzpaarung (Sieger Gruppe i gegen Zweiten aus Gruppe i+Hälfte), damit
 * zwei Spielerinnen aus derselben Gruppe nicht sofort wieder aufeinandertreffen.
 * Gibt null zurück, solange nicht alle Gruppen fertig gespielt sind.
 */
export function buildQualifierOrder(groups: GroupInfo[], sets: SetsMap, withdrawn: string[] = []): string[] | null {
  const allComplete = groups.every((g) => groupComplete(g.matches, sets, withdrawn));
  if (!allComplete) return null;
  const standingsPerGroup = groups.map((g) => groupStandings(g.matches, sets, g.players, withdrawn).filter((s) => !s.withdrawn));
  if (standingsPerGroup.some((s) => s.length < 2)) return null;
  const g = groups.length;
  const winners = standingsPerGroup.map((s) => s[0].name);
  const runnersUp = standingsPerGroup.map((s) => s[1].name);
  if (g === 1) return [winners[0], runnersUp[0]];
  const order: string[] = [];
  for (let i = 0; i < g; i++) {
    order.push(winners[i]);
    order.push(runnersUp[(i + g / 2) % g]);
  }
  return order;
}

export type BracketMatch = {
  id: string;
  p1: string | null;
  p2: string | null;
  result: EvalResult | null;
};

/** Baut alle KO-Runden aus der Startaufstellung, Gewinner rücken automatisch nach. */
export function buildBracket(qualifierOrder: string[], sets: SetsMap): BracketMatch[][] {
  let currentPlayers: (string | null)[] = qualifierOrder;
  const rounds: BracketMatch[][] = [];
  let roundIndex = 0;
  while (currentPlayers.length > 1) {
    const matches: BracketMatch[] = [];
    const nextPlayers: (string | null)[] = [];
    for (let i = 0; i < currentPlayers.length; i += 2) {
      const p1 = currentPlayers[i];
      const p2 = currentPlayers[i + 1];
      const id = `KO-R${roundIndex}-M${i / 2}`;
      const ready = !!(p1 && p2);
      const result = ready ? evalMatch(sets[id]) : null;
      matches.push({ id, p1, p2, result });
      nextPlayers.push(result?.winner ? (result.winner === 'p1' ? p1 : p2) : null);
    }
    rounds.push(matches);
    currentPlayers = nextPlayers;
    roundIndex++;
  }
  return rounds;
}

const ROUND_NAMES = ['Finale', 'Halbfinale', 'Viertelfinale', 'Achtelfinale', 'Sechzehntelfinale'];

export function roundLabel(totalRounds: number, roundIndex: number): string {
  const fromEnd = totalRounds - 1 - roundIndex;
  return ROUND_NAMES[fromEnd] || `KO-Runde ${roundIndex + 1}`;
}

// ---------------------------------------------------------------------------
// Double-Elimination-Bracket
// ---------------------------------------------------------------------------

export type TournamentFormat = 'groups' | 'double-elim' | 'swiss' | 'team-doubles';

export function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

export type DEMatch = {
  id: string;
  p1: string | null;
  p2: string | null;
  result: EvalResult | null;
};

export type DoubleElimBracket = {
  winners: DEMatch[][];
  losers: DEMatch[][];
  grandFinal: DEMatch;
  grandFinalReset: DEMatch | null;
};

function deWinnerName(m: DEMatch): string | null {
  return m.result?.winner ? (m.result.winner === 'p1' ? m.p1 : m.p2) : null;
}
function deLoserName(m: DEMatch): string | null {
  return m.result?.winner ? (m.result.winner === 'p1' ? m.p2 : m.p1) : null;
}

/**
 * Baut einen kompletten Double-Elimination-Bracket. `participants.length`
 * muss eine Zweierpotenz (>=4) sein.
 */
export function buildDoubleElimination(participants: string[], sets: SetsMap): DoubleElimBracket {
  const prefix = 'DE';
  const r = Math.log2(participants.length);

  // Gewinner-Baum (Winners Bracket)
  let wbCurrent: (string | null)[] = participants;
  const winners: DEMatch[][] = [];
  const wbLosersByRound: (string | null)[][] = [];
  let wri = 0;
  while (wbCurrent.length > 1) {
    const matches: DEMatch[] = [];
    const next: (string | null)[] = [];
    const losers: (string | null)[] = [];
    for (let i = 0; i < wbCurrent.length; i += 2) {
      const p1 = wbCurrent[i];
      const p2 = wbCurrent[i + 1];
      const id = `${prefix}-WB-R${wri}-M${i / 2}`;
      const ready = !!(p1 && p2);
      const result = ready ? evalMatch(sets[id]) : null;
      const m: DEMatch = { id, p1, p2, result };
      matches.push(m);
      next.push(deWinnerName(m));
      losers.push(deLoserName(m));
    }
    winners.push(matches);
    wbLosersByRound.push(losers);
    wbCurrent = next;
    wri++;
  }

  // Verlierer-Baum (Losers Bracket): abwechselnd "Minor"-Runden (LB-Überlebende
  // spielen untereinander) und "Major"-Runden (LB-Überlebende treffen frische
  // Verliererinnen aus dem Gewinner-Baum).
  const losers: DEMatch[][] = [];
  let lbCurrent: (string | null)[] = [];
  let lri = 0;

  for (let wbRound = 0; wbRound < r - 1; wbRound++) {
    const incoming = wbLosersByRound[wbRound];

    if (wbRound === 0) {
      const matches: DEMatch[] = [];
      const next: (string | null)[] = [];
      for (let i = 0; i < incoming.length; i += 2) {
        const p1 = incoming[i];
        const p2 = incoming[i + 1];
        const id = `${prefix}-LB-R${lri}-M${i / 2}`;
        const ready = !!(p1 && p2);
        const result = ready ? evalMatch(sets[id]) : null;
        const m: DEMatch = { id, p1, p2, result };
        matches.push(m);
        next.push(deWinnerName(m));
      }
      losers.push(matches);
      lbCurrent = next;
      lri++;
    } else {
      // Major-Runde
      const matches: DEMatch[] = [];
      const next: (string | null)[] = [];
      for (let i = 0; i < lbCurrent.length; i++) {
        const p1 = lbCurrent[i];
        const p2 = incoming[i];
        const id = `${prefix}-LB-R${lri}-M${i}`;
        const ready = !!(p1 && p2);
        const result = ready ? evalMatch(sets[id]) : null;
        const m: DEMatch = { id, p1, p2, result };
        matches.push(m);
        next.push(deWinnerName(m));
      }
      losers.push(matches);
      lbCurrent = next;
      lri++;

      // Direkt anschließende Minor-Runde, falls mehr als eine Überlebende übrig ist.
      if (lbCurrent.length > 1) {
        const matches2: DEMatch[] = [];
        const next2: (string | null)[] = [];
        for (let i = 0; i < lbCurrent.length; i += 2) {
          const p1 = lbCurrent[i];
          const p2 = lbCurrent[i + 1];
          const id = `${prefix}-LB-R${lri}-M${i / 2}`;
          const ready = !!(p1 && p2);
          const result = ready ? evalMatch(sets[id]) : null;
          const m: DEMatch = { id, p1, p2, result };
          matches2.push(m);
          next2.push(deWinnerName(m));
        }
        losers.push(matches2);
        lbCurrent = next2;
        lri++;
      }
    }
  }

  // Verlierer-Finale: letzte LB-Überlebende gegen die Verliererin des Gewinner-Finales.
  const wbFinalLoser = wbLosersByRound[r - 1]?.[0] ?? null;
  const lbFinalP1 = lbCurrent[0] ?? null;
  const lbFinalId = `${prefix}-LB-R${lri}-M0`;
  const lbFinalReady = !!(lbFinalP1 && wbFinalLoser);
  const lbFinalResult = lbFinalReady ? evalMatch(sets[lbFinalId]) : null;
  const lbFinalMatch: DEMatch = { id: lbFinalId, p1: lbFinalP1, p2: wbFinalLoser, result: lbFinalResult };
  losers.push([lbFinalMatch]);
  const lbChampion = deWinnerName(lbFinalMatch);

  // Grand Final
  const wbChampion = wbCurrent[0] ?? null;
  const gfId = `${prefix}-GF`;
  const gfReady = !!(wbChampion && lbChampion);
  const gfResult = gfReady ? evalMatch(sets[gfId]) : null;
  const grandFinal: DEMatch = { id: gfId, p1: wbChampion, p2: lbChampion, result: gfResult };

  // Bracket-Reset: nur nötig, wenn die Verlierer-Baum-Siegerin das erste Grand
  // Final gewinnt (dann steht es 1 Niederlage zu 1 Niederlage, Entscheidung nötig).
  let grandFinalReset: DEMatch | null = null;
  if (gfResult?.winner === 'p2') {
    const gfrId = `${prefix}-GF-RESET`;
    const gfrResult = evalMatch(sets[gfrId]);
    grandFinalReset = { id: gfrId, p1: wbChampion, p2: lbChampion, result: gfrResult };
  }

  return { winners, losers, grandFinal, grandFinalReset };
}

export function wbRoundLabel(totalRounds: number, idx: number): string {
  return idx === totalRounds - 1 ? 'Gewinner-Finale' : `Gewinnerrunde ${idx + 1}`;
}

export function lbRoundLabel(totalRounds: number, idx: number): string {
  return idx === totalRounds - 1 ? 'Verlierer-Finale' : `Verliererrunde ${idx + 1}`;
}

// ---------------------------------------------------------------------------
// Schweizer System (Swiss), angelehnt an das LoL-Worlds-Format
// ---------------------------------------------------------------------------

export type SwissConfig = { winThreshold: number; lossThreshold: number; maxRounds: number };

/** Aktuell nur für genau 8 oder 16 Teilnehmer:innen unterstützt. */
export function getSwissConfig(n: number): SwissConfig | null {
  if (n === 16) return { winThreshold: 3, lossThreshold: 3, maxRounds: 5 };
  if (n === 8) return { winThreshold: 2, lossThreshold: 2, maxRounds: 3 };
  return null;
}

export type SwissStanding = {
  name: string;
  wins: number;
  losses: number;
  status: 'alive' | 'qualified' | 'eliminated';
};

export function computeSwissStandings(
  participants: string[],
  rounds: SimpleMatch[][],
  sets: SetsMap,
  config: SwissConfig
): Record<string, SwissStanding> {
  const stat: Record<string, SwissStanding> = {};
  participants.forEach((p) => {
    stat[p] = { name: p, wins: 0, losses: 0, status: 'alive' };
  });
  rounds.forEach((round) => {
    round.forEach((m) => {
      const r = evalMatch(sets[m.id]);
      if (r.winner === 'p1') {
        stat[m.p1].wins++;
        stat[m.p2].losses++;
      } else if (r.winner === 'p2') {
        stat[m.p2].wins++;
        stat[m.p1].losses++;
      }
    });
  });
  Object.values(stat).forEach((s) => {
    if (s.wins >= config.winThreshold) s.status = 'qualified';
    else if (s.losses >= config.lossThreshold) s.status = 'eliminated';
  });
  return stat;
}

/**
 * Lost die nächste Swiss-Runde aus: gruppiert alle noch "lebenden" Teilnehmer:innen
 * nach aktueller Bilanz und paart innerhalb jeder Gruppe zufällig. Gibt null zurück,
 * wenn die letzte Runde noch nicht komplett entschieden ist, oder wenn die
 * Swiss-Phase bereits fertig ist (niemand mehr "alive").
 */
export function generateNextSwissRound(
  participants: string[],
  rounds: SimpleMatch[][],
  sets: SetsMap,
  config: SwissConfig
): SimpleMatch[] | null {
  const lastRound = rounds[rounds.length - 1];
  if (lastRound && !lastRound.every((m) => evalMatch(sets[m.id]).winner !== null)) return null;
  if (rounds.length >= config.maxRounds) return null;

  const standings = computeSwissStandings(participants, rounds, sets, config);
  const alive = participants.filter((p) => standings[p].status === 'alive');
  if (alive.length === 0) return null;

  const buckets: Record<string, string[]> = {};
  alive.forEach((p) => {
    const key = `${standings[p].wins}-${standings[p].losses}`;
    (buckets[key] = buckets[key] || []).push(p);
  });

  const roundIndex = rounds.length;
  const pairings: SimpleMatch[] = [];
  let counter = 0;
  Object.values(buckets).forEach((group) => {
    const shuffled = shuffleArray(group);
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      pairings.push({ id: `SW-R${roundIndex}-M${counter}`, p1: shuffled[i], p2: shuffled[i + 1] });
      counter++;
    }
  });
  return pairings;
}

/**
 * Gibt die qualifizierten Teilnehmer:innen zurück, sortiert danach, in welcher
 * Runde sie sich qualifiziert haben (früher = besser gesetzt für die KO-Runde).
 * Gibt null zurück, solange die Swiss-Phase nicht vollständig abgeschlossen ist.
 */
export function getSwissQualifiers(
  participants: string[],
  rounds: SimpleMatch[][],
  sets: SetsMap,
  config: SwissConfig
): string[] | null {
  if (rounds.length < config.maxRounds) {
    // Kann trotzdem schon fertig sein, wenn zufällig niemand mehr "alive" ist -
    // dafür sicherheitshalber trotzdem die Standings prüfen.
    const standings = computeSwissStandings(participants, rounds, sets, config);
    if (participants.some((p) => standings[p].status === 'alive')) return null;
  }
  const lastRound = rounds[rounds.length - 1];
  if (lastRound && !lastRound.every((m) => evalMatch(sets[m.id]).winner !== null)) return null;

  const standings = computeSwissStandings(participants, rounds, sets, config);
  if (participants.some((p) => standings[p].status === 'alive')) return null;

  const qualifiedAtRound: Record<string, number> = {};
  const runningWins: Record<string, number> = {};
  participants.forEach((p) => (runningWins[p] = 0));
  rounds.forEach((round, ri) => {
    round.forEach((m) => {
      const r = evalMatch(sets[m.id]);
      if (r.winner === 'p1') runningWins[m.p1]++;
      else if (r.winner === 'p2') runningWins[m.p2]++;
      [m.p1, m.p2].forEach((name) => {
        if (runningWins[name] >= config.winThreshold && qualifiedAtRound[name] === undefined) {
          qualifiedAtRound[name] = ri;
        }
      });
    });
  });

  const qualifiers = participants.filter((p) => standings[p].status === 'qualified');
  qualifiers.sort((a, b) => {
    const ra = qualifiedAtRound[a] ?? 999;
    const rb = qualifiedAtRound[b] ?? 999;
    if (ra !== rb) return ra - rb;
    return participants.indexOf(a) - participants.indexOf(b);
  });
  return qualifiers;
}

/**
 * Ordnet die Qualifizierten so für die KO-Runde an, dass unbesiegte
 * Teilnehmer:innen (0 Niederlagen in der Swiss-Phase) auf unterschiedliche
 * Bracket-Hälften kommen – sie können sich so frühestens im Finale treffen,
 * nicht schon im Viertel- oder Halbfinale. Rein deterministisch (keine neue
 * Zufälligkeit bei jedem Rendern), damit einmal vergebene Match-IDs stabil
 * bleiben.
 */
export function buildSwissKOSeedOrder(
  qualifiers: string[],
  standingsMap: Record<string, SwissStanding>
): string[] {
  const half = Math.ceil(qualifiers.length / 2);
  const undefeated = qualifiers.filter((name) => standingsMap[name].losses === 0);
  const others = qualifiers.filter((name) => standingsMap[name].losses > 0);
  const firstHalf: string[] = [];
  const secondHalf: string[] = [];
  undefeated.forEach((name, i) => {
    (i % 2 === 0 ? firstHalf : secondHalf).push(name);
  });
  others.forEach((name) => {
    (firstHalf.length < half ? firstHalf : secondHalf).push(name);
  });
  return [...firstHalf, ...secondHalf];
}

// ---------------------------------------------------------------------------
// Mixed-Team-Doppel (Rot vs. Blau)
// ---------------------------------------------------------------------------

export type GenderGroups = { men: string[]; women: string[] };

export type TeamDoublesMatch = {
  id: string;
  side1: string[]; // 1 (Einzel) oder 2 (Doppel) Namen, immer Team Rot
  side2: string[]; // dito, immer Team Blau
};

/**
 * Teilt Männer und Frauen zufällig auf Team Rot/Blau auf, so ausgeglichen wie
 * möglich sowohl bei der Geschlechterverteilung pro Team als auch bei der
 * Gesamtgröße der Teams.
 */
export function assignTeams(men: string[], women: string[]): { red: GenderGroups; blue: GenderGroups } {
  const shuffledMen = shuffleArray(men);
  const shuffledWomen = shuffleArray(women);
  const menStartRed = Math.random() < 0.5;
  const red: GenderGroups = { men: [], women: [] };
  const blue: GenderGroups = { men: [], women: [] };

  shuffledMen.forEach((name, i) => {
    const goesRed = menStartRed ? i % 2 === 0 : i % 2 === 1;
    (goesRed ? red.men : blue.men).push(name);
  });

  // Ist die Männerzahl ungerade, bekommt eine Seite eine Person mehr –
  // dann starten die Frauen auf der jeweils anderen Seite, um die
  // Gesamtgröße der Teams wieder auszugleichen.
  const menOdd = shuffledMen.length % 2 === 1;
  const womenStartRed = menOdd ? !menStartRed : Math.random() < 0.5;
  shuffledWomen.forEach((name, i) => {
    const goesRed = womenStartRed ? i % 2 === 0 : i % 2 === 1;
    (goesRed ? red.women : blue.women).push(name);
  });

  return { red, blue };
}

function pairUpMixed(men: string[], women: string[]): { pairs: [string, string][]; leftover: string[] } {
  const sm = shuffleArray(men);
  const sw = shuffleArray(women);
  const count = Math.min(sm.length, sw.length);
  const pairs: [string, string][] = [];
  for (let i = 0; i < count; i++) pairs.push([sm[i], sw[i]]);
  const leftover = [...sm.slice(count), ...sw.slice(count)];
  return { pairs, leftover };
}

function partnerKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/**
 * Erzeugt alle Runden im Voraus (die Zusammensetzung hängt nicht von
 * Ergebnissen ab). Jede Runde: neue Mixed-Doppel-Paare innerhalb jedes Teams,
 * gegen ein Paar des anderen Teams. Sucht per Zufalls-Versuchen aktiv nach
 * Kombinationen ohne wiederholte Partner- oder Gegner-Paarungen; falls das
 * bei der gegebenen Rundenzahl/Teamgröße nicht vollständig möglich ist, wird
 * die Kombination mit den wenigsten Wiederholungen genommen.
 */
export function generateTeamDoublesRounds(
  red: GenderGroups,
  blue: GenderGroups,
  roundsCount: number
): TeamDoublesMatch[][] {
  const usedPartnerCombos = new Set<string>();
  const usedOpponentCombos = new Set<string>();
  const rounds: TeamDoublesMatch[][] = [];

  for (let r = 0; r < roundsCount; r++) {
    let best: {
      pairsRed: [string, string][];
      pairsBlue: [string, string][];
      leftoverRed: string[];
      leftoverBlue: string[];
      score: number;
    } | null = null;

    for (let attempt = 0; attempt < 60; attempt++) {
      const { pairs: pairsRed, leftover: leftoverRed } = pairUpMixed(red.men, red.women);
      const { pairs: pairsBlueRaw, leftover: leftoverBlue } = pairUpMixed(blue.men, blue.women);
      const numMatches = Math.min(pairsRed.length, pairsBlueRaw.length);
      const pairsBlue = shuffleArray(pairsBlueRaw);

      let score = 0;
      pairsRed.forEach(([m, w]) => {
        if (usedPartnerCombos.has(partnerKey(m, w))) score++;
      });
      pairsBlue.forEach(([m, w]) => {
        if (usedPartnerCombos.has(partnerKey(m, w))) score++;
      });
      for (let i = 0; i < numMatches; i++) {
        const [rm, rw] = pairsRed[i];
        const [bm, bw] = pairsBlue[i];
        if (usedOpponentCombos.has([rm, rw, bm, bw].sort().join('|'))) score++;
      }

      if (!best || score < best.score) {
        best = { pairsRed, pairsBlue, leftoverRed, leftoverBlue, score };
        if (score === 0) break;
      }
    }

    const { pairsRed, pairsBlue, leftoverRed, leftoverBlue } = best!;
    const numMatches = Math.min(pairsRed.length, pairsBlue.length);
    const matches: TeamDoublesMatch[] = [];
    for (let i = 0; i < numMatches; i++) {
      const [rm, rw] = pairsRed[i];
      const [bm, bw] = pairsBlue[i];
      matches.push({ id: `TD-R${r}-M${i}`, side1: [rm, rw], side2: [bm, bw] });
      usedPartnerCombos.add(partnerKey(rm, rw));
      usedPartnerCombos.add(partnerKey(bm, bw));
      usedOpponentCombos.add([rm, rw, bm, bw].sort().join('|'));
    }
    if (leftoverRed.length === 1 && leftoverBlue.length === 1) {
      matches.push({ id: `TD-R${r}-S0`, side1: [leftoverRed[0]], side2: [leftoverBlue[0]] });
    }
    rounds.push(matches);
  }

  return rounds;
}

export type TeamDoublesScoringMode = 'wins' | 'games';

/**
 * Zählt die "Spiele" (Games) eines Matches. Satz 1+2 zählen mit echten
 * Ergebnissen, ein Match-Tiebreak (Satz 3) zählt dabei nur als 1:0 für die
 * Siegerin des Tiebreaks – nicht die tatsächlichen Tiebreak-Punkte.
 */
export function matchGames(sets: MatchSets | undefined): { a: number; b: number } {
  const arr = sets || emptyMatchSets();

  let a = 0;
  let b = 0;
  [arr[0], arr[1], arr[2]].forEach((s, idx) => {
    if (s.a !== '' && s.b !== '') {
      const av = Number(s.a);
      const bv = Number(s.b);
      if (!isNaN(av) && !isNaN(bv) && av !== bv) {
        if (idx === 2) {
          if (av > bv) a += 1;
          else b += 1;
        } else {
          a += av;
          b += bv;
        }
      }
    }
  });
  return { a, b };
}

export function computeTeamDoublesScore(
  rounds: TeamDoublesMatch[][],
  sets: SetsMap,
  mode: TeamDoublesScoringMode = 'wins'
): { red: number; blue: number } {
  let red = 0;
  let blue = 0;
  rounds.forEach((round) =>
    round.forEach((m) => {
      if (mode === 'games') {
        const g = matchGames(sets[m.id]);
        red += g.a;
        blue += g.b;
      } else {
        const r = evalMatch(sets[m.id]);
        if (r.winner === 'p1') red++;
        else if (r.winner === 'p2') blue++;
      }
    })
  );
  return { red, blue };
}
