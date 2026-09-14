'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { stateDocRef } from '@/lib/firebaseClient';
import {
  groupA,
  groupB,
  groupMatchesA,
  groupMatchesB,
  emptySetsMap,
  evalMatch,
  groupStandings,
  groupComplete,
  SetsMap,
  GroupMatch,
  StandingRow
} from '@/lib/tournament';

type Status = '' | 'loading' | 'saving' | 'saved' | 'error';

export default function TournamentBoard() {
  const [sets, setSets] = useState<SetsMap>(emptySetsMap());
  const [status, setStatus] = useState<Status>('loading');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextRemote = useRef(false);

  // Initiales Laden
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const snap = await getDoc(stateDocRef);
        if (!active) return;
        const data = snap.exists() ? snap.data() : null;
        if (data && data.sets) {
          setSets({ ...emptySetsMap(), ...data.sets });
        }
        setStatus('');
      } catch (e) {
        if (active) setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Realtime: Änderungen von anderen Geräten übernehmen
  useEffect(() => {
    const unsubscribe = onSnapshot(
      stateDocRef,
      (snap) => {
        if (skipNextRemote.current) {
          skipNextRemote.current = false;
          return;
        }
        const data = snap.data();
        if (data && data.sets) setSets({ ...emptySetsMap(), ...data.sets });
      },
      () => setStatus('error')
    );
    return () => unsubscribe();
  }, []);

  const scheduleSave = useCallback((nextSets: SetsMap) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus('saving');
    saveTimer.current = setTimeout(async () => {
      skipNextRemote.current = true;
      try {
        await setDoc(stateDocRef, { sets: nextSets, updatedAt: Date.now() }, { merge: true });
        setStatus('saved');
        setTimeout(() => setStatus(''), 1500);
      } catch (e) {
        setStatus('error');
      }
    }, 500);
  }, []);

  const handleSetChange = (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => {
    setSets((prev) => {
      const current = prev[matchId] || [{ a: '', b: '' }, { a: '', b: '' }, { a: '', b: '' }];
      const nextMatchSets = current.map((s, i) =>
        i === setIdx ? { ...s, [player]: value } : s
      ) as SetsMap[string];
      const next = { ...prev, [matchId]: nextMatchSets };
      scheduleSave(next);
      return next;
    });
  };

  const handleReset = async () => {
    if (!confirm('Wirklich alle Ergebnisse zurücksetzen? Das gilt für alle, die den Link nutzen.')) return;
    const blank = emptySetsMap();
    setSets(blank);
    skipNextRemote.current = true;
    try {
      await setDoc(stateDocRef, { sets: blank, updatedAt: Date.now() }, { merge: true });
    } catch (e) {
      setStatus('error');
    }
  };

  const stA = groupStandings(groupMatchesA, sets, groupA);
  const stB = groupStandings(groupMatchesB, sets, groupB);
  const groupsDone = groupComplete(groupMatchesA, sets) && groupComplete(groupMatchesB, sets);

  const sf1 = groupsDone ? { id: 'SF1', p1: stA[0].name, p2: stB[1].name } : null;
  const sf2 = groupsDone ? { id: 'SF2', p1: stB[0].name, p2: stA[1].name } : null;
  const sf1Result = sf1 ? evalMatch(sets['SF1']) : null;
  const sf2Result = sf2 ? evalMatch(sets['SF2']) : null;
  const finalReady = !!(sf1Result?.winner && sf2Result?.winner);
  const finalP1 = finalReady ? (sf1Result!.winner === 'p1' ? sf1!.p1 : sf1!.p2) : null;
  const finalP2 = finalReady ? (sf2Result!.winner === 'p1' ? sf2!.p1 : sf2!.p2) : null;
  const finalResult = finalReady ? evalMatch(sets['F']) : null;
  const champion = finalResult?.winner
    ? finalResult.winner === 'p1'
      ? finalP1
      : finalP2
    : null;

  return (
    <div className="wrap">
      <div className="hero">
        <div className="hero-inner">
          <h1>TURNIERTABELLE</h1>
          <p>Gruppenphase, Tabelle und Halbfinale/Finale – live für alle mit diesem Link.</p>
          <div className="toolbar">
            <button className="tool-btn" onClick={handleReset} type="button">
              Zurücksetzen
            </button>
            <span className="save-status">
              {status === 'loading' && 'Lade …'}
              {status === 'saving' && 'Speichere …'}
              {status === 'saved' && 'Gespeichert ✓'}
              {status === 'error' && 'Verbindung fehlgeschlagen'}
            </span>
          </div>
        </div>
      </div>

      <h2 className="section-title">Gruppenphase</h2>
      <p className="section-sub">Jede gegen jede – Best of 3. Sieg = 2 Punkte, Niederlage = 0 Punkte.</p>

      <div className="groups">
        <GroupPanel
          title="Gruppe A"
          subtitle={groupA.join(' · ')}
          matches={groupMatchesA}
          sets={sets}
          onSetChange={handleSetChange}
          standings={stA}
          complete={groupComplete(groupMatchesA, sets)}
        />
        <div className="net-divider" />
        <GroupPanel
          title="Gruppe B"
          subtitle={groupB.join(' · ')}
          matches={groupMatchesB}
          sets={sets}
          onSetChange={handleSetChange}
          standings={stB}
          complete={groupComplete(groupMatchesB, sets)}
        />
      </div>

      <h2 className="section-title">KO-Runde</h2>
      <p className="section-sub">Gruppenerster trifft auf Gruppenzweiten der jeweils anderen Gruppe.</p>

      <div className="bracket-grid">
        <div className="bracket-col semis">
          <MatchBox
            label="Halbfinale 1"
            locked={!sf1}
            lockedP1="Sieger Gruppe A"
            lockedP2="Zweiter Gruppe B"
            matchId="SF1"
            p1={sf1?.p1}
            p2={sf1?.p2}
            sets={sets['SF1']}
            onSetChange={handleSetChange}
          />
          <MatchBox
            label="Halbfinale 2"
            locked={!sf2}
            lockedP1="Sieger Gruppe B"
            lockedP2="Zweiter Gruppe A"
            matchId="SF2"
            p1={sf2?.p1}
            p2={sf2?.p2}
            sets={sets['SF2']}
            onSetChange={handleSetChange}
          />
        </div>
        <div className="connector">
          <svg viewBox="0 0 34 200" preserveAspectRatio="none">
            <path d="M0,40 H17 V100 H0" fill="none" stroke="#C9C2B2" strokeWidth="2" />
            <path d="M0,160 H17 V100 H0" fill="none" stroke="#C9C2B2" strokeWidth="2" />
            <path d="M17,100 H34" fill="none" stroke="#C9C2B2" strokeWidth="2" />
          </svg>
        </div>
        <div className="bracket-col">
          <MatchBox
            label="Finale"
            locked={!finalReady}
            lockedP1="Sieger HF1"
            lockedP2="Sieger HF2"
            matchId="F"
            p1={finalP1 || undefined}
            p2={finalP2 || undefined}
            sets={sets['F']}
            onSetChange={handleSetChange}
          />
        </div>
        <div className="connector">
          <svg viewBox="0 0 34 60" preserveAspectRatio="none">
            <path d="M0,30 H34" fill="none" stroke="#C9C2B2" strokeWidth="2" />
          </svg>
        </div>
        <div className="bracket-col champion-col">
          <div className={'champion-box' + (champion ? ' revealed' : '')}>
            <span className="cup">🏆</span>
            <div className="clabel">Turniersieger</div>
            <div className="cname">{champion || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupPanel(props: {
  title: string;
  subtitle: string;
  matches: GroupMatch[];
  sets: SetsMap;
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
  standings: StandingRow[];
  complete: boolean;
}) {
  const { title, subtitle, matches, sets, onSetChange, standings, complete } = props;
  return (
    <div className="group-panel">
      <div className="group-head">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      <div>
        {matches.map((m) => (
          <MatchRow
            key={m.id}
            matchId={m.id}
            p1={m.p1}
            p2={m.p2}
            sets={sets[m.id]}
            onSetChange={onSetChange}
          />
        ))}
      </div>
      <table className="standings">
        <thead>
          <tr>
            <th>Platz</th>
            <th>Name</th>
            <th>Sp.</th>
            <th>Pkt.</th>
            <th>Sätze</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row, idx) => (
            <tr key={row.name} className={idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : ''}>
              <td>{idx + 1}</td>
              <td>
                {row.name}
                {idx < 2 && <span className="badge">HF</span>}
              </td>
              <td>{row.played}</td>
              <td className="pts">{row.points}</td>
              <td>
                {row.setsWon}:{row.setsLost}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!complete && <p className="provisional-note">Tabelle ist vorläufig, solange noch Spiele offen sind.</p>}
    </div>
  );
}

function MatchRow(props: {
  matchId: string;
  p1: string;
  p2: string;
  sets?: SetsMap[string];
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
}) {
  const { matchId, p1, p2, sets, onSetChange } = props;
  const safeSets = sets || [{ a: '', b: '' }, { a: '', b: '' }, { a: '', b: '' }];
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
              onChange={(e) => onSetChange(matchId, idx, 'b', e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchBox(props: {
  label: string;
  locked: boolean;
  lockedP1: string;
  lockedP2: string;
  matchId: string;
  p1?: string;
  p2?: string;
  sets?: SetsMap[string];
  onSetChange: (matchId: string, setIdx: number, player: 'a' | 'b', value: string) => void;
}) {
  const { label, locked, lockedP1, lockedP2, matchId, p1, p2, sets, onSetChange } = props;
  return (
    <div className="match-box">
      <div className="box-label">{label}</div>
      {locked ? (
        <>
          <div className="match-players">
            <span className="pname">{lockedP1}</span>
            <span className="vs">vs.</span>
            <span className="pname">{lockedP2}</span>
          </div>
          <div className="lock-msg">Wird freigeschaltet, sobald die Gruppenphase abgeschlossen ist.</div>
        </>
      ) : (
        <MatchRow matchId={matchId} p1={p1 as string} p2={p2 as string} sets={sets} onSetChange={onSetChange} />
      )}
    </div>
  );
}
