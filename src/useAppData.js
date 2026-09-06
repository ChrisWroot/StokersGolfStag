import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient.js';

const DEFAULT_PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const DEFAULT_SI = [7, 3, 15, 11, 1, 17, 5, 13, 9, 8, 4, 16, 12, 2, 18, 6, 14, 10];

const TABLES = [
  'event',
  'teams',
  'players',
  'days',
  'scores',
  'individual_config',
  'awards',
  'award_places',
  'book_markets',
  'book_selections',
  'book_bets',
  'book_bet_legs',
];

/* ------------------------------ row -> state shape ------------------------------ */

function assemble(rows) {
  const event = rows.event[0] || { title: "Stoker's Stag", subtitle: '' };

  const teams = [...rows.teams]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => ({
      id: t.id,
      name: t.name,
      colour: t.colour,
      players: rows.players.filter((p) => p.team_id === t.id).map((p) => p.id),
    }));

  const players = [...rows.players]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((p) => ({ id: p.id, name: p.name, hcp: Number(p.hcp) }));

  const days = ['d1', 'd2'].map((id) => {
    const row = rows.days.find((d) => d.id === id) || {};
    return {
      id,
      label: row.label ?? (id === 'd1' ? 'Day 1' : 'Day 2'),
      course: row.course ?? '',
      par: row.par && row.par.length === 18 ? row.par : [...DEFAULT_PAR],
      si: row.si && row.si.length === 18 ? row.si : [...DEFAULT_SI],
      allowance: row.allowance != null ? Number(row.allowance) : 100,
      format: row.format ?? (id === 'd1' ? 'betterball' : 'combined'),
      teamPoints: row.team_points && row.team_points.length === 3 ? row.team_points : [4, 2, 0],
    };
  });

  const scores = {};
  ['d1', 'd2'].forEach((dayId) => {
    scores[dayId] = {};
    players.forEach((p) => (scores[dayId][p.id] = Array(18).fill(null)));
  });
  rows.scores.forEach((s) => {
    if (!scores[s.day_id]) return;
    if (!scores[s.day_id][s.player_id]) scores[s.day_id][s.player_id] = Array(18).fill(null);
    scores[s.day_id][s.player_id][s.hole - 1] = s.gross;
  });

  const individualDefaults = { d1: true, d2: true, combined: false };
  const individual = {};
  ['d1', 'd2', 'combined'].forEach((key) => {
    const row = rows.individual_config.find((c) => c.key === key);
    individual[key] = {
      enabled: row ? row.enabled : individualDefaults[key],
      points: row && row.points && row.points.length === 6 ? row.points : [3, 2, 1, 0, 0, 0],
    };
  });

  const awards = [...rows.awards]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((a) => {
      const places = rows.award_places
        .filter((pl) => pl.award_id === a.id)
        .sort((x, y) => x.place - y.place);
      return {
        id: a.id,
        name: a.name,
        scope: a.scope,
        values: places.map((pl) => pl.points),
        winners: places.map((pl) => (a.scope === 'team' ? pl.winner_team_id : pl.winner_player_id)),
      };
    });

  const markets = rows.book_markets.map((m) => ({
    id: m.id,
    name: m.name,
    settled: m.settled,
    selections: rows.book_selections
      .filter((s) => s.market_id === m.id)
      .map((s) => ({ id: s.id, label: s.label, odds: Number(s.odds) })),
  }));

  const bets = [...rows.book_bets]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((b) => ({
      id: b.id,
      bettor: b.bettor,
      stake: Number(b.stake),
      legs: rows.book_bet_legs
        .filter((l) => l.bet_id === b.id)
        .map((l) => {
          const market = rows.book_markets.find((m) => m.id === l.market_id);
          const selection = rows.book_selections.find((s) => s.id === l.selection_id);
          return {
            marketId: l.market_id,
            selectionId: l.selection_id,
            odds: Number(l.odds),
            label: (market ? market.name : '?') + ' — ' + (selection ? selection.label : '?'),
          };
        }),
    }));

  return {
    title: event.title,
    subtitle: event.subtitle,
    players,
    teams,
    days,
    scores,
    individual,
    awards,
    book: { markets, bets },
  };
}

/* ---------------------------------- fetch all ------------------------------------ */

async function fetchAll() {
  const results = await Promise.all(
    TABLES.map((t) => supabase.from(t).select('*'))
  );
  const rows = {};
  results.forEach((res, i) => {
    if (res.error) throw res.error;
    rows[TABLES[i]] = res.data || [];
  });
  return assemble(rows);
}

/* ------------------------------------ hook ---------------------------------------- */

export function useAppData() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const refetchTimer = useRef(null);
  const mounted = useRef(true);

  const refetch = useCallback(() => {
    fetchAll()
      .then((s) => {
        if (mounted.current) setState(s);
      })
      .catch((e) => {
        if (mounted.current) setError(e);
      });
  }, []);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(refetch, 150);
  }, [refetch]);

  useEffect(() => {
    mounted.current = true;
    refetch();

    const channel = supabase.channel('stokers-stag-changes');
    TABLES.forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefetch);
    });
    channel.subscribe();

    return () => {
      mounted.current = false;
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      supabase.removeChannel(channel);
    };
  }, [refetch, scheduleRefetch]);

  return { state, error, refetch };
}
