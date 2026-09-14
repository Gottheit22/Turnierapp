export type SetScore = { a: string; b: string };
export type MatchSets = [SetScore, SetScore, SetScore];
export type SetsMap = Record<string, MatchSets>;

export function emptySet(): SetScore {
  return { a: '', b: '' };
}

export function emptyMatchSets(): MatchSets {
  return [emptySet(), emptySet(), emptySet()];
}

export function getMatchSets(sets: SetsMap, id: string): MatchSets {
  return sets[id] || emptyMatchSets();
}

export type EvalResult = { aSets: number; bSets: number; winner: 'p1' | 'p2' | null };

export function evalMatch(sets: MatchSets | undefined): EvalResult {
  let aSets = 0;
  let bSets = 0;
  (sets || emptyMatchSets()).forEach((s) => {
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
};

export function groupStandings(matches: SimpleMatch[], sets: SetsMap, players: string[]): StandingRow[] {
  const stat: Record<string, StandingRow> = {};
  players.forEach((p) => {
    stat[p] = { name: p, points: 0, played: 0, setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0 };
  });
  matches.forEach((m) => {
    const r = evalMatch(sets[m.id]);
    stat[m.p1].setsWon += r.aSets;
    stat[m.p1].setsLost += r.bSets;
    stat[m.p2].setsWon += r.bSets;
    stat[m.p2].setsLost += r.aSets;

    const matchSets = sets[m.id] || emptyMatchSets();
    matchSets.forEach((s, idx) => {
      if (s.a !== '' && s.b !== '') {
        const av = Number(s.a);
        const bv = Number(s.b);
        if (!isNaN(av) && !isNaN(bv) && av !== bv) {
          if (idx === 2) {
            // Match-Tiebreak (3. Satz): zählt nur als 1:0 Spiele für die Siegerin,
            // 0:1 für die Verliererin – nicht die tatsächlichen Tiebreak-Punkte.
            if (av > bv) {
              stat[m.p1].gamesWon += 1;
              stat[m.p2].gamesLost += 1;
            } else {
              stat[m.p2].gamesWon += 1;
              stat[m.p1].gamesLost += 1;
            }
          } else {
            stat[m.p1].gamesWon += av;
            stat[m.p1].gamesLost += bv;
            stat[m.p2].gamesWon += bv;
            stat[m.p2].gamesLost += av;
          }
        }
      }
    });

    if (r.winner) {
      stat[m.p1].played++;
      stat[m.p2].played++;
      if (r.winner === 'p1') stat[m.p1].points += 2;
      else stat[m.p2].points += 2;
    }
  });
  return Object.values(stat).sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    const dx = x.setsWon - x.setsLost;
    const dy = y.setsWon - y.setsLost;
    if (dy !== dx) return dy - dx;
    return y.setsWon - x.setsWon;
  });
}

export function groupComplete(matches: SimpleMatch[], sets: SetsMap): boolean {
  return matches.every((m) => evalMatch(sets[m.id]).winner !== null);
}

/**
 * Baut die Startaufstellung der KO-Runde aus den Gruppensiegern/-zweiten.
 * Kreuzpaarung (Sieger Gruppe i gegen Zweiten aus Gruppe i+Hälfte), damit
 * zwei Spielerinnen aus derselben Gruppe nicht sofort wieder aufeinandertreffen.
 * Gibt null zurück, solange nicht alle Gruppen fertig gespielt sind.
 */
export function buildQualifierOrder(groups: GroupInfo[], sets: SetsMap): string[] | null {
  const allComplete = groups.every((g) => groupComplete(g.matches, sets));
  if (!allComplete) return null;
  const standingsPerGroup = groups.map((g) => groupStandings(g.matches, sets, g.players));
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
