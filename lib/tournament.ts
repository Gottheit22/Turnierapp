export type SetScore = { a: string; b: string };
export type MatchSets = [SetScore, SetScore, SetScore];
export type SetsMap = Record<string, MatchSets>;

export type GroupKey = 'A' | 'B';

export type GroupMatch = {
  id: string;
  group: GroupKey;
  p1: string;
  p2: string;
};

export const groupA = ['Kathi', 'Michelle', 'Yvonne', 'Simone'];
export const groupB = ['Jo', 'Vroni', 'Chantal', 'Eva'];

function makePairs(list: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  }
  return out;
}

export const groupMatchesA: GroupMatch[] = makePairs(groupA).map((pr, i) => ({
  id: 'A' + i,
  group: 'A',
  p1: pr[0],
  p2: pr[1]
}));

export const groupMatchesB: GroupMatch[] = makePairs(groupB).map((pr, i) => ({
  id: 'B' + i,
  group: 'B',
  p1: pr[0],
  p2: pr[1]
}));

export const ALL_MATCH_IDS = [
  ...groupMatchesA.map((m) => m.id),
  ...groupMatchesB.map((m) => m.id),
  'SF1',
  'SF2',
  'F'
];

export function emptySet(): SetScore {
  return { a: '', b: '' };
}

export function emptyMatchSets(): MatchSets {
  return [emptySet(), emptySet(), emptySet()];
}

export function emptySetsMap(): SetsMap {
  const map: SetsMap = {};
  ALL_MATCH_IDS.forEach((id) => {
    map[id] = emptyMatchSets();
  });
  return map;
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

export type StandingRow = {
  name: string;
  points: number;
  played: number;
  setsWon: number;
  setsLost: number;
};

export function groupStandings(
  matches: GroupMatch[],
  sets: SetsMap,
  players: string[]
): StandingRow[] {
  const stat: Record<string, StandingRow> = {};
  players.forEach((p) => {
    stat[p] = { name: p, points: 0, played: 0, setsWon: 0, setsLost: 0 };
  });
  matches.forEach((m) => {
    const r = evalMatch(sets[m.id]);
    stat[m.p1].setsWon += r.aSets;
    stat[m.p1].setsLost += r.bSets;
    stat[m.p2].setsWon += r.bSets;
    stat[m.p2].setsLost += r.aSets;
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

export function groupComplete(matches: GroupMatch[], sets: SetsMap): boolean {
  return matches.every((m) => evalMatch(sets[m.id]).winner !== null);
}
