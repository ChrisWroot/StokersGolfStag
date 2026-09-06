import { supabase } from './supabaseClient.js';

const DEFAULT_PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const DEFAULT_SI = [7, 3, 15, 11, 1, 17, 5, 13, 9, 8, 4, 16, 12, 2, 18, 6, 14, 10];
const TEAM_COLOURS = ['#1D6FA5', '#C1440E', '#6B8F3A'];

function must(res) {
  if (res.error) throw res.error;
  return res.data;
}

/* ----------------------------------- event ---------------------------------------- */

export async function updateEvent(patch) {
  must(await supabase.from('event').update(patch).eq('id', true));
}

/* ---------------------------------- players --------------------------------------- */

export async function addPlayer() {
  must(await supabase.from('players').insert({ name: 'New player', hcp: 18 }).select().single());
}

export async function updatePlayer(id, patch) {
  must(await supabase.from('players').update(patch).eq('id', id));
}

export async function assignPlayerTeam(playerId, teamId) {
  must(await supabase.from('players').update({ team_id: teamId || null }).eq('id', playerId));
}

export async function removePlayer(id) {
  must(await supabase.from('scores').delete().eq('player_id', id));
  must(await supabase.from('award_places').update({ winner_player_id: null }).eq('winner_player_id', id));
  must(await supabase.from('players').delete().eq('id', id));
}

export async function drawTeams(playerIds, teamIds) {
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  await Promise.all(
    shuffled.map((pid, i) =>
      supabase
        .from('players')
        .update({ team_id: teamIds[Math.floor(i / 2)] ?? null })
        .eq('id', pid)
        .then(must)
    )
  );
}

/* ----------------------------------- teams ----------------------------------------- */

export async function updateTeam(id, patch) {
  must(await supabase.from('teams').update(patch).eq('id', id));
}

/* ------------------------------------ days ------------------------------------------ */

export async function updateDay(id, patch) {
  must(await supabase.from('days').update(patch).eq('id', id));
}

export async function updateDayHoles(id, key, arr) {
  must(await supabase.from('days').update({ [key]: arr }).eq('id', id));
}

/* ----------------------------------- scores ------------------------------------------ */

export async function setScore(dayId, playerId, hole0, value) {
  const hole = hole0 + 1;
  if (value == null) {
    must(await supabase.from('scores').delete().eq('day_id', dayId).eq('player_id', playerId).eq('hole', hole));
    return;
  }
  must(
    await supabase
      .from('scores')
      .upsert({ day_id: dayId, player_id: playerId, hole, gross: value }, { onConflict: 'day_id,player_id,hole' })
  );
}

/* ------------------------------- individual config ------------------------------------ */

export async function updateIndividual(key, patch) {
  must(await supabase.from('individual_config').update(patch).eq('key', key));
}

/* ------------------------------------ awards ------------------------------------------- */

export async function addAward(nextSortOrder) {
  const award = must(
    await supabase.from('awards').insert({ name: 'New bonus', scope: 'player', sort_order: nextSortOrder }).select().single()
  );
  must(await supabase.from('award_places').insert({ award_id: award.id, place: 1, points: 2, winner_player_id: null, winner_team_id: null }));
}

export async function updateAwardName(id, name) {
  must(await supabase.from('awards').update({ name }).eq('id', id));
}

export async function updateAwardScope(id, scope) {
  must(await supabase.from('awards').update({ scope }).eq('id', id));
  must(await supabase.from('award_places').update({ winner_player_id: null, winner_team_id: null }).eq('award_id', id));
}

export async function deleteAward(id) {
  must(await supabase.from('award_places').delete().eq('award_id', id));
  must(await supabase.from('awards').delete().eq('id', id));
}

export async function setAwardPlaceWinner(awardId, place, scope, winnerId) {
  must(
    await supabase
      .from('award_places')
      .update({
        winner_player_id: scope === 'player' ? winnerId || null : null,
        winner_team_id: scope === 'team' ? winnerId || null : null,
      })
      .eq('award_id', awardId)
      .eq('place', place)
  );
}

export async function setAwardPlacePoints(awardId, place, points) {
  must(await supabase.from('award_places').update({ points }).eq('award_id', awardId).eq('place', place));
}

export async function addAwardPlace(awardId, currentCount) {
  must(
    await supabase
      .from('award_places')
      .insert({ award_id: awardId, place: currentCount + 1, points: 1, winner_player_id: null, winner_team_id: null })
  );
}

export async function removeAwardPlace(awardId, place, totalPlaces) {
  must(await supabase.from('award_places').delete().eq('award_id', awardId).eq('place', place));
  for (let p = place + 1; p <= totalPlaces; p++) {
    must(await supabase.from('award_places').update({ place: p - 1 }).eq('award_id', awardId).eq('place', p));
  }
}

/* ------------------------------------- book -------------------------------------------- */

export async function addMarket(name) {
  must(await supabase.from('book_markets').insert({ name, settled: null }));
}

export async function seedMarkets(teamNames, playerNames) {
  const defs = [
    ['Overall winners', teamNames],
    ['Day 1 winners', teamNames],
    ['Day 2 winners', teamNames],
    ['Individual champion', playerNames],
    ['Longest drive', playerNames],
    ['Closest to the pin', playerNames],
    ['First to lose a ball', playerNames],
  ];
  for (const [name, opts] of defs) {
    const market = must(await supabase.from('book_markets').insert({ name, settled: null }).select().single());
    if (opts.length) {
      must(
        await supabase.from('book_selections').insert(opts.map((label) => ({ market_id: market.id, label, odds: 3 })))
      );
    }
  }
}

export async function updateMarket(id, patch) {
  must(await supabase.from('book_markets').update(patch).eq('id', id));
}

export async function deleteMarket(id) {
  must(await supabase.from('book_bet_legs').delete().eq('market_id', id));
  must(await supabase.from('book_selections').delete().eq('market_id', id));
  must(await supabase.from('book_markets').delete().eq('id', id));
}

export async function addSelection(marketId, label, odds) {
  must(await supabase.from('book_selections').insert({ market_id: marketId, label, odds }));
}

export async function updateSelectionOdds(id, odds) {
  must(await supabase.from('book_selections').update({ odds }).eq('id', id));
}

export async function deleteSelection(id) {
  must(await supabase.from('book_bet_legs').delete().eq('selection_id', id));
  must(await supabase.from('book_selections').delete().eq('id', id));
}

export async function placeBet(bettor, stake, legs) {
  const bet = must(await supabase.from('book_bets').insert({ bettor, stake }).select().single());
  must(
    await supabase.from('book_bet_legs').insert(
      legs.map((l) => ({ bet_id: bet.id, market_id: l.marketId, selection_id: l.selectionId, odds: l.odds }))
    )
  );
}

export async function deleteBet(id) {
  must(await supabase.from('book_bet_legs').delete().eq('bet_id', id));
  must(await supabase.from('book_bets').delete().eq('id', id));
}

/* ------------------------------- reset / demo data -------------------------------------- */

async function wipeAll() {
  must(await supabase.from('book_bet_legs').delete().not('id', 'is', null));
  must(await supabase.from('book_bets').delete().not('id', 'is', null));
  must(await supabase.from('book_selections').delete().not('id', 'is', null));
  must(await supabase.from('book_markets').delete().not('id', 'is', null));
  must(await supabase.from('award_places').delete().not('award_id', 'is', null));
  must(await supabase.from('awards').delete().not('id', 'is', null));
  must(await supabase.from('scores').delete().not('player_id', 'is', null));
  must(await supabase.from('players').delete().not('id', 'is', null));
  must(await supabase.from('teams').delete().not('id', 'is', null));
}

async function resetDays() {
  must(
    await supabase
      .from('days')
      .update({ label: 'Day 1', course: '', par: DEFAULT_PAR, si: DEFAULT_SI, allowance: 100, format: 'betterball', team_points: [4, 2, 0] })
      .eq('id', 'd1')
  );
  must(
    await supabase
      .from('days')
      .update({ label: 'Day 2', course: '', par: DEFAULT_PAR, si: DEFAULT_SI, allowance: 100, format: 'combined', team_points: [4, 2, 0] })
      .eq('id', 'd2')
  );
}

async function resetIndividualConfig() {
  must(await supabase.from('individual_config').update({ enabled: true, points: [3, 2, 1, 0, 0, 0] }).eq('key', 'd1'));
  must(await supabase.from('individual_config').update({ enabled: true, points: [3, 2, 1, 0, 0, 0] }).eq('key', 'd2'));
  must(await supabase.from('individual_config').update({ enabled: false, points: [3, 2, 1, 0, 0, 0] }).eq('key', 'combined'));
}

export async function resetEverything() {
  await wipeAll();
  await resetDays();
  await resetIndividualConfig();
  must(await updateEvent({ title: "Stoker's Stag", subtitle: 'Malaga' }));
  must(
    await supabase.from('teams').insert(
      TEAM_COLOURS.map((colour, i) => ({ name: 'Team ' + (i + 1), colour, sort_order: i }))
    )
  );
  must(
    await supabase.from('players').insert(
      ['Chris', 'James', 'Joe', 'Charlie', 'Bavs', 'Dan'].map((name) => ({ name, hcp: 18 }))
    )
  );
}

export async function loadDemoData() {
  await wipeAll();
  await resetIndividualConfig();
  must(await updateEvent({ title: "Stoker's Stag", subtitle: 'Malaga' }));

  const hcp = { Chris: 11, James: 12, Joe: 19, Charlie: 8, Bavs: 15, Dan: 21 };
  const roster = [
    { name: 'Sand Trappers', members: ['Chris', 'Dan'] },
    { name: 'The Bunker Boys', members: ['James', 'Bavs'] },
    { name: 'Fairway Villains', members: ['Joe', 'Charlie'] },
  ];

  const teamRows = must(
    await supabase
      .from('teams')
      .insert(roster.map((r, i) => ({ name: r.name, colour: TEAM_COLOURS[i], sort_order: i })))
      .select()
  );

  const byName = {};
  for (let i = 0; i < roster.length; i++) {
    const teamId = teamRows[i].id;
    for (const name of roster[i].members) {
      const player = must(await supabase.from('players').insert({ name, hcp: hcp[name], team_id: teamId }).select().single());
      byName[name] = player.id;
    }
  }

  must(
    await supabase
      .from('days')
      .update({ course: 'Real Club de Golf Guadalhorce', allowance: 90 })
      .eq('id', 'd1')
  );
  must(await supabase.from('days').update({ course: 'Añoreta Golf', allowance: 100 }).eq('id', 'd2'));

  const d1 = {
    Chris: [4, 5, 3, 5, 4, 5, 3, 4, 5, 4, 3, 4, 6, 4, 4, 3, 4, 4],
    Dan: [5, 6, 4, 6, 5, 5, 5, 5, 6, 5, 4, 5, 7, 6, 5, 4, 5, 5],
    James: [4, 5, 3, 6, 5, 4, 3, 5, 6, 4, 4, 4, 6, 5, 4, 3, 5, 4],
    Bavs: [5, 6, 4, 6, 4, 6, 4, 5, 6, 5, 3, 6, 6, 5, 6, 4, 6, 5],
    Joe: [5, 6, 4, 7, 6, 5, 4, 6, 7, 5, 4, 6, 7, 6, 6, 4, 6, 5],
    Charlie: [4, 4, 3, 5, 5, 4, 3, 4, 5, 3, 3, 4, 5, 5, 4, 3, 5, 3],
  };
  const d2 = {
    Chris: [4, 5, 4, 5, 4, 4, 3, 5, 5],
    Dan: [6, 6, 5, 6, 5, 6, 5, 6, 6],
    James: [5, 5, 3, 6, 4, 5, 4, 4, 6],
    Bavs: [5, 6, 4, 6, 5, 4, 4, 6, 6],
    Joe: [6, 7, 4, 7, 6, 6, 4, 7, 7],
    Charlie: [4, 4, 3, 5, 3, 4, 3, 4, 4],
  };

  const scoreRows = [];
  Object.entries(d1).forEach(([name, arr]) => {
    arr.forEach((gross, i) => scoreRows.push({ day_id: 'd1', player_id: byName[name], hole: i + 1, gross }));
  });
  Object.entries(d2).forEach(([name, arr]) => {
    arr.forEach((gross, i) => scoreRows.push({ day_id: 'd2', player_id: byName[name], hole: i + 1, gross }));
  });
  must(await supabase.from('scores').insert(scoreRows));

  must(await supabase.from('individual_config').update({ enabled: true }).eq('key', 'combined'));

  const awardDefs = [
    ['Longest drive — Day 1', byName.Joe],
    ['Closest to the pin — Day 1', byName.Charlie],
    ['Longest drive — Day 2', null],
    ['Closest to the pin — Day 2', null],
  ];
  for (let i = 0; i < awardDefs.length; i++) {
    const [name, winner] = awardDefs[i];
    const award = must(
      await supabase.from('awards').insert({ name, scope: 'player', sort_order: i }).select().single()
    );
    must(
      await supabase
        .from('award_places')
        .insert({ award_id: award.id, place: 1, points: 2, winner_player_id: winner, winner_team_id: null })
    );
  }
}
