import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from './useAppData.js';
import * as api from './api.js';
import {
  playingHcp,
  shotsFor,
  stableford,
  sum,
  rankGroups,
  sharePoints,
  betReturn,
  scoreMark,
  formatName,
  fmt,
  ORDINALS,
} from './scoring.js';

/* ==========================================================================
   STOKER'S STAG — Malaga
   Vite + React + Supabase. Ported from the original single-file artifact;
   scoring math is unchanged, the storage layer now talks to Supabase.
   ========================================================================== */

const VERSION = 'v2026.09.06.supabase.01';

/* ---------------------------------- theme --------------------------------- */

const C = {
  wall: '#F3F4F0',
  panel: '#FFFFFF',
  ink: '#0E2A47',
  ink2: '#4A6683',
  line: '#D8DBD3',
  sun: '#F2A104',
  clay: '#C1440E',
  sea: '#1D6FA5',
  olive: '#6B8F3A',
  good: '#2E7D4F',
};

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/* ------------------------------ local-then-remote -------------------------- */

// Local state updates instantly (so typing never lags); the write to
// Supabase is debounced so a full name/number isn't sent one keystroke
// at a time. Mirrors the original app's local-state + debounced-save split.
function useLocalDebounced(value, commit, delay = 400) {
  const [local, setLocal] = useState(value);
  const dirty = useRef(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!dirty.current) setLocal(value);
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (v) => {
    dirty.current = true;
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dirty.current = false;
      commit(v);
    }, delay);
  };

  return [local, onChange];
}

/* --------------------------------- selectors ------------------------------- */

function useDerived(state) {
  return useMemo(() => {
    const byId = {};
    state.players.forEach((p) => (byId[p.id] = p));
    const teamOf = {};
    state.teams.forEach((t) => t.players.forEach((pid) => (teamOf[pid] = t.id)));

    const points = {};
    state.days.forEach((day) => {
      points[day.id] = {};
      const ph = {};
      state.players.forEach((p) => (ph[p.id] = playingHcp(p.hcp, day.allowance)));
      state.players.forEach((p) => {
        const row = (state.scores[day.id] && state.scores[day.id][p.id]) || Array(18).fill(null);
        points[day.id][p.id] = row.map((g, i) =>
          stableford(g, day.par[i], shotsFor(ph[p.id], day.si[i]))
        );
      });
    });

    const playerTotal = (dayId, pid) => sum(points[dayId][pid] || []);
    const playerRange = (dayId, pid, a, b) => sum((points[dayId][pid] || []).slice(a, b));

    const teamHole = (dayId, team, h) => {
      const day = state.days.find((d) => d.id === dayId);
      const vals = team.players.map((pid) => points[dayId][pid][h]).filter((v) => v != null);
      if (!vals.length) return null;
      if (day.format === 'betterball') return Math.max(...vals);
      return vals.reduce((a, b) => a + b, 0);
    };
    const teamTotal = (dayId, team) => {
      let t = 0;
      for (let h = 0; h < 18; h++) t += teamHole(dayId, team, h) || 0;
      return t;
    };
    const teamCombined = (dayId, team) =>
      team.players.reduce((a, pid) => a + playerTotal(dayId, pid), 0);
    const teamLowest = (dayId, team) => {
      if (!team.players.length) return 0;
      return Math.min(...team.players.map((pid) => playerTotal(dayId, pid)));
    };
    const teamHighest = (dayId, team) => {
      if (!team.players.length) return 0;
      return Math.max(...team.players.map((pid) => playerTotal(dayId, pid)));
    };
    const dayStarted = (dayId) =>
      state.players.some((p) => ((state.scores[dayId] && state.scores[dayId][p.id]) || []).some((v) => v != null));

    const dayComplete = (dayId) => {
      const relevant = state.teams.flatMap((t) => t.players);
      if (!relevant.length) return false;
      return relevant.every((pid) => {
        const row = (state.scores[dayId] && state.scores[dayId][pid]) || [];
        return row.length === 18 && row.every((v) => v != null);
      });
    };

    const holeBest = {};
    state.days.forEach((day) => {
      holeBest[day.id] = Array.from({ length: 18 }, (_, h) => {
        const vals = state.players.map((p) => points[day.id][p.id][h]).filter((v) => v != null);
        return vals.length ? Math.max(...vals) : null;
      });
    });

    return {
      byId,
      teamOf,
      points,
      playerTotal,
      playerRange,
      teamHole,
      teamTotal,
      teamCombined,
      teamLowest,
      teamHighest,
      dayStarted,
      dayComplete,
      holeBest,
    };
  }, [state]);
}

function useStandings(state, d) {
  return useMemo(() => {
    const dayResults = {};

    state.days.forEach((day) => {
      const started = d.dayStarted(day.id);
      const items = state.teams.map((t) => ({
        id: t.id,
        team: t,
        total: d.teamTotal(day.id, t),
        combined: d.teamCombined(day.id, t),
        highest: d.teamHighest(day.id, t),
        lowest: d.teamLowest(day.id, t),
      }));
      const cmp = (a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        if (day.format === 'betterball' && b.combined !== a.combined) return b.combined - a.combined;
        if (b.highest !== a.highest) return b.highest - a.highest;
        if (b.lowest !== a.lowest) return b.lowest - a.lowest;
        return 0;
      };
      const groups = rankGroups(items, cmp);
      dayResults[day.id] = {
        groups,
        started,
        complete: d.dayComplete(day.id),
        points: started ? sharePoints(groups, day.teamPoints) : Object.fromEntries(items.map((it) => [it.id, 0])),
      };
    });

    const indiv = {};
    const mkIndiv = (key) => {
      const items = state.players.map((p) => {
        const t1 = d.playerTotal('d1', p.id);
        const t2 = d.playerTotal('d2', p.id);
        const total = key === 'd1' ? t1 : key === 'd2' ? t2 : t1 + t2;
        const cbDay = key === 'd1' ? 'd1' : 'd2';
        return {
          id: p.id,
          player: p,
          d1: t1,
          d2: t2,
          total,
          cb: [
            key === 'combined' ? t2 : total,
            d.playerRange(cbDay, p.id, 9, 18),
            d.playerRange(cbDay, p.id, 12, 18),
            d.playerRange(cbDay, p.id, 15, 18),
            d.playerRange(cbDay, p.id, 17, 18),
          ],
        };
      });
      const cmp = (a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        for (let i = 0; i < a.cb.length; i++) if (b.cb[i] !== a.cb[i]) return b.cb[i] - a.cb[i];
        return 0;
      };
      const groups = rankGroups(items, cmp);
      return { items, groups };
    };
    indiv.d1 = mkIndiv('d1');
    indiv.d2 = mkIndiv('d2');
    indiv.combined = mkIndiv('combined');

    const ledger = {};
    state.teams.forEach((t) => (ledger[t.id] = { day1: 0, day2: 0, indiv: 0, bonus: 0, rows: [] }));

    state.days.forEach((day, di) => {
      const res = dayResults[day.id];
      state.teams.forEach((t) => {
        const pts = res.points[t.id] || 0;
        if (pts) {
          ledger[t.id][di === 0 ? 'day1' : 'day2'] += pts;
          ledger[t.id].rows.push({ label: day.label + ' — ' + formatName(day.format), pts });
        }
      });
    });

    ['d1', 'd2', 'combined'].forEach((key) => {
      const cfg = state.individual[key];
      if (!cfg || !cfg.enabled) return;
      const relevantStarted =
        key === 'd1' ? d.dayStarted('d1') : key === 'd2' ? d.dayStarted('d2') : d.dayStarted('d1') || d.dayStarted('d2');
      if (!relevantStarted) return;
      const awarded = sharePoints(indiv[key].groups, cfg.points);
      const label =
        key === 'combined' ? 'Individual — overall' : 'Individual — ' + (key === 'd1' ? 'Day 1' : 'Day 2');
      Object.keys(awarded).forEach((pid) => {
        const tid = d.teamOf[pid];
        if (!tid || !awarded[pid]) return;
        ledger[tid].indiv += awarded[pid];
        ledger[tid].rows.push({ label: label + ' (' + d.byId[pid].name + ')', pts: awarded[pid] });
      });
    });

    state.awards.forEach((aw) => {
      aw.winners.forEach((w, i) => {
        if (!w) return;
        const pts = Number(aw.values[i]) || 0;
        if (!pts) return;
        const tid = aw.scope === 'team' ? w : d.teamOf[w];
        if (!tid || !ledger[tid]) return;
        ledger[tid].bonus += pts;
        const who = aw.scope === 'team' ? '' : ' (' + (d.byId[w] ? d.byId[w].name : '') + ')';
        ledger[tid].rows.push({ label: aw.name + who, pts });
      });
    });

    state.teams.forEach((t) => {
      const L = ledger[t.id];
      L.total = L.day1 + L.day2 + L.indiv + L.bonus;
    });

    const teamOrder = rankGroups(
      state.teams.map((t) => ({ id: t.id, team: t, ...ledger[t.id] })),
      (a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        const at = d.teamTotal('d1', a.team) + d.teamTotal('d2', a.team);
        const bt = d.teamTotal('d1', b.team) + d.teamTotal('d2', b.team);
        if (bt !== at) return bt - at;
        return 0;
      }
    );

    const provisional = state.days.some((day) => dayResults[day.id].started && !dayResults[day.id].complete);

    return { dayResults, indiv, ledger, teamOrder, provisional };
  }, [state, d]);
}

/* ------------------------------ UI primitives ----------------------------- */

const Panel = ({ children, style, pad = 14 }) => (
  <div
    style={{
      background: C.panel,
      border: '1px solid ' + C.line,
      borderRadius: 6,
      padding: pad,
      marginBottom: 12,
      ...style,
    }}
  >
    {children}
  </div>
);

const H = ({ children, sub, right }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, letterSpacing: -0.2 }}>{children}</div>
      {sub && <div style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>{sub}</div>}
    </div>
    {right}
  </div>
);

const Btn = ({ children, onClick, tone = 'plain', small, style, disabled }) => {
  const tones = {
    plain: { bg: C.panel, fg: C.ink, bd: C.line },
    primary: { bg: C.ink, fg: '#fff', bd: C.ink },
    sun: { bg: C.sun, fg: '#3B2500', bd: C.sun },
    danger: { bg: '#fff', fg: C.clay, bd: '#E9C6B6' },
  };
  const t = tones[tone] || tones.plain;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: t.bg,
        color: t.fg,
        border: '1px solid ' + t.bd,
        borderRadius: 5,
        padding: small ? '5px 9px' : '9px 14px',
        fontSize: small ? 12 : 14,
        fontWeight: 600,
        fontFamily: SANS,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
};

const Field = ({ label, children, style }) => (
  <label style={{ display: 'block', ...style }}>
    <div style={{ fontSize: 11, color: C.ink2, marginBottom: 3 }}>{label}</div>
    {children}
  </label>
);

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid ' + C.line,
  borderRadius: 4,
  padding: '8px 9px',
  fontSize: 14,
  fontFamily: SANS,
  color: C.ink,
  background: '#fff',
};

const numStyle = { ...inputStyle, fontFamily: MONO, textAlign: 'center' };

const Legend = ({ swatch, children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
    <span style={{ width: 12, height: 12, borderRadius: 3, ...swatch }} />
    {children}
  </span>
);

const Tag = ({ tone = 'amber', children }) => {
  const tones = {
    amber: { bg: '#FCEACB', fg: '#8A5A0A' },
    green: { bg: '#DCEEE1', fg: C.good },
    grey: { bg: '#EDEFE8', fg: C.ink2 },
  };
  const t = tones[tone] || tones.grey;
  return (
    <span
      style={{
        display: 'inline-block',
        background: t.bg,
        color: t.fg,
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 4,
        padding: '2px 7px',
        letterSpacing: 0.2,
      }}
    >
      {children}
    </span>
  );
};

function TwoTap({ label, confirmLabel, onConfirm, tone = 'danger' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Btn
      small
      tone={armed ? 'sun' : tone}
      onClick={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel || 'Tap again' : label}
    </Btn>
  );
}

// A text/number input whose value is local-instant, committed to Supabase
// after a short pause in typing.
function DebouncedInput({ value, onCommit, style, ...props }) {
  const [local, onChange] = useLocalDebounced(value, onCommit);
  return (
    <input
      {...props}
      style={style}
      value={local}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* --------------------------------- Setup ---------------------------------- */

function SetupTab({ state, d }) {
  const patchDay = (id, patch) => {
    const dbPatch = {};
    if ('course' in patch) dbPatch.course = patch.course;
    if ('allowance' in patch) dbPatch.allowance = patch.allowance;
    if ('format' in patch) dbPatch.format = patch.format;
    if ('teamPoints' in patch) dbPatch.team_points = patch.teamPoints;
    api.updateDay(id, dbPatch);
  };

  return (
    <div>
      <Panel>
        <H sub="Handicaps are used at the allowance set for each day.">Players</H>
        {state.players.map((p) => (
          <PlayerSetupRow key={p.id} p={p} state={state} d={d} />
        ))}
        <Btn small onClick={() => api.addPlayer()}>
          Add player
        </Btn>
      </Panel>

      <Panel>
        <H
          sub="Three pairs. Draw them the night before, or set them by hand above."
          right={
            <TwoTap
              label="Draw teams"
              confirmLabel="Draw now"
              tone="plain"
              onConfirm={() => api.drawTeams(state.players.map((p) => p.id), state.teams.map((t) => t.id))}
            />
          }
        >
          Teams
        </H>
        {state.teams.map((t) => (
          <TeamSetupRow key={t.id} t={t} d={d} />
        ))}
      </Panel>

      {state.days.map((day) => (
        <Panel key={day.id}>
          <H sub={formatName(day.format)}>{day.label}</H>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <Field label="Course">
              <DebouncedInput
                style={inputStyle}
                value={day.course}
                placeholder="Course name"
                onCommit={(v) => patchDay(day.id, { course: v })}
              />
            </Field>
            <Field label="Handicap allowance %">
              <DebouncedInput
                style={numStyle}
                inputMode="numeric"
                value={day.allowance}
                onCommit={(v) => patchDay(day.id, { allowance: v === '' ? 0 : Number(v) })}
              />
            </Field>
            <Field label="Format">
              <select style={inputStyle} value={day.format} onChange={(e) => patchDay(day.id, { format: e.target.value })}>
                <option value="betterball">Better ball (best net stableford)</option>
                <option value="combined">Combined stableford (both count)</option>
              </select>
            </Field>
            <Field label="Points 1st / 2nd / 3rd">
              <div style={{ display: 'flex', gap: 6 }}>
                {[0, 1, 2].map((i) => (
                  <input
                    key={i}
                    style={numStyle}
                    inputMode="numeric"
                    defaultValue={day.teamPoints[i]}
                    onBlur={(e) => {
                      const v = [...day.teamPoints];
                      v[i] = e.target.value === '' ? 0 : Number(e.target.value);
                      patchDay(day.id, { teamPoints: v });
                    }}
                  />
                ))}
              </div>
            </Field>
          </div>
          <CourseEditor day={day} />
        </Panel>
      ))}

      <Panel>
        <H sub="Fills in six players, three teams, real handicaps, a full Day 1 and a Day 2 in progress — so there's something on every tab to look at.">
          Load demo data
        </H>
        <TwoTap
          label="Load demo data"
          confirmLabel="This replaces everything — tap again"
          tone="plain"
          onConfirm={() => api.loadDemoData()}
        />
      </Panel>

      <Panel>
        <H sub="Wipes scores, teams, awards and the book. Handicaps and course details reset too.">Start over</H>
        <TwoTap label="Reset everything" confirmLabel="Tap again to wipe" onConfirm={() => api.resetEverything()} />
      </Panel>
    </div>
  );
}

function PlayerSetupRow({ p, state, d }) {
  const [name, onNameChange] = useLocalDebounced(p.name, (v) => api.updatePlayer(p.id, { name: v }));
  const [hcp, onHcpChange] = useLocalDebounced(p.hcp, (v) => api.updatePlayer(p.id, { hcp: v === '' ? 0 : Number(v) }));
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 62px 1fr auto',
        gap: 8,
        alignItems: 'end',
        paddingBottom: 10,
        marginBottom: 10,
        borderBottom: '1px solid ' + C.line,
      }}
    >
      <Field label="Name">
        <input style={inputStyle} value={name} onChange={(e) => onNameChange(e.target.value)} />
      </Field>
      <Field label="Hcp">
        <input style={numStyle} inputMode="numeric" value={hcp} onChange={(e) => onHcpChange(e.target.value)} />
      </Field>
      <Field label="Team">
        <select style={inputStyle} value={d.teamOf[p.id] || ''} onChange={(e) => api.assignPlayerTeam(p.id, e.target.value)}>
          <option value="">—</option>
          {state.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <TwoTap label="Remove" confirmLabel="Sure?" onConfirm={() => api.removePlayer(p.id)} />
    </div>
  );
}

function TeamSetupRow({ t, d }) {
  const [name, onNameChange] = useLocalDebounced(t.name, (v) => api.updateTeam(t.id, { name: v }));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ width: 6, height: 34, background: t.colour, borderRadius: 3 }} />
      <input style={{ ...inputStyle, flex: '0 0 40%' }} value={name} onChange={(e) => onNameChange(e.target.value)} />
      <div style={{ fontSize: 13, color: C.ink2 }}>
        {t.players.length ? t.players.map((pid) => d.byId[pid] && d.byId[pid].name).join(' & ') : 'Not drawn'}
      </div>
    </div>
  );
}

function CourseEditor({ day }) {
  const [open, setOpen] = useState(false);
  const setCell = (key, i, v) => {
    const arr = [...day[key]];
    arr[i] = v === '' ? 0 : Number(v);
    api.updateDayHoles(day.id, key, arr);
  };
  const total = sum(day.par);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, color: C.ink2 }}>Par {total} · 18 holes</div>
        <Btn small onClick={() => setOpen(!open)}>
          {open ? 'Hide card' : 'Edit par & stroke index'}
        </Btn>
      </div>
      {open && (
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ borderCollapse: 'collapse', fontFamily: MONO, fontSize: 12 }}>
            <tbody>
              <tr>
                <td style={cellHead}>Hole</td>
                {day.par.map((_, i) => (
                  <td key={i} style={cellHead}>
                    {i + 1}
                  </td>
                ))}
              </tr>
              {['par', 'si'].map((key) => (
                <tr key={key}>
                  <td style={cellHead}>{key === 'par' ? 'Par' : 'SI'}</td>
                  {day[key].map((v, i) => (
                    <td key={i} style={{ ...cellBase, padding: 0 }}>
                      <input
                        defaultValue={v}
                        inputMode="numeric"
                        onBlur={(e) => setCell(key, i, e.target.value)}
                        style={{
                          width: 34,
                          border: 'none',
                          background: 'transparent',
                          textAlign: 'center',
                          fontFamily: MONO,
                          fontSize: 12,
                          padding: '7px 0',
                          color: C.ink,
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const cellBase = {
  border: '1px solid ' + C.line,
  textAlign: 'center',
  minWidth: 34,
  color: C.ink,
};
const cellHead = { ...cellBase, background: '#F6F7F3', fontWeight: 700, padding: '6px 8px', whiteSpace: 'nowrap' };

/* -------------------------------- Scorecard ------------------------------- */

function ScorecardTab({ state, d, standings }) {
  const [dayId, setDayId] = useState('d1');
  const day = state.days.find((x) => x.id === dayId) || state.days[0];
  const pts = d.points[day.id];

  const holes = Array.from({ length: 18 }, (_, i) => i);
  const unassigned = state.players.filter((p) => !d.teamOf[p.id]);

  const sub = (arr, a, b) => sum(arr.slice(a, b));

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {state.days.map((x) => (
          <button
            key={x.id}
            onClick={() => setDayId(x.id)}
            style={{
              flex: 1,
              padding: '10px 8px',
              borderRadius: 5,
              border: '1px solid ' + (x.id === dayId ? C.ink : C.line),
              background: x.id === dayId ? C.ink : C.panel,
              color: x.id === dayId ? '#fff' : C.ink,
              fontWeight: 600,
              fontSize: 13,
              fontFamily: SANS,
              cursor: 'pointer',
            }}
          >
            {x.label}
            <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.75, marginTop: 2 }}>
              {formatName(x.format)}
            </div>
          </button>
        ))}
      </div>

      <Panel pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid ' + C.line }}>
          <H
            sub={
              (day.course || 'Course to be confirmed') +
              ' · par ' +
              sum(day.par) +
              ' · ' +
              day.allowance +
              '% handicap'
            }
            right={
              standings.dayResults[day.id].started ? (
                <Tag tone={standings.dayResults[day.id].complete ? 'green' : 'amber'}>
                  {standings.dayResults[day.id].complete ? 'Final' : 'Provisional'}
                </Tag>
              ) : null
            }
          >
            {day.label} scorecard
          </H>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {standings.dayResults[day.id].groups.map((g, gi) =>
              g.map((it) => (
                <div
                  key={it.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    border: '1px solid ' + C.line,
                    borderRadius: 5,
                    padding: '5px 8px',
                    fontSize: 12,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: it.team.colour }} />
                  <span style={{ fontWeight: 600, color: C.ink }}>{it.team.name}</span>
                  <span style={{ fontFamily: MONO, color: C.ink }}>{it.total}</span>
                  <span style={{ color: C.ink2 }}>{ORDINALS[gi]}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontFamily: MONO, fontSize: 12, minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...stickyHead }}>Hole</th>
                {holes.map((h) => (
                  <th key={h} style={cellHead}>
                    {h + 1}
                  </th>
                ))}
                <th style={{ ...cellHead, background: '#EDEFE8' }}>Out</th>
                <th style={{ ...cellHead, background: '#EDEFE8' }}>In</th>
                <th style={{ ...cellHead, background: '#EDEFE8' }}>Tot</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={stickyCell}>Par</td>
                {day.par.map((p, i) => (
                  <td key={i} style={cellMuted}>
                    {p}
                  </td>
                ))}
                <td style={cellMuted}>{sub(day.par, 0, 9)}</td>
                <td style={cellMuted}>{sub(day.par, 9, 18)}</td>
                <td style={cellMuted}>{sum(day.par)}</td>
              </tr>
              <tr>
                <td style={stickyCell}>SI</td>
                {day.si.map((p, i) => (
                  <td key={i} style={cellMuted}>
                    {p}
                  </td>
                ))}
                <td style={cellMuted} />
                <td style={cellMuted} />
                <td style={cellMuted} />
              </tr>

              {state.teams.map((t) => {
                const ph = t.players.map((pid) => playingHcp(d.byId[pid].hcp, day.allowance));
                return (
                  <React.Fragment key={t.id}>
                    <tr>
                      <td colSpan={22} style={{ ...cellBase, borderLeft: 'none', borderRight: 'none', textAlign: 'left', background: t.colour + '14', padding: '6px 10px', fontFamily: SANS, fontWeight: 700, color: t.colour }}>
                        {t.name}
                      </td>
                    </tr>
                    {t.players.map((pid, pi) => (
                      <PlayerRow
                        key={pid}
                        player={d.byId[pid]}
                        ph={ph[pi]}
                        day={day}
                        scores={(state.scores[day.id] && state.scores[day.id][pid]) || Array(18).fill(null)}
                        pts={pts[pid]}
                        holeBest={d.holeBest[day.id]}
                      />
                    ))}
                    {t.players.length > 0 && (
                      <tr>
                        <td style={{ ...stickyCell, fontFamily: SANS, fontWeight: 700, color: t.colour }}>
                          {day.format === 'betterball' ? 'Best' : 'Pair'}
                        </td>
                        {holes.map((h) => (
                          <td key={h} style={{ ...cellBase, background: t.colour + '10', fontWeight: 700, padding: '7px 0' }}>
                            {d.teamHole(day.id, t, h) ?? ''}
                          </td>
                        ))}
                        {[[0, 9], [9, 18], [0, 18]].map(([a, b], i) => (
                          <td key={i} style={{ ...cellBase, background: t.colour + '20', fontWeight: 700, padding: '7px 0' }}>
                            {holes.slice(a, b).reduce((acc, h) => acc + (d.teamHole(day.id, t, h) || 0), 0)}
                          </td>
                        ))}
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {unassigned.length > 0 && (
                <>
                  <tr>
                    <td colSpan={22} style={{ ...cellBase, borderLeft: 'none', borderRight: 'none', textAlign: 'left', background: '#F6F7F3', padding: '6px 10px', fontFamily: SANS, fontWeight: 700, color: C.ink2 }}>
                      Not in a team yet
                    </td>
                  </tr>
                  {unassigned.map((p) => (
                    <PlayerRow
                      key={p.id}
                      player={p}
                      ph={playingHcp(p.hcp, day.allowance)}
                      day={day}
                      scores={(state.scores[day.id] && state.scores[day.id][p.id]) || Array(18).fill(null)}
                      pts={pts[p.id]}
                      holeBest={d.holeBest[day.id]}
                    />
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 14px', fontSize: 11, color: C.ink2, borderTop: '1px solid ' + C.line, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Enter gross strokes — net and points fill in underneath.</span>
          <Legend swatch={{ background: '#fff', border: '1.5px solid ' + C.sun }}>Hole winner</Legend>
          <Legend swatch={{ background: '#fff', border: '1.3px solid ' + C.ink, borderRadius: 12 }}>Birdie or better</Legend>
          <Legend swatch={{ background: '#fff', border: '1.3px solid ' + C.ink, borderRadius: 3 }}>Bogey or worse</Legend>
          <span>— doubled for eagle+ or double bogey+, off the gross score.</span>
        </div>
      </Panel>
    </div>
  );
}

function PlayerRow({ player, ph, day, scores, pts, holeBest }) {
  const holes = Array.from({ length: 18 }, (_, i) => i);
  const range = (a, b) => sum(pts.slice(a, b));
  return (
    <tr>
      <td style={{ ...stickyCell, textAlign: 'left', fontFamily: SANS }}>
        <div style={{ fontWeight: 600, color: C.ink, whiteSpace: 'nowrap' }}>{player.name}</div>
        <div style={{ fontSize: 10, color: C.ink2 }}>plays off {ph}</div>
      </td>
      {holes.map((h) => (
        <ScoreCell
          key={h}
          playerId={player.id}
          dayId={day.id}
          h={h}
          par={day.par[h]}
          si={day.si[h]}
          ph={ph}
          gross={scores[h]}
          fallbackPts={pts[h]}
          holeBest={holeBest}
        />
      ))}
      {[[0, 9], [9, 18], [0, 18]].map(([a, b], i) => (
        <td key={i} style={{ ...cellBase, background: '#F6F7F3', fontWeight: 700, fontSize: 13 }}>
          {range(a, b)}
        </td>
      ))}
    </tr>
  );
}

function ScoreCell({ playerId, dayId, h, par, si, ph, gross, fallbackPts, holeBest }) {
  const commit = (v) => {
    if (v != null && (isNaN(v) || v < 1 || v > 20)) return;
    api.setScore(dayId, playerId, h, v);
  };
  const [local, onChange] = useLocalDebounced(gross, commit, 350);

  const shots = shotsFor(ph, si);
  // Compute locally from the in-progress value so the net/points line and
  // marks update instantly, without waiting on a round trip + refetch.
  const p = local == null || local === '' ? null : stableford(Number(local), par, shots);
  const displayGross = local == null || local === '' ? null : Number(local);
  const net = displayGross != null ? displayGross - shots : null;
  const isBest = p != null && p > 0 && holeBest && holeBest[h] != null && p === holeBest[h];
  const mark = scoreMark(displayGross, par);

  return (
    <td style={{ ...cellBase, padding: 2, position: 'relative', border: 'none' }}>
      <div
        style={{
          borderRadius: 6,
          border: (isBest ? 1.5 : 1) + 'px solid ' + (isBest ? C.sun : C.line),
          background: '#fff',
          position: 'relative',
          padding: '4px 0 2px',
        }}
      >
        {shots > 0 && (
          <div style={{ position: 'absolute', top: 2, right: 3, fontSize: 7, color: C.sun, letterSpacing: -1 }}>
            {'•'.repeat(Math.min(shots, 3))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 22,
              borderRadius: mark ? (mark.shape === 'circle' ? '50%' : 4) : 0,
              border: mark ? '1.3px solid ' + C.ink : 'none',
              boxShadow: mark && mark.double ? '0 0 0 2.5px #fff, 0 0 0 4px ' + C.ink : 'none',
            }}
          >
            <input
              value={local ?? ''}
              inputMode="numeric"
              onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
              style={{
                width: 22,
                border: 'none',
                background: 'transparent',
                textAlign: 'center',
                fontFamily: MONO,
                fontSize: 15,
                fontWeight: 700,
                color: C.ink,
                padding: 0,
                outline: 'none',
              }}
            />
          </div>
        </div>
        <div style={{ fontSize: 8, color: p == null ? 'transparent' : C.ink2, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {net == null ? '·' : 'net ' + net + ' · ' + p}
        </div>
      </div>
    </td>
  );
}

const stickyCell = {
  ...cellBase,
  position: 'sticky',
  left: 0,
  zIndex: 2,
  background: '#fff',
  minWidth: 96,
  padding: '6px 10px',
  textAlign: 'left',
};
const stickyHead = { ...cellHead, position: 'sticky', left: 0, zIndex: 3, minWidth: 96, textAlign: 'left' };
const cellMuted = { ...cellBase, background: '#FAFBF8', color: C.ink2, padding: '5px 0' };

/* ----------------------------- Team leaderboard --------------------------- */

function TeamsTab({ state, d, standings }) {
  const [openId, setOpenId] = useState(null);
  const anyStarted = state.days.some((day) => standings.dayResults[day.id].started);
  let pos = 0;
  return (
    <div>
      {anyStarted && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Tag tone={standings.provisional ? 'amber' : 'green'}>{standings.provisional ? 'Provisional' : 'Final'}</Tag>
        </div>
      )}
      {standings.teamOrder.map((g, gi) => {
        const shown = pos + 1;
        pos += g.length;
        return g.map((it) => {
          const t = it.team;
          const open = openId === t.id;
          return (
            <Panel key={t.id} pad={0}>
              <div
                onClick={() => setOpenId(open ? null : t.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, cursor: 'pointer' }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 4,
                    background: t.colour,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: MONO,
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {shown}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: C.ink, fontSize: 15 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: C.ink2 }}>
                    {t.players.length ? t.players.map((pid) => d.byId[pid] && d.byId[pid].name).join(' & ') : 'Not drawn'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: C.ink, lineHeight: 1 }}>
                    {fmt(it.total)}
                  </div>
                  <div style={{ fontSize: 11, color: C.ink2 }}>points</div>
                </div>
              </div>
              <div style={{ display: 'flex', borderTop: '1px solid ' + C.line }}>
                {[
                  ['Day 1', it.day1],
                  ['Day 2', it.day2],
                  ['Individual', it.indiv],
                  ['Bonus', it.bonus],
                ].map(([label, v]) => (
                  <div key={label} style={{ flex: 1, padding: '8px 6px', textAlign: 'center', borderRight: '1px solid ' + C.line }}>
                    <div style={{ fontFamily: MONO, fontWeight: 700, color: v ? C.ink : C.ink2 }}>{fmt(v)}</div>
                    <div style={{ fontSize: 10, color: C.ink2 }}>{label}</div>
                  </div>
                ))}
              </div>
              {open && (
                <div style={{ padding: '10px 14px', borderTop: '1px solid ' + C.line, background: '#FAFBF8' }}>
                  {it.rows.length === 0 && <div style={{ fontSize: 12, color: C.ink2 }}>No points yet.</div>}
                  {it.rows.map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: C.ink }}>
                      <span>{r.label}</span>
                      <span style={{ fontFamily: MONO, fontWeight: 700 }}>{fmt(r.pts)}</span>
                    </div>
                  ))}
                  {state.days.map((day) => (
                    <div key={day.id} style={{ fontSize: 11, color: C.ink2, marginTop: 6 }}>
                      {day.label}: {d.teamTotal(day.id, t)} {day.format === 'betterball' ? 'better ball' : 'combined'} · {d.teamCombined(day.id, t)} pair total · {d.teamLowest(day.id, t)} lowest man
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          );
        });
      })}

      {state.days.map((day) => (
        <Panel key={day.id}>
          <H
            sub={formatName(day.format) + ' · ' + day.teamPoints.join(' / ') + ' points'}
            right={
              standings.dayResults[day.id].started ? (
                <Tag tone={standings.dayResults[day.id].complete ? 'green' : 'amber'}>
                  {standings.dayResults[day.id].complete ? 'Final' : 'Provisional'}
                </Tag>
              ) : null
            }
          >
            {day.label}
          </H>
          {standings.dayResults[day.id].groups.map((g, gi) =>
            g.map((it) => (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid ' + C.line }}>
                <div style={{ width: 26, fontFamily: MONO, color: C.ink2, fontSize: 12 }}>{ORDINALS[gi]}</div>
                <div style={{ width: 6, height: 20, background: it.team.colour, borderRadius: 2 }} />
                <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ink }}>{it.team.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: C.ink }}>{it.total}</div>
                <div style={{ width: 42, textAlign: 'right', fontFamily: MONO, fontSize: 13, color: C.clay }}>
                  +{fmt(standings.dayResults[day.id].points[it.id] || 0)}
                </div>
              </div>
            ))
          )}
          <div style={{ fontSize: 11, color: C.ink2, marginTop: 8 }}>
            {day.format === 'betterball'
              ? "Ties split on combined stableford, then the pair's highest individual score, then their lowest."
              : "Ties split on the pair's highest individual score, then their lowest."}
          </div>
        </Panel>
      ))}
    </div>
  );
}

/* -------------------------- Individual leaderboard ------------------------ */

function IndividualsTab({ state, d, standings }) {
  const [view, setView] = useState('combined');
  const table = standings.indiv[view];
  const cfg = state.individual[view];
  const awarded = cfg && cfg.enabled ? sharePoints(table.groups, cfg.points) : {};
  const r1 = standings.dayResults.d1;
  const r2 = standings.dayResults.d2;
  const viewStarted = view === 'd1' ? r1.started : view === 'd2' ? r2.started : r1.started || r2.started;
  const viewComplete = view === 'd1' ? r1.complete : view === 'd2' ? r2.complete : r1.complete && r2.complete;
  let pos = 0;
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[
          ['d1', 'Day 1'],
          ['d2', 'Day 2'],
          ['combined', 'Overall'],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            style={{
              flex: 1,
              padding: '9px 6px',
              borderRadius: 5,
              border: '1px solid ' + (view === k ? C.ink : C.line),
              background: view === k ? C.ink : C.panel,
              color: view === k ? '#fff' : C.ink,
              fontWeight: 600,
              fontSize: 13,
              fontFamily: SANS,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {viewStarted && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Tag tone={viewComplete ? 'green' : 'amber'}>{viewComplete ? 'Final' : 'Provisional'}</Tag>
        </div>
      )}

      <Panel pad={0}>
        {table.groups.map((g, gi) => {
          const shown = pos + 1;
          pos += g.length;
          return g.map((it) => {
            const tid = d.teamOf[it.id];
            const team = state.teams.find((t) => t.id === tid);
            const leader = shown === 1 && it.total > 0;
            return (
              <div
                key={it.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 14px',
                  borderBottom: '1px solid ' + C.line,
                  background: leader ? '#FFF8E8' : '#fff',
                }}
              >
                <div style={{ width: 20, fontFamily: MONO, fontSize: 13, color: C.ink2 }}>{shown}</div>
                <div style={{ width: 4, height: 26, borderRadius: 2, background: team ? team.colour : C.line }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: C.ink, fontSize: 14 }}>
                    {it.player.name}
                    {leader && <span style={{ color: C.sun, marginLeft: 6, fontSize: 12 }}>★</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.ink2 }}>
                    {team ? team.name : 'No team'} · plays off {it.player.hcp}
                  </div>
                </div>
                {view === 'combined' && (
                  <div style={{ textAlign: 'right', marginRight: 8 }}>
                    <div style={{ fontFamily: MONO, fontSize: 12, color: C.ink2 }}>
                      {it.d1} + {it.d2}
                    </div>
                  </div>
                )}
                {awarded[it.id] ? (
                  <div style={{ fontFamily: MONO, fontSize: 12, color: C.clay, marginRight: 8 }}>+{fmt(awarded[it.id])}</div>
                ) : null}
                <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: C.ink }}>{it.total}</div>
              </div>
            );
          });
        })}
        <div style={{ padding: '10px 14px', fontSize: 11, color: C.ink2 }}>
          Net stableford off full handicap for the day.
          {cfg && cfg.enabled
            ? ' Points shown in orange go to the player’s team.'
            : ' This table is not awarding team points — turn it on in Extras.'}
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------- Extras -------------------------------- */

function ExtrasTab({ state }) {
  return (
    <div>
      <Panel>
        <H sub="Finishing positions in the individual stableford can hand points to the winner's team.">
          Individual results as team points
        </H>
        {[
          ['d1', 'Day 1'],
          ['d2', 'Day 2'],
          ['combined', 'Overall'],
        ].map(([key, label]) => (
          <IndividualConfigRow key={key} configKey={key} label={label} cfg={state.individual[key]} />
        ))}
      </Panel>

      <Panel>
        <H sub="Longest drive, closest to the pin, or anything else you fancy paying out on." right={<Btn small onClick={() => api.addAward(state.awards.length)}>Add bonus</Btn>}>
          Bonus points
        </H>
        {state.awards.length === 0 && (
          <div style={{ fontSize: 13, color: C.ink2 }}>Nothing here yet. Add a bonus and pick who won it.</div>
        )}
        {state.awards.map((aw) => (
          <AwardRow key={aw.id} aw={aw} state={state} />
        ))}
      </Panel>
    </div>
  );
}

function IndividualConfigRow({ configKey, label, cfg }) {
  return (
    <div style={{ borderBottom: '1px solid ' + C.line, paddingBottom: 10, marginBottom: 10 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => api.updateIndividual(configKey, { enabled: e.target.checked })}
        />
        <span style={{ fontWeight: 600, color: C.ink, fontSize: 14 }}>{label}</span>
      </label>
      {cfg.enabled && (
        <div style={{ display: 'flex', gap: 6 }}>
          {cfg.points.map((v, i) => (
            <div key={i} style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: C.ink2, textAlign: 'center', marginBottom: 2 }}>{ORDINALS[i]}</div>
              <input
                style={numStyle}
                inputMode="numeric"
                defaultValue={v}
                onBlur={(e) => {
                  const arr = [...cfg.points];
                  arr[i] = e.target.value === '' ? 0 : Number(e.target.value);
                  api.updateIndividual(configKey, { points: arr });
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AwardRow({ aw, state }) {
  const [name, onNameChange] = useLocalDebounced(aw.name, (v) => api.updateAwardName(aw.id, v));
  return (
    <div style={{ border: '1px solid ' + C.line, borderRadius: 5, padding: 10, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input style={{ ...inputStyle, flex: 1 }} value={name} onChange={(e) => onNameChange(e.target.value)} />
        <select style={{ ...inputStyle, width: 100 }} value={aw.scope} onChange={(e) => api.updateAwardScope(aw.id, e.target.value)}>
          <option value="player">Player</option>
          <option value="team">Team</option>
        </select>
      </div>
      {aw.values.map((v, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <div style={{ width: 28, fontSize: 12, color: C.ink2, fontFamily: MONO }}>{ORDINALS[i]}</div>
          <select
            style={{ ...inputStyle, flex: 1 }}
            value={aw.winners[i] || ''}
            onChange={(e) => api.setAwardPlaceWinner(aw.id, i + 1, aw.scope, e.target.value || null)}
          >
            <option value="">Not decided</option>
            {(aw.scope === 'team' ? state.teams : state.players).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <input
            style={{ ...numStyle, width: 56 }}
            inputMode="numeric"
            defaultValue={v}
            onBlur={(e) => api.setAwardPlacePoints(aw.id, i + 1, e.target.value === '' ? 0 : Number(e.target.value))}
          />
          {aw.values.length > 1 && (
            <Btn small tone="danger" onClick={() => api.removeAwardPlace(aw.id, i + 1, aw.values.length)}>
              ×
            </Btn>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Btn small onClick={() => api.addAwardPlace(aw.id, aw.values.length)}>
          Add place
        </Btn>
        <TwoTap label="Delete" confirmLabel="Sure?" onConfirm={() => api.deleteAward(aw.id)} />
      </div>
    </div>
  );
}

/* -------------------------------- Sportsbook ------------------------------ */

function BookTab({ state }) {
  const { markets, bets } = state.book;
  const [slip, setSlip] = useState([]);
  const [bettor, setBettor] = useState('');
  const [stake, setStake] = useState('5');
  const [newMarket, setNewMarket] = useState('');

  const addMarket = () => {
    if (!newMarket.trim()) return;
    api.addMarket(newMarket.trim());
    setNewMarket('');
  };

  const seed = () => {
    api.seedMarkets(state.teams.map((t) => t.name), state.players.map((p) => p.name));
  };

  const toggleSlip = (m, s) => {
    if (m.settled != null) return;
    setSlip((cur) => {
      const without = cur.filter((l) => l.marketId !== m.id);
      if (cur.some((l) => l.selectionId === s.id)) return without;
      return [...without, { marketId: m.id, selectionId: s.id, odds: Number(s.odds) || 1, label: m.name + ' — ' + s.label }];
    });
  };

  const placeBet = () => {
    const st = Number(stake);
    if (!slip.length || !bettor || !st || st <= 0) return;
    api.placeBet(bettor, st, slip);
    setSlip([]);
  };

  const slipOdds = slip.reduce((a, l) => a * (Number(l.odds) || 1), 1);

  const pnl = useMemo(() => {
    const rows = {};
    bets.forEach((b) => {
      const r = betReturn(b, markets);
      if (!rows[b.bettor]) rows[b.bettor] = { bettor: b.bettor, staked: 0, ret: 0, open: 0, count: 0 };
      rows[b.bettor].staked += Number(b.stake);
      rows[b.bettor].ret += r.ret;
      if (r.status === 'open') rows[b.bettor].open += Number(b.stake);
      rows[b.bettor].count += 1;
    });
    const list = Object.values(rows);
    list.forEach((r) => (r.net = r.ret - r.staked));
    list.sort((a, b) => b.net - a.net);
    return list;
  }, [bets, markets]);

  const houseNet = -pnl.reduce((a, r) => a + r.net, 0);

  return (
    <div>
      <Panel>
        <H sub="Decimal odds. Set them yourself, take the money, settle when it's done.">The book</H>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...inputStyle, flex: 1 }} placeholder="New market name" value={newMarket} onChange={(e) => setNewMarket(e.target.value)} />
          <Btn onClick={addMarket}>Add</Btn>
        </div>
        {markets.length === 0 && (
          <div style={{ marginTop: 10 }}>
            <Btn tone="sun" small onClick={seed}>
              Fill with the usual markets
            </Btn>
          </div>
        )}
      </Panel>

      {markets.map((m) => (
        <MarketPanel key={m.id} m={m} slip={slip} toggleSlip={toggleSlip} state={state} />
      ))}

      {slip.length > 0 && (
        <Panel style={{ borderColor: C.sun, borderWidth: 2 }}>
          <H sub={slip.length > 1 ? slip.length + '-fold accumulator' : 'Single'}>Betslip</H>
          {slip.map((l) => (
            <div key={l.selectionId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', color: C.ink }}>
              <span>{l.label}</span>
              <span style={{ fontFamily: MONO }}>{Number(l.odds).toFixed(2)}</span>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8, marginTop: 10 }}>
            <Field label="Bettor">
              <select style={inputStyle} value={bettor} onChange={(e) => setBettor(e.target.value)}>
                <option value="">Who's betting?</option>
                {state.players.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Stake">
              <input style={numStyle} inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <div style={{ fontSize: 12, color: C.ink2 }}>
              Returns <span style={{ fontFamily: MONO, color: C.ink, fontWeight: 700 }}>£{(Number(stake || 0) * slipOdds).toFixed(2)}</span> at {slipOdds.toFixed(2)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn small onClick={() => setSlip([])}>
                Clear
              </Btn>
              <Btn small tone="primary" onClick={placeBet} disabled={!bettor || !Number(stake)}>
                Place bet
              </Btn>
            </div>
          </div>
        </Panel>
      )}

      <Panel>
        <H sub={bets.length + ' placed · house ' + (houseNet >= 0 ? '+' : '-') + '£' + Math.abs(houseNet).toFixed(2)}>Bets</H>
        {bets.length === 0 && <div style={{ fontSize: 13, color: C.ink2 }}>No bets yet. Back something above.</div>}
        {bets.map((b) => {
          const r = betReturn(b, markets);
          const tone = r.status === 'won' ? C.good : r.status === 'lost' ? C.clay : C.ink2;
          return (
            <div key={b.id} style={{ borderBottom: '1px solid ' + C.line, padding: '8px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, color: C.ink, fontSize: 13 }}>{b.bettor}</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink2 }}>£{Number(b.stake).toFixed(2)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: tone }}>
                    {r.status === 'won' ? '+£' + (r.ret - b.stake).toFixed(2) : r.status === 'lost' ? '-£' + Number(b.stake).toFixed(2) : 'Open'}
                  </span>
                  <TwoTap label="×" confirmLabel="Delete?" onConfirm={() => api.deleteBet(b.id)} />
                </div>
              </div>
              {b.legs.map((l, i) => (
                <div key={i} style={{ fontSize: 11, color: C.ink2 }}>
                  {l.label} @ {Number(l.odds).toFixed(2)}
                </div>
              ))}
            </div>
          );
        })}
      </Panel>

      {pnl.length > 0 && (
        <Panel>
          <H>Profit and loss</H>
          {pnl.map((r) => (
            <div key={r.bettor} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid ' + C.line }}>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.ink }}>{r.bettor}</div>
              <div style={{ fontSize: 11, color: C.ink2, fontFamily: MONO }}>
                {r.count} bets · £{r.staked.toFixed(2)} staked
              </div>
              <div style={{ width: 78, textAlign: 'right', fontFamily: MONO, fontWeight: 700, color: r.net > 0 ? C.good : r.net < 0 ? C.clay : C.ink2 }}>
                {r.net < 0 ? '-£' + Math.abs(r.net).toFixed(2) : '+£' + r.net.toFixed(2)}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, fontSize: 13 }}>
            <span style={{ fontWeight: 700, color: C.ink }}>House</span>
            <span style={{ fontFamily: MONO, fontWeight: 700, color: houseNet >= 0 ? C.good : C.clay }}>
              {houseNet < 0 ? '-£' + Math.abs(houseNet).toFixed(2) : '+£' + houseNet.toFixed(2)}
            </span>
          </div>
        </Panel>
      )}
    </div>
  );
}

function MarketPanel({ m, slip, toggleSlip, state }) {
  const [name, onNameChange] = useLocalDebounced(m.name, (v) => api.updateMarket(m.id, { name: v }));
  return (
    <Panel pad={12}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input
          style={{ ...inputStyle, flex: 1, border: 'none', fontWeight: 700, fontSize: 15, padding: 0 }}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
        <select
          style={{ ...inputStyle, width: 120, fontSize: 12 }}
          value={m.settled || ''}
          onChange={(e) => api.updateMarket(m.id, { settled: e.target.value || null })}
        >
          <option value="">Open</option>
          {m.selections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} won
            </option>
          ))}
          <option value="void">Void</option>
        </select>
      </div>
      {m.selections.map((s) => {
        const picked = slip.some((l) => l.selectionId === s.id);
        const winner = m.settled === s.id;
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1, fontSize: 13, color: winner ? C.good : C.ink, fontWeight: winner ? 700 : 400 }}>{s.label}</div>
            <input
              style={{ ...numStyle, width: 62, fontSize: 13 }}
              inputMode="decimal"
              defaultValue={s.odds}
              onBlur={(e) => api.updateSelectionOdds(s.id, e.target.value === '' ? 1 : Number(e.target.value))}
            />
            <Btn small tone={picked ? 'sun' : 'plain'} disabled={m.settled != null} onClick={() => toggleSlip(m, s)}>
              {picked ? 'On slip' : 'Back'}
            </Btn>
            <Btn small tone="danger" onClick={() => api.deleteSelection(s.id)}>
              ×
            </Btn>
          </div>
        );
      })}
      <AddSelection onAdd={(label, odds) => api.addSelection(m.id, label, odds)} />
      <div style={{ marginTop: 8 }}>
        <TwoTap label="Delete market" confirmLabel="Sure?" onConfirm={() => api.deleteMarket(m.id)} />
      </div>
    </Panel>
  );
}

function AddSelection({ onAdd }) {
  const [label, setLabel] = useState('');
  const [odds, setOdds] = useState('3');
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <input style={{ ...inputStyle, flex: 1, fontSize: 13 }} placeholder="Add a selection" value={label} onChange={(e) => setLabel(e.target.value)} />
      <input style={{ ...numStyle, width: 62, fontSize: 13 }} inputMode="decimal" value={odds} onChange={(e) => setOdds(e.target.value)} />
      <Btn
        small
        onClick={() => {
          if (!label.trim()) return;
          onAdd(label.trim(), Number(odds) || 2);
          setLabel('');
        }}
      >
        Add
      </Btn>
    </div>
  );
}

/* ---------------------------------- shell --------------------------------- */

const TABS = [
  ['card', 'Scorecard'],
  ['teams', 'Teams'],
  ['players', 'Players'],
  ['extras', 'Extras'],
  ['book', 'Book'],
  ['setup', 'Setup'],
];

export default function App() {
  const { state, error } = useAppData();
  const [tab, setTab] = useState('card');

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: C.wall, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SANS, color: C.clay, padding: 20, textAlign: 'center' }}>
        Couldn't reach Supabase: {error.message}
      </div>
    );
  }

  if (!state) {
    return (
      <div style={{ minHeight: '100vh', background: C.wall, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SANS, color: C.ink2 }}>
        Loading the card…
      </div>
    );
  }

  return <Shell state={state} tab={tab} setTab={setTab} />;
}

function Shell({ state, tab, setTab }) {
  const d = useDerived(state);
  const standings = useStandings(state, d);
  const leaders = standings.teamOrder[0] || [];

  return (
    <div style={{ minHeight: '100vh', background: C.wall, fontFamily: SANS, color: C.ink, paddingBottom: 40 }}>
      <header style={{ background: C.ink, color: '#fff', padding: '18px 16px 14px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1 }}>{state.title}</div>
              <div style={{ fontSize: 12, color: '#9DB6CE', marginTop: 5 }}>
                {state.subtitle} · two days, three pairs
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: MONO, fontSize: 12, color: '#9DB6CE' }}>Leading</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.sun }}>
                {leaders.length && leaders[0].total > 0
                  ? leaders.map((l) => l.team.name).join(' & ') + ' · ' + fmt(leaders[0].total)
                  : 'Nobody yet'}
              </div>
              {leaders.length && leaders[0].total > 0 && standings.provisional ? (
                <div style={{ fontSize: 10, color: '#9DB6CE', marginTop: 1 }}>Provisional</div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: C.panel,
          borderBottom: '1px solid ' + C.line,
          display: 'flex',
          overflowX: 'auto',
        }}
      >
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              flex: '1 0 auto',
              padding: '12px 14px',
              border: 'none',
              borderBottom: '3px solid ' + (tab === k ? C.sun : 'transparent'),
              background: 'transparent',
              color: tab === k ? C.ink : C.ink2,
              fontWeight: tab === k ? 700 : 500,
              fontSize: 13,
              fontFamily: SANS,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: 12 }} className="pop" key={tab}>
        {tab === 'card' && <ScorecardTab state={state} d={d} standings={standings} />}
        {tab === 'teams' && <TeamsTab state={state} d={d} standings={standings} />}
        {tab === 'players' && <IndividualsTab state={state} d={d} standings={standings} />}
        {tab === 'extras' && <ExtrasTab state={state} d={d} />}
        {tab === 'book' && <BookTab state={state} d={d} />}
        {tab === 'setup' && <SetupTab state={state} d={d} />}
        <div style={{ textAlign: 'center', fontSize: 11, color: C.ink2, padding: '14px 0' }}>
          {state.title} · {VERSION}
        </div>
      </main>
    </div>
  );
}
