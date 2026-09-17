'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addDoc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { auth, tournamentDocRef, tournamentsCollectionRef } from '@/lib/firebaseClient';
import {
  GroupInfo,
  SetsMap,
  StandingRow,
  BracketMatch,
  TournamentFormat,
  DEMatch,
  SimpleMatch,
  SwissConfig,
  emptyMatchSets,
  emptySet,
  evalMatch,
  groupStandings,
  groupComplete,
  buildQualifierOrder,
  buildBracket,
  roundLabel,
  chooseGroupCount,
  buildGroups,
  shuffleArray,
  isPowerOfTwo,
  buildDoubleElimination,
  wbRoundLabel,
  lbRoundLabel,
  getSwissConfig,
  computeSwissStandings,
  generateNextSwissRound,
  getSwissQualifiers,
  buildSwissKOSeedOrder,
  GenderGroups,
  TeamDoublesMatch,
  TeamDoublesScoringMode,
  assignTeams,
  generateTeamDoublesRounds,
  computeTeamDoublesScore
} from '@/lib/tournament';

type Status = '' | 'loading' | 'saving' | 'saved' | 'error';

type TournamentDoc = {
  id: string;
  name: string;
  participants: string[];
  groups: GroupInfo[];
  format: TournamentFormat;
  swissRounds: SimpleMatch[][];
  teamDoublesRed: GenderGroups;
  teamDoublesBlue: GenderGroups;
  teamDoublesRounds: TeamDoublesMatch[][];
  teamDoublesScoringMode: TeamDoublesScoringMode;
  withdrawnPlayers: string[];
  sets: SetsMap;
  status: 'active' | 'archived';
  createdAt: number;
};

export default function TournamentBoard() {
  const [tournaments, setTournaments] = useState<TournamentDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [localSets, setLocalSets] = useState<SetsMap>({});
  const [user, setUser] = useState<User | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextRemote = useRef(false);

  // Admin-Login-Status verfolgen
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // Liste aller Turniere live laden
  useEffect(() => {
    const q = query(tournamentsCollectionRef, orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list: TournamentDoc[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name || 'Turnier',
            participants: data.participants || [],
            groups: data.groups || [],
            format:
              data.format === 'double-elim'
                ? 'double-elim'
                : data.format === 'swiss'
                ? 'swiss'
                : data.format === 'team-doubles'
                ? 'team-doubles'
                : 'groups',
            swissRounds: (data.swissRounds || []).map((r: any) => r?.matches || []),
            teamDoublesRed: data.teamDoublesRed || { men: [], women: [] },
            teamDoublesBlue: data.teamDoublesBlue || { men: [], women: [] },
            teamDoublesRounds: (data.teamDoublesRounds || []).map((r: any) => r?.matches || []),
            teamDoublesScoringMode: data.teamDoublesScoringMode === 'games' ? 'games' : 'wins',
            withdrawnPlayers: data.withdrawnPlayers || [],
            sets: data.sets || {},
            status: data.status === 'archived' ? 'archived' : 'active',
            createdAt: data.createdAt || 0
          };
        });
        setTournaments(list);
        setStatus('');
        setSelectedId((prev) => (prev && list.some((t) => t.id === prev) ? prev : null));
      },
      () => setStatus('error')
    );
    return () => unsubscribe();
  }, []);

  const selected = tournaments.find((t) => t.id === selectedId) || null;

  // Lokale Eingabe-Ergebnisse mit dem ausgewählten Turnier synchron halten
  useEffect(() => {
    if (skipNextRemote.current) {
      skipNextRemote.current = false;
      return;
    }
    setLocalSets(selected ? selected.sets : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, JSON.stringify(selected?.sets || {})]);

  const scheduleSave = useCallback((tournamentId: string, nextSets: SetsMap) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus('saving');
    saveTimer.current = setTimeout(async () => {
      skipNextRemote.current = true;
      try {
        await setDoc(tournamentDocRef(tournamentId), { sets: nextSets }, { merge: true });
        setStatus('saved');
        setTimeout(() => setStatus(''), 1500);
      } catch (e) {
        setStatus('error');
      }
    }, 500);
  }, []);

  const handleSetChange = (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => {
    if (!selected || selected.status === 'archived') return;
    const tournamentId = selected.id;
    setLocalSets((prev) => {
      const current = prev[matchId] || emptyMatchSets();
      // Ältere, bereits gespeicherte Matches haben u.U. nur 3 statt 4 Felder
      // (der 4. ist der neue, versteckte Meta-Slot) - vor dem Schreiben auf
      // 4 Felder auffüllen, sonst geht ein Schreibversuch auf Index 3 ins Leere.
      const padded: SetsMap[string] = [
        current[0] || emptySet(),
        current[1] || emptySet(),
        current[2] || emptySet(),
        current[3] || emptySet()
      ];
      const nextMatchSets = padded.map((s, i) => (i === setIdx ? { ...s, [player]: value } : s)) as SetsMap[string];
      const next = { ...prev, [matchId]: nextMatchSets };
      scheduleSave(tournamentId, next);
      return next;
    });
  };

  const handleToggleArchive = async (t: TournamentDoc) => {
    try {
      await setDoc(tournamentDocRef(t.id), { status: t.status === 'archived' ? 'active' : 'archived' }, { merge: true });
    } catch (e) {
      setStatus('error');
    }
  };

  const handleCreate = async (payload: {
    name: string;
    format: TournamentFormat;
    participants: string[];
    men?: string[];
    women?: string[];
    roundsCount?: number;
    scoringMode?: TeamDoublesScoringMode;
  }) => {
    const { name, format, participants, men, women, roundsCount, scoringMode } = payload;
    const shuffled = shuffleArray(participants);
    let groups: GroupInfo[] = [];
    let swissRounds: SimpleMatch[][] = [];
    let teamDoublesRed: GenderGroups = { men: [], women: [] };
    let teamDoublesBlue: GenderGroups = { men: [], women: [] };
    let teamDoublesRounds: TeamDoublesMatch[][] = [];

    if (format === 'groups') {
      const groupCount = chooseGroupCount(shuffled.length);
      groups = buildGroups(shuffled, groupCount);
    } else if (format === 'swiss') {
      const config = getSwissConfig(shuffled.length);
      if (config) {
        const round1 = generateNextSwissRound(shuffled, [], {}, config);
        swissRounds = round1 ? [round1] : [];
      }
    } else if (format === 'team-doubles') {
      const { red, blue } = assignTeams(men || [], women || []);
      teamDoublesRed = red;
      teamDoublesBlue = blue;
      teamDoublesRounds = generateTeamDoublesRounds(red, blue, roundsCount || 3);
    }

    const teamDoublesParticipants = format === 'team-doubles' ? [...(men || []), ...(women || [])] : shuffled;

    const ref = await addDoc(tournamentsCollectionRef, {
      name,
      participants: teamDoublesParticipants,
      groups,
      format,
      swissRounds: swissRounds.map((round) => ({ matches: round })),
      teamDoublesRed,
      teamDoublesBlue,
      teamDoublesRounds: teamDoublesRounds.map((round) => ({ matches: round })),
      teamDoublesScoringMode: scoringMode || 'wins',
      withdrawnPlayers: [],
      sets: {},
      status: 'active',
      createdAt: Date.now()
    });
    setSelectedId(ref.id);
    setShowCreateForm(false);
  };

  const handleToggleWithdrawn = async (tournamentId: string, currentList: string[], playerName: string) => {
    const next = currentList.includes(playerName)
      ? currentList.filter((n) => n !== playerName)
      : [...currentList, playerName];
    try {
      await setDoc(tournamentDocRef(tournamentId), { withdrawnPlayers: next }, { merge: true });
    } catch (e) {
      setStatus('error');
    }
  };

  const handleNextSwissRound = async () => {
    if (!selected || selected.format !== 'swiss') return;
    const config = getSwissConfig(selected.participants.length);
    if (!config) return;
    const nextRound = generateNextSwissRound(selected.participants, selected.swissRounds, localSets, config);
    if (!nextRound) return;
    const updatedRounds = [...selected.swissRounds, nextRound];
    try {
      await setDoc(
        tournamentDocRef(selected.id),
        { swissRounds: updatedRounds.map((round) => ({ matches: round })) },
        { merge: true }
      );
    } catch (e) {
      setStatus('error');
    }
  };

  const activeTournaments = tournaments.filter((t) => t.status === 'active');
  const archivedTournaments = tournaments.filter((t) => t.status === 'archived');
  const readOnly = selected?.status === 'archived';

  return (
    <div className="wrap">
      <div className="hero">
        <div className="hero-inner">
          <h1>TURNIERTABELLE</h1>
          <p>
            {selected
              ? 'Gruppenphase, Tabelle und KO-Runde – live für alle mit diesem Link.'
              : 'Turnier auswählen oder ein neues anlegen.'}
          </p>

          <div className="tournament-bar">
            {selected && (
              <button className="tool-btn" onClick={() => setSelectedId(null)} type="button">
                ← Zur Übersicht
              </button>
            )}
            {selected && user && (
              <button className="tool-btn" onClick={() => handleToggleArchive(selected)} type="button">
                {selected.status === 'archived' ? 'Reaktivieren' : 'Archivieren'}
              </button>
            )}
            {!selected && user && (
              <button className="tool-btn" onClick={() => setShowCreateForm((v) => !v)} type="button">
                + Neues Turnier
              </button>
            )}
            {!selected && archivedTournaments.length > 0 && (
              <button className="tool-btn" onClick={() => setShowArchive((v) => !v)} type="button">
                {showArchive ? 'Archiv ausblenden' : `Archiv anzeigen (${archivedTournaments.length})`}
              </button>
            )}

            <span className="save-status">
              {status === 'loading' && 'Lade …'}
              {status === 'saving' && 'Speichere …'}
              {status === 'saved' && 'Gespeichert ✓'}
              {status === 'error' && 'Verbindung fehlgeschlagen'}
            </span>

            <span className="admin-area">
              {user ? (
                <button className="tool-btn tool-btn-ghost" onClick={() => signOut(auth)} type="button">
                  Admin: {user.email} · Abmelden
                </button>
              ) : (
                <button className="tool-btn tool-btn-ghost" onClick={() => setShowLogin((v) => !v)} type="button">
                  Admin-Login
                </button>
              )}
            </span>
          </div>
        </div>
      </div>

      {!user && showLogin && <AdminLoginForm onClose={() => setShowLogin(false)} />}

      {!selected && showCreateForm && user && (
        <CreateTournamentForm onCreate={handleCreate} onCancel={() => setShowCreateForm(false)} />
      )}

      {!selected ? (
        <TournamentOverview
          activeTournaments={activeTournaments}
          archivedTournaments={showArchive ? archivedTournaments : []}
          onSelect={setSelectedId}
          loading={status === 'loading'}
        />
      ) : (
        <TournamentView
          key={selected.id}
          tournament={selected}
          sets={localSets}
          onSetChange={handleSetChange}
          readOnly={!!readOnly}
          user={user}
          onNextSwissRound={handleNextSwissRound}
          onToggleWithdrawn={(playerName) => handleToggleWithdrawn(selected.id, selected.withdrawnPlayers, playerName)}
        />
      )}
    </div>
  );
}

function TournamentOverview(props: {
  activeTournaments: TournamentDoc[];
  archivedTournaments: TournamentDoc[];
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  const { activeTournaments, archivedTournaments, onSelect, loading } = props;

  if (loading && activeTournaments.length === 0 && archivedTournaments.length === 0) {
    return <div className="empty-state">Lade Turniere …</div>;
  }

  if (activeTournaments.length === 0 && archivedTournaments.length === 0) {
    return (
      <div className="empty-state">
        Noch kein Turnier angelegt. Klick oben auf „+ Neues Turnier", um loszulegen.
      </div>
    );
  }

  return (
    <div>
      <h2 className="section-title">Aktive Turniere</h2>
      {activeTournaments.length === 0 ? (
        <div className="empty-state">Kein aktives Turnier. Klick oben auf „+ Neues Turnier", um eins anzulegen.</div>
      ) : (
        <div className="tournament-grid">
          {activeTournaments.map((t) => (
            <TournamentCard key={t.id} tournament={t} onClick={() => onSelect(t.id)} />
          ))}
        </div>
      )}

      {archivedTournaments.length > 0 && (
        <>
          <h2 className="section-title">Archiv</h2>
          <div className="tournament-grid">
            {archivedTournaments.map((t) => (
              <TournamentCard key={t.id} tournament={t} onClick={() => onSelect(t.id)} archived />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TournamentCard(props: { tournament: TournamentDoc; onClick: () => void; archived?: boolean }) {
  const { tournament, onClick, archived } = props;
  return (
    <button className={'tournament-card' + (archived ? ' archived' : '')} onClick={onClick} type="button">
      <div className="tournament-card-name">{tournament.name}</div>
      <div className="tournament-card-meta">
        {tournament.participants.length} Teilnehmer:innen ·{' '}
        {tournament.format === 'double-elim'
          ? 'Double-Elimination'
          : tournament.format === 'swiss'
          ? 'Schweizer System'
          : tournament.format === 'team-doubles'
          ? 'Mixed-Team-Doppel'
          : `${tournament.groups.length} ${tournament.groups.length === 1 ? 'Gruppe' : 'Gruppen'}`}
      </div>
      {archived && <span className="archived-tag">Archiviert</span>}
    </button>
  );
}

function TournamentView(props: {
  tournament: TournamentDoc;
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
  user: User | null;
  onNextSwissRound: () => void;
  onToggleWithdrawn: (playerName: string) => void;
}) {
  const { tournament, sets, onSetChange, readOnly, user, onNextSwissRound, onToggleWithdrawn } = props;

  if (tournament.format === 'double-elim') {
    return (
      <>
        {readOnly && (
          <p className="archived-note">Dieses Turnier ist archiviert und wird nur noch angezeigt, nicht mehr bearbeitet.</p>
        )}
        <DoubleEliminationView tournament={tournament} sets={sets} onSetChange={onSetChange} readOnly={readOnly} />
      </>
    );
  }

  if (tournament.format === 'swiss') {
    return (
      <>
        {readOnly && (
          <p className="archived-note">Dieses Turnier ist archiviert und wird nur noch angezeigt, nicht mehr bearbeitet.</p>
        )}
        <SwissView
          tournament={tournament}
          sets={sets}
          onSetChange={onSetChange}
          readOnly={readOnly}
          user={user}
          onNextRound={onNextSwissRound}
        />
      </>
    );
  }

  if (tournament.format === 'team-doubles') {
    return (
      <>
        {readOnly && (
          <p className="archived-note">Dieses Turnier ist archiviert und wird nur noch angezeigt, nicht mehr bearbeitet.</p>
        )}
        <TeamDoublesView tournament={tournament} sets={sets} onSetChange={onSetChange} readOnly={readOnly} />
      </>
    );
  }

  return (
    <>
      {readOnly && <p className="archived-note">Dieses Turnier ist archiviert und wird nur noch angezeigt, nicht mehr bearbeitet.</p>}
      <GroupsKOView
        tournament={tournament}
        sets={sets}
        onSetChange={onSetChange}
        readOnly={readOnly}
        user={user}
        onToggleWithdrawn={onToggleWithdrawn}
      />
    </>
  );
}

function TeamDoublesView(props: {
  tournament: TournamentDoc;
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
}) {
  const { tournament, sets, onSetChange, readOnly } = props;
  const { teamDoublesRed: red, teamDoublesBlue: blue, teamDoublesRounds: rounds, teamDoublesScoringMode: mode } = tournament;
  const score = computeTeamDoublesScore(rounds, sets, mode);

  return (
    <>
      <p className="section-sub">
        Mixed-Team-Doppel über {rounds.length} {rounds.length === 1 ? 'Runde' : 'Runden'} – Team Rot gegen Team Blau.
        Zählweise: {mode === 'games' ? 'gewonnene Spiele (Games)' : 'Matchsiege'}.
      </p>

      <div className="td-scoreboard">
        <div className="td-team td-team-red">
          <div className="td-team-label">Rot</div>
          <div className="td-team-score">{score.red}</div>
        </div>
        <div className="td-vs">:</div>
        <div className="td-team td-team-blue">
          <div className="td-team-score">{score.blue}</div>
          <div className="td-team-label">Blau</div>
        </div>
      </div>

      <div className="groups">
        <div className="group-panel">
          <div className="group-head">
            <h3 style={{ color: 'var(--clay-dark)' }}>Team Rot</h3>
          </div>
          <p className="section-sub" style={{ margin: 0 }}>
            {red.men.join(', ') || '–'} <br />
            {red.women.join(', ') || '–'}
          </p>
        </div>
        <div className="group-panel">
          <div className="group-head">
            <h3 style={{ color: '#2b4a7a' }}>Team Blau</h3>
          </div>
          <p className="section-sub" style={{ margin: 0 }}>
            {blue.men.join(', ') || '–'} <br />
            {blue.women.join(', ') || '–'}
          </p>
        </div>
      </div>

      {rounds.map((round, ri) => (
        <div key={ri}>
          <h2 className="section-title">Runde {ri + 1}</h2>
          <div>
            {round.map((m) => (
              <MatchRow
                key={m.id}
                matchId={m.id}
                p1={m.side1.join(' & ')}
                p2={m.side2.join(' & ')}
                sets={sets[m.id]}
                onSetChange={onSetChange}
                readOnly={readOnly}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function GroupsKOView(props: {
  tournament: TournamentDoc;
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
  user: User | null;
  onToggleWithdrawn: (playerName: string) => void;
}) {
  const { tournament, sets, onSetChange, readOnly, user, onToggleWithdrawn } = props;
  const groups = tournament.groups;
  const withdrawn = tournament.withdrawnPlayers || [];

  const qualifierOrder = buildQualifierOrder(groups, sets, withdrawn);
  const bracketRounds = qualifierOrder ? buildBracket(qualifierOrder, sets) : [];
  const finalRound = bracketRounds[bracketRounds.length - 1];
  const finalMatch = finalRound?.[0];
  const champion = finalMatch?.result?.winner
    ? finalMatch.result.winner === 'p1'
      ? finalMatch.p1
      : finalMatch.p2
    : null;

  return (
    <>
      <h2 className="section-title">Gruppenphase</h2>
      <p className="section-sub">
        {tournament.participants.length} Teilnehmer:innen in {groups.length}{' '}
        {groups.length === 1 ? 'Gruppe' : 'Gruppen'} – jede gegen jede, Best of 3. Sieg = 2 Punkte, Niederlage = 0 Punkte.
      </p>

      <div className="groups">
        {groups.map((g) => (
          <GroupPanel
            key={g.label}
            group={g}
            sets={sets}
            onSetChange={onSetChange}
            readOnly={readOnly}
            onlyGroup={groups.length === 1}
            withdrawn={withdrawn}
            isAdmin={!readOnly && !!user}
            onToggleWithdrawn={onToggleWithdrawn}
          />
        ))}
      </div>

      <h2 className="section-title">KO-Runde</h2>
      <p className="section-sub">
        {groups.length === 1
          ? 'Die beiden Bestplatzierten spielen das Finale.'
          : 'Gruppensieger und -zweite ziehen über Kreuz in die KO-Runde ein.'}
      </p>

      {!qualifierOrder ? (
        <div className="empty-state">Die KO-Runde wird freigeschaltet, sobald alle Gruppen fertig gespielt sind.</div>
      ) : (
        <div className="bracket-grid">
          {bracketRounds.map((roundMatches, ri) => (
            <div className="bracket-round" key={ri}>
              <div className="round-label">{roundLabel(bracketRounds.length, ri)}</div>
              <div className="bracket-col">
                {roundMatches.map((m) => (
                  <MatchBox
                    key={m.id}
                    matchId={m.id}
                    locked={!(m.p1 && m.p2)}
                    lockedP1="TBD"
                    lockedP2="TBD"
                    p1={m.p1 || undefined}
                    p2={m.p2 || undefined}
                    sets={sets[m.id]}
                    onSetChange={onSetChange}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="bracket-round champion-col">
            <div className="round-label">Sieger</div>
            <div className={'champion-box' + (champion ? ' revealed' : '')}>
              <span className="cup">🏆</span>
              <div className="cname">{champion || '—'}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DoubleEliminationView(props: {
  tournament: TournamentDoc;
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
}) {
  const { tournament, sets, onSetChange, readOnly } = props;
  const bracket = buildDoubleElimination(tournament.participants, sets);

  const finalDecision = bracket.grandFinalReset || bracket.grandFinal;
  const champion = finalDecision.result?.winner
    ? finalDecision.result.winner === 'p1'
      ? finalDecision.p1
      : finalDecision.p2
    : null;

  return (
    <>
      <p className="section-sub">
        {tournament.participants.length} Teilnehmer:innen · Double-Elimination – zwei Niederlagen bedeuten das Aus.
      </p>

      <h2 className="section-title">Gewinner-Bracket</h2>
      <div className="bracket-grid">
        {bracket.winners.map((round, ri) => (
          <div className="bracket-round" key={'wb' + ri}>
            <div className="round-label">{wbRoundLabel(bracket.winners.length, ri)}</div>
            <div className="bracket-col">
              {round.map((m) => (
                <DEMatchBox key={m.id} match={m} sets={sets} onSetChange={onSetChange} readOnly={readOnly} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-title">Verlierer-Bracket</h2>
      <div className="bracket-grid">
        {bracket.losers.map((round, ri) => (
          <div className="bracket-round" key={'lb' + ri}>
            <div className="round-label">{lbRoundLabel(bracket.losers.length, ri)}</div>
            <div className="bracket-col">
              {round.map((m) => (
                <DEMatchBox key={m.id} match={m} sets={sets} onSetChange={onSetChange} readOnly={readOnly} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-title">Grand Final</h2>
      <p className="section-sub">
        Gewinner-Bracket-Siegerin gegen Verlierer-Bracket-Siegerin. Gewinnt die Verlierer-Bracket-Siegerin, folgt ein
        Entscheidungsspiel (beide stehen dann bei einer Niederlage).
      </p>
      <div className="bracket-grid">
        <div className="bracket-round">
          <div className="round-label">Grand Final</div>
          <div className="bracket-col">
            <DEMatchBox match={bracket.grandFinal} sets={sets} onSetChange={onSetChange} readOnly={readOnly} />
          </div>
        </div>
        {bracket.grandFinalReset && (
          <div className="bracket-round">
            <div className="round-label">Entscheidung</div>
            <div className="bracket-col">
              <DEMatchBox match={bracket.grandFinalReset} sets={sets} onSetChange={onSetChange} readOnly={readOnly} />
            </div>
          </div>
        )}
        <div className="bracket-round champion-col">
          <div className="round-label">Sieger</div>
          <div className={'champion-box' + (champion ? ' revealed' : '')}>
            <span className="cup">🏆</span>
            <div className="cname">{champion || '—'}</div>
          </div>
        </div>
      </div>
    </>
  );
}

function SwissView(props: {
  tournament: TournamentDoc;
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
  user: User | null;
  onNextRound: () => void;
}) {
  const { tournament, sets, onSetChange, readOnly, user, onNextRound } = props;
  const config = getSwissConfig(tournament.participants.length);

  if (!config) {
    return (
      <div className="empty-state">
        Ungültige Teilnehmerzahl für das Schweizer System (aktuell nur 8 oder 16 unterstützt).
      </div>
    );
  }

  const rounds = tournament.swissRounds || [];
  const standingsMap = computeSwissStandings(tournament.participants, rounds, sets, config);
  const standingsList = Object.values(standingsMap).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.name.localeCompare(b.name);
  });

  const lastRound = rounds[rounds.length - 1];
  const lastRoundComplete = !lastRound || lastRound.every((m) => evalMatch(sets[m.id]).winner !== null);
  const canGenerateNext = !readOnly && !!user && lastRoundComplete && rounds.length < config.maxRounds;
  const qualifiers = getSwissQualifiers(tournament.participants, rounds, sets, config);

  return (
    <>
      <p className="section-sub">
        {tournament.participants.length} Teilnehmer:innen · Schweizer System – {config.winThreshold} Siege
        qualifizieren, {config.lossThreshold} Niederlagen scheiden aus (max. {config.maxRounds} Runden).
      </p>

      <h2 className="section-title">Stand</h2>
      <table className="standings swiss-standings">
        <thead>
          <tr>
            <th>Name</th>
            <th>Bilanz</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {standingsList.map((s) => (
            <tr key={s.name} className={s.status === 'qualified' ? 'rank-1' : ''}>
              <td>{s.name}</td>
              <td>
                {s.wins}:{s.losses}
              </td>
              <td>
                {s.status === 'qualified' && <span className="badge">Q</span>}
                {s.status === 'eliminated' && <span className="status-out">Ausgeschieden</span>}
                {s.status === 'alive' && <span className="status-alive">im Rennen</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rounds.map((round, ri) => (
        <div key={ri}>
          <h2 className="section-title">Runde {ri + 1}</h2>
          <div>
            {round.map((m) => (
              <MatchRow
                key={m.id}
                matchId={m.id}
                p1={m.p1}
                p2={m.p2}
                sets={sets[m.id]}
                onSetChange={onSetChange}
                readOnly={readOnly}
              />
            ))}
          </div>
        </div>
      ))}

      {canGenerateNext && (
        <button className="btn-primary" type="button" onClick={onNextRound} style={{ marginTop: 16, marginBottom: 32 }}>
          Nächste Runde auslosen
        </button>
      )}
      {!canGenerateNext && !readOnly && !lastRoundComplete && (
        <p className="form-hint" style={{ marginTop: 12 }}>
          Nächste Runde wird auslosbar, sobald alle Spiele dieser Runde ein Ergebnis haben.
        </p>
      )}

      {qualifiers && (
        <>
          <h2 className="section-title">K.-o.-Runde</h2>
          <p className="section-sub">
            Unbesiegte aus der Swiss-Phase wurden auf unterschiedliche Bracket-Hälften gesetzt – sie können sich
            frühestens im Finale treffen.
          </p>
          <SwissKnockout
            qualifiers={buildSwissKOSeedOrder(qualifiers, standingsMap)}
            sets={sets}
            onSetChange={onSetChange}
            readOnly={readOnly}
          />
        </>
      )}
    </>
  );
}

function SwissKnockout(props: {
  qualifiers: string[];
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
}) {
  const { qualifiers, sets, onSetChange, readOnly } = props;
  const rounds = buildBracket(qualifiers, sets);
  const finalRound = rounds[rounds.length - 1];
  const finalMatch = finalRound?.[0];
  const champion = finalMatch?.result?.winner
    ? finalMatch.result.winner === 'p1'
      ? finalMatch.p1
      : finalMatch.p2
    : null;

  return (
    <div className="bracket-grid">
      {rounds.map((roundMatches, ri) => (
        <div className="bracket-round" key={ri}>
          <div className="round-label">{roundLabel(rounds.length, ri)}</div>
          <div className="bracket-col">
            {roundMatches.map((m) => (
              <MatchBox
                key={m.id}
                matchId={m.id}
                locked={!(m.p1 && m.p2)}
                lockedP1="TBD"
                lockedP2="TBD"
                p1={m.p1 || undefined}
                p2={m.p2 || undefined}
                sets={sets[m.id]}
                onSetChange={onSetChange}
                readOnly={readOnly}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="bracket-round champion-col">
        <div className="round-label">Sieger</div>
        <div className={'champion-box' + (champion ? ' revealed' : '')}>
          <span className="cup">🏆</span>
          <div className="cname">{champion || '—'}</div>
        </div>
      </div>
    </div>
  );
}

function DEMatchBox(props: {
  match: DEMatch;
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
}) {
  const { match, sets, onSetChange, readOnly } = props;
  return (
    <MatchBox
      matchId={match.id}
      locked={!(match.p1 && match.p2)}
      lockedP1="TBD"
      lockedP2="TBD"
      p1={match.p1 || undefined}
      p2={match.p2 || undefined}
      sets={sets[match.id]}
      onSetChange={onSetChange}
      readOnly={readOnly}
    />
  );
}

function GroupPanel(props: {
  group: GroupInfo;
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
  onlyGroup: boolean;
  withdrawn: string[];
  isAdmin: boolean;
  onToggleWithdrawn: (playerName: string) => void;
}) {
  const { group, sets, onSetChange, readOnly, onlyGroup, withdrawn, isAdmin, onToggleWithdrawn } = props;
  const standings = groupStandings(group.matches, sets, group.players, withdrawn);
  const complete = groupComplete(group.matches, sets, withdrawn);

  return (
    <div className="group-panel">
      <div className="group-head">
        <h3>{onlyGroup ? 'Tabelle' : `Gruppe ${group.label}`}</h3>
        <span>{group.players.join(' · ')}</span>
      </div>
      <table className="standings">
        <thead>
          <tr>
            <th>Platz</th>
            <th>Name</th>
            <th>Sp.</th>
            <th>Pkt.</th>
            <th>Sätze</th>
            <th>Spiele</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row, idx) => (
            <tr key={row.name} className={row.withdrawn ? '' : idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : ''}>
              <td>{row.withdrawn ? '–' : idx + 1}</td>
              <td>
                {row.name}
                {!row.withdrawn && idx < 2 && <span className="badge">KO</span>}
                {row.withdrawn && <span className="status-out">(w.o.)</span>}
                {isAdmin && (
                  <button
                    type="button"
                    className="withdraw-btn"
                    title={row.withdrawn ? 'Rückzug aufheben' : 'Als verletzungsbedingt zurückgezogen markieren'}
                    onClick={() => onToggleWithdrawn(row.name)}
                  >
                    {row.withdrawn ? 'zurücknehmen' : 'w.o.'}
                  </button>
                )}
              </td>
              <td>{row.played}</td>
              <td className="pts">{row.points}</td>
              <td>
                {row.setsWon}:{row.setsLost}
              </td>
              <td>
                {row.gamesWon}:{row.gamesLost}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!complete && <p className="provisional-note">Tabelle ist vorläufig, solange noch Spiele offen sind.</p>}
      {withdrawn.some((n) => group.players.includes(n)) && (
        <p className="provisional-note">
          Zurückgezogene Spieler:innen zählen mit keinem ihrer Spiele (weder gespielt noch offen) in der Tabelle.
        </p>
      )}
      <div className="match-list">
        {group.matches.map((m) => (
          <MatchRow
            key={m.id}
            matchId={m.id}
            p1={m.p1}
            p2={m.p2}
            sets={sets[m.id]}
            onSetChange={onSetChange}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

function MatchRow(props: {
  matchId: string;
  p1: string;
  p2: string;
  sets?: SetsMap[string];
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
}) {
  const { matchId, p1, p2, sets, onSetChange, readOnly } = props;
  const safeSets = sets || emptyMatchSets();
  const r = evalMatch(safeSets as any);

  // Meta-Slot (Index 3) setzen/löschen, ohne die echten Satz-Felder (0-2)
  // anzutasten – die bleiben immer exakt so stehen, wie eingetragen.
  const setMeta = (value: 'WO', side: 'a' | 'b') => {
    onSetChange(matchId, 3, 'a', side === 'a' ? value : '');
    onSetChange(matchId, 3, 'b', side === 'b' ? value : '');
  };
  const clearMeta = () => {
    // Neues Schema (Index 3) immer löschen.
    onSetChange(matchId, 3, 'a', '');
    onSetChange(matchId, 3, 'b', '');
    // Abwärtskompatibilität: falls noch der alte Marker in Satz 1 steht, den auch entfernen.
    if (safeSets[0]?.a === 'WO' || safeSets[0]?.b === 'WO') {
      onSetChange(matchId, 0, 'a', '');
      onSetChange(matchId, 0, 'b', '');
    }
  };

  const displayValue = (v: string) => (v === 'WO' || v === 'INJ' ? '' : v);

  const hasOverride = !!r.walkover;
  const p1IsWO = r.walkover === 'p1';
  const p2IsWO = r.walkover === 'p2';

  return (
    <div className="scoreboard">
      <div className="scoreboard-labels">
        <span></span>
        <span>S1</span>
        <span>S2</span>
        <span>S3</span>
      </div>
      <div className={'scoreboard-row' + (r.winner === 'p1' ? ' winner' : '')}>
        <div className="scoreboard-name">
          {p1}
          {p1IsWO && (
            <span className="wo-tag">
              (w.o.)
              {!readOnly && (
                <button type="button" className="wo-tag-undo" title="W.O. zurücknehmen" onClick={clearMeta}>
                  ×
                </button>
              )}
            </span>
          )}
          {!readOnly && !hasOverride && (
            <button type="button" className="wo-btn" title="Diese Person tritt nicht mehr an / gibt auf – Ergebnis bleibt stehen" onClick={() => setMeta('WO', 'a')}>
              Aufgabe
            </button>
          )}
        </div>
        {[0, 1, 2].map((idx) => (
          <div className="scoreboard-cell" key={idx}>
            <input
              type="number"
              min={0}
              max={20}
              value={displayValue(safeSets[idx].a)}
              disabled={readOnly}
              onChange={(e) => onSetChange(matchId, idx, 'a', e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className={'scoreboard-row' + (r.winner === 'p2' ? ' winner' : '')}>
        <div className="scoreboard-name">
          {p2}
          {p2IsWO && (
            <span className="wo-tag">
              (w.o.)
              {!readOnly && (
                <button type="button" className="wo-tag-undo" title="W.O. zurücknehmen" onClick={clearMeta}>
                  ×
                </button>
              )}
            </span>
          )}
          {!readOnly && !hasOverride && (
            <button type="button" className="wo-btn" title="Diese Person tritt nicht mehr an / gibt auf – Ergebnis bleibt stehen" onClick={() => setMeta('WO', 'b')}>
              Aufgabe
            </button>
          )}
        </div>
        {[0, 1, 2].map((idx) => (
          <div className="scoreboard-cell" key={idx}>
            <input
              type="number"
              min={0}
              max={20}
              value={displayValue(safeSets[idx].b)}
              disabled={readOnly}
              onChange={(e) => onSetChange(matchId, idx, 'b', e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchBox(props: {
  matchId: string;
  locked: boolean;
  lockedP1: string;
  lockedP2: string;
  p1?: string;
  p2?: string;
  sets?: SetsMap[string];
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
}) {
  const { matchId, locked, lockedP1, lockedP2, p1, p2, sets, onSetChange, readOnly } = props;
  return (
    <div className="match-box">
      {locked ? (
        <>
          <div className="match-players">
            <span className="pname">{lockedP1}</span>
            <span className="vs">vs.</span>
            <span className="pname">{lockedP2}</span>
          </div>
          <div className="lock-msg">Wird freigeschaltet, sobald die vorherige Runde entschieden ist.</div>
        </>
      ) : (
        <MatchRow
          matchId={matchId}
          p1={p1 as string}
          p2={p2 as string}
          sets={sets}
          onSetChange={onSetChange}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

function AdminLoginForm(props: { onClose: () => void }) {
  const { onClose } = props;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      onClose();
    } catch (e) {
      setError('Anmeldung fehlgeschlagen. E-Mail oder Passwort prüfen.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-form">
      <h3>Admin-Login</h3>
      <label htmlFor="admin-email">E-Mail</label>
      <input id="admin-email" type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@example.com" />
      <label htmlFor="admin-pw">Passwort</label>
      <input
        id="admin-pw"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
        }}
      />
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="btn-primary" type="button" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Prüfe …' : 'Anmelden'}
        </button>
        <button className="btn-secondary" type="button" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function CreateTournamentForm(props: {
  onCreate: (payload: {
    name: string;
    format: TournamentFormat;
    participants: string[];
    men?: string[];
    women?: string[];
    roundsCount?: number;
    scoringMode?: TeamDoublesScoringMode;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const { onCreate, onCancel } = props;
  const [name, setName] = useState('');
  const [namesText, setNamesText] = useState('');
  const [menText, setMenText] = useState('');
  const [womenText, setWomenText] = useState('');
  const [roundsCount, setRoundsCount] = useState(3);
  const [scoringMode, setScoringMode] = useState<TeamDoublesScoringMode>('wins');
  const [format, setFormat] = useState<TournamentFormat>('groups');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const participants = namesText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const men = menText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const women = womenText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Bitte einen Turniernamen eingeben.');
      return;
    }

    if (format === 'team-doubles') {
      const total = men.length + women.length;
      if (total < 4) {
        setError('Mindestens 4 Teilnehmer:innen nötig (zusammen Männer + Frauen).');
        return;
      }
      if (total % 2 !== 0) {
        setError(`Die Gesamtzahl muss gerade sein, damit beide Teams gleich groß werden. Aktuell: ${total}.`);
        return;
      }
      if (roundsCount < 1) {
        setError('Mindestens 1 Runde nötig.');
        return;
      }
      setError('');
      setSubmitting(true);
      try {
        await onCreate({ name: name.trim(), format, participants: [], men, women, roundsCount, scoringMode });
      } catch (e: any) {
        console.error('Turnier anlegen fehlgeschlagen:', e);
        const detail = e?.code || e?.message || String(e);
        setError(`Konnte Turnier nicht anlegen (${detail}). Bitte nochmal versuchen.`);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (participants.length < 3) {
      setError('Mindestens 3 Teilnehmer:innen nötig (eine pro Zeile).');
      return;
    }
    if (format === 'double-elim' && !isPowerOfTwo(participants.length)) {
      setError(
        `Double-Elimination braucht aktuell eine Zweierpotenz an Teilnehmer:innen (4, 8, 16, 32 …). Du hast ${participants.length} eingetragen.`
      );
      return;
    }
    if (format === 'swiss' && !getSwissConfig(participants.length)) {
      setError(
        `Schweizer System ist aktuell nur mit genau 8 oder 16 Teilnehmer:innen möglich. Du hast ${participants.length} eingetragen.`
      );
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onCreate({ name: name.trim(), format, participants });
    } catch (e: any) {
      console.error('Turnier anlegen fehlgeschlagen:', e);
      const detail = e?.code || e?.message || String(e);
      setError(`Konnte Turnier nicht anlegen (${detail}). Bitte nochmal versuchen.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-form">
      <h3>Neues Turnier erstellen</h3>
      <label htmlFor="tname">Turniername</label>
      <input id="tname" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Herbstturnier 2026" />

      <label htmlFor="tformat">Turnierformat</label>
      <select
        id="tformat"
        className="tournament-select"
        value={format}
        onChange={(e) => setFormat(e.target.value as TournamentFormat)}
      >
        <option value="groups">Gruppen + K.-o.-Runde (automatischer Modus je nach Teilnehmerzahl)</option>
        <option value="double-elim">Double-Elimination (nur bei 4, 8, 16, 32 … Teilnehmer:innen)</option>
        <option value="swiss">Schweizer System (nur bei genau 8 oder 16 Teilnehmer:innen)</option>
        <option value="team-doubles">Mixed-Team-Doppel (Rot vs. Blau)</option>
      </select>

      {format === 'team-doubles' ? (
        <>
          <label htmlFor="tmen">Männer (ein Name pro Zeile)</label>
          <textarea id="tmen" value={menText} onChange={(e) => setMenText(e.target.value)} placeholder={'Peter\nTom\n...'} />
          <label htmlFor="twomen">Frauen (ein Name pro Zeile)</label>
          <textarea id="twomen" value={womenText} onChange={(e) => setWomenText(e.target.value)} placeholder={'Maria\nLisa\n...'} />
          <label htmlFor="trounds">Anzahl Runden</label>
          <input
            id="trounds"
            type="number"
            min={1}
            max={10}
            value={roundsCount}
            onChange={(e) => setRoundsCount(Math.max(1, Number(e.target.value) || 1))}
            style={{ maxWidth: 100 }}
          />
          <label htmlFor="tscoring">Zählweise</label>
          <select
            id="tscoring"
            className="tournament-select"
            value={scoringMode}
            onChange={(e) => setScoringMode(e.target.value as TeamDoublesScoringMode)}
          >
            <option value="wins">Nur Matchsiege zählen (1 Punkt pro gewonnenem Match)</option>
            <option value="games">Gewonnene Spiele (Games) zählen, z. B. 6:3 6:3 → 12:6</option>
          </select>
          <p className="form-hint">
            {men.length} Mann/Männer, {women.length} Frau(en) erkannt ({men.length + women.length} gesamt) – Teams
            Rot/Blau werden zufällig gebildet, Geschlechterverteilung möglichst ausgeglichen. Gespielt wird
            Mixed-Doppel; bleibt je 1 Person pro Team übrig, spielen die Einzel.
          </p>
        </>
      ) : (
        <>
          <label htmlFor="tnames">Teilnehmer:innen (ein Name pro Zeile)</label>
          <textarea
            id="tnames"
            value={namesText}
            onChange={(e) => setNamesText(e.target.value)}
            placeholder={'Kathi\nMichelle\nYvonne\n...'}
          />
          <p className="form-hint">
            {participants.length} Name{participants.length === 1 ? '' : 'n'} erkannt
            {participants.length >= 3 && format === 'groups' ? ` – Gruppenmodus wird automatisch passend gewählt.` : ''}
            {format === 'double-elim' ? ` – Reihenfolge wird vor der Auslosung zufällig gemischt.` : ''}
            {format === 'swiss' ? ` – Runde 1 wird zufällig ausgelost, weitere Runden nach Bilanz.` : ''}
          </p>
        </>
      )}

      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="btn-primary" type="button" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Erstelle …' : 'Turnier erstellen'}
        </button>
        <button className="btn-secondary" type="button" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
