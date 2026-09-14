'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addDoc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { tournamentDocRef, tournamentsCollectionRef } from '@/lib/firebaseClient';
import {
  GroupInfo,
  SetsMap,
  StandingRow,
  BracketMatch,
  emptyMatchSets,
  evalMatch,
  groupStandings,
  groupComplete,
  buildQualifierOrder,
  buildBracket,
  roundLabel,
  chooseGroupCount,
  buildGroups,
  shuffleArray
} from '@/lib/tournament';

type Status = '' | 'loading' | 'saving' | 'saved' | 'error';

type TournamentDoc = {
  id: string;
  name: string;
  participants: string[];
  groups: GroupInfo[];
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextRemote = useRef(false);

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
            sets: data.sets || {},
            status: data.status === 'archived' ? 'archived' : 'active',
            createdAt: data.createdAt || 0
          };
        });
        setTournaments(list);
        setStatus('');
        setSelectedId((prev) => {
          if (prev && list.some((t) => t.id === prev)) return prev;
          const firstActive = list.find((t) => t.status === 'active');
          return firstActive ? firstActive.id : list[0]?.id || null;
        });
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
      const nextMatchSets = current.map((s, i) => (i === setIdx ? { ...s, [player]: value } : s)) as SetsMap[string];
      const next = { ...prev, [matchId]: nextMatchSets };
      scheduleSave(tournamentId, next);
      return next;
    });
  };

  const handleReset = async () => {
    if (!selected) return;
    if (!confirm(`Wirklich alle Ergebnisse von "${selected.name}" zurücksetzen?`)) return;
    setLocalSets({});
    skipNextRemote.current = true;
    try {
      await setDoc(tournamentDocRef(selected.id), { sets: {} }, { merge: true });
    } catch (e) {
      setStatus('error');
    }
  };

  const handleToggleArchive = async (t: TournamentDoc) => {
    try {
      await setDoc(tournamentDocRef(t.id), { status: t.status === 'archived' ? 'active' : 'archived' }, { merge: true });
    } catch (e) {
      setStatus('error');
    }
  };

  const handleCreate = async (name: string, participants: string[]) => {
    const shuffled = shuffleArray(participants);
    const groupCount = chooseGroupCount(shuffled.length);
    const groups = buildGroups(shuffled, groupCount);
    const ref = await addDoc(tournamentsCollectionRef, {
      name,
      participants,
      groups,
      sets: {},
      status: 'active',
      createdAt: Date.now()
    });
    setSelectedId(ref.id);
    setShowCreateForm(false);
  };

  const activeTournaments = tournaments.filter((t) => t.status === 'active');
  const archivedTournaments = tournaments.filter((t) => t.status === 'archived');
  const readOnly = selected?.status === 'archived';

  return (
    <div className="wrap">
      <div className="hero">
        <div className="hero-inner">
          <h1>TURNIERTABELLE</h1>
          <p>Gruppenphase, Tabelle und KO-Runde – live für alle mit diesem Link, für beliebig viele Turniere gleichzeitig.</p>

          <div className="tournament-bar">
            {tournaments.length > 0 && (
              <select
                className="tournament-select"
                value={selectedId || ''}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {activeTournaments.length > 0 && (
                  <optgroup label="Aktive Turniere">
                    {activeTournaments.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {showArchive && archivedTournaments.length > 0 && (
                  <optgroup label="Archiv">
                    {archivedTournaments.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
            <button className="tool-btn" onClick={() => setShowCreateForm((v) => !v)} type="button">
              + Neues Turnier
            </button>
            {archivedTournaments.length > 0 && (
              <button className="tool-btn" onClick={() => setShowArchive((v) => !v)} type="button">
                {showArchive ? 'Archiv ausblenden' : `Archiv anzeigen (${archivedTournaments.length})`}
              </button>
            )}
            {selected && (
              <button className="tool-btn" onClick={() => handleToggleArchive(selected)} type="button">
                {selected.status === 'archived' ? 'Reaktivieren' : 'Archivieren'}
              </button>
            )}
            {selected && !readOnly && (
              <button className="tool-btn" onClick={handleReset} type="button">
                Ergebnisse zurücksetzen
              </button>
            )}
            <span className="save-status">
              {status === 'loading' && 'Lade …'}
              {status === 'saving' && 'Speichere …'}
              {status === 'saved' && 'Gespeichert ✓'}
              {status === 'error' && 'Verbindung fehlgeschlagen'}
            </span>
          </div>
        </div>
      </div>

      {showCreateForm && (
        <CreateTournamentForm onCreate={handleCreate} onCancel={() => setShowCreateForm(false)} />
      )}

      {!selected && !showCreateForm && (
        <div className="empty-state">
          {tournaments.length === 0
            ? 'Noch kein Turnier angelegt. Klick oben auf „+ Neues Turnier", um loszulegen.'
            : 'Kein Turnier ausgewählt.'}
        </div>
      )}

      {selected && (
        <TournamentView
          key={selected.id}
          tournament={selected}
          sets={localSets}
          onSetChange={handleSetChange}
          readOnly={!!readOnly}
        />
      )}
    </div>
  );
}

function TournamentView(props: {
  tournament: TournamentDoc;
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
}) {
  const { tournament, sets, onSetChange, readOnly } = props;
  const groups = tournament.groups;

  const qualifierOrder = buildQualifierOrder(groups, sets);
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
      {readOnly && <p className="archived-note">Dieses Turnier ist archiviert und wird nur noch angezeigt, nicht mehr bearbeitet.</p>}

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

function GroupPanel(props: {
  group: GroupInfo;
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  readOnly: boolean;
  onlyGroup: boolean;
}) {
  const { group, sets, onSetChange, readOnly, onlyGroup } = props;
  const standings = groupStandings(group.matches, sets, group.players);
  const complete = groupComplete(group.matches, sets);

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
            <tr key={row.name} className={idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : ''}>
              <td>{idx + 1}</td>
              <td>
                {row.name}
                {idx < 2 && <span className="badge">KO</span>}
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
  return (
    <div className="scoreboard">
      <div className="scoreboard-labels">
        <span></span>
        <span>S1</span>
        <span>S2</span>
        <span>S3</span>
      </div>
      <div className={'scoreboard-row' + (r.winner === 'p1' ? ' winner' : '')}>
        <div className="scoreboard-name">{p1}</div>
        {[0, 1, 2].map((idx) => (
          <div className="scoreboard-cell" key={idx}>
            <input
              type="number"
              min={0}
              max={20}
              value={safeSets[idx].a}
              disabled={readOnly}
              onChange={(e) => onSetChange(matchId, idx, 'a', e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className={'scoreboard-row' + (r.winner === 'p2' ? ' winner' : '')}>
        <div className="scoreboard-name">{p2}</div>
        {[0, 1, 2].map((idx) => (
          <div className="scoreboard-cell" key={idx}>
            <input
              type="number"
              min={0}
              max={20}
              value={safeSets[idx].b}
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

function CreateTournamentForm(props: {
  onCreate: (name: string, participants: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const { onCreate, onCancel } = props;
  const [name, setName] = useState('');
  const [namesText, setNamesText] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const participants = namesText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Bitte einen Turniernamen eingeben.');
      return;
    }
    if (participants.length < 3) {
      setError('Mindestens 3 Teilnehmer:innen nötig (eine pro Zeile).');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onCreate(name.trim(), participants);
    } catch (e) {
      setError('Konnte Turnier nicht anlegen. Bitte nochmal versuchen.');
    } finally {
      setSubmitting(false);
    }
  };

  const previewGroupCount = participants.length >= 3 ? Math.max(1, participants.length) : 0;

  return (
    <div className="create-form">
      <h3>Neues Turnier erstellen</h3>
      <label htmlFor="tname">Turniername</label>
      <input id="tname" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Herbstturnier 2026" />
      <label htmlFor="tnames">Teilnehmer:innen (ein Name pro Zeile)</label>
      <textarea
        id="tnames"
        value={namesText}
        onChange={(e) => setNamesText(e.target.value)}
        placeholder={'Kathi\nMichelle\nYvonne\n...'}
      />
      <p className="form-hint">
        {participants.length} Name{participants.length === 1 ? '' : 'n'} erkannt
        {participants.length >= 3 ? ` – Gruppenmodus wird automatisch passend gewählt.` : ''}
      </p>
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
