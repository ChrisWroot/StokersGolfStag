/* ==========================================================================
   STOKER'S STAG — pure scoring function tests
   Run with: node test.js
   ========================================================================== */

import assert from 'node:assert/strict';
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
} from './src/scoring.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok  ' + name);
  } catch (e) {
    fail++;
    console.log('FAIL  ' + name);
    console.log('      ' + e.message);
  }
}

/* --------------------------------- playingHcp ------------------------------ */

test('playingHcp: 100% allowance is a straight copy', () => {
  assert.equal(playingHcp(18, 100), 18);
  assert.equal(playingHcp(11, 100), 11);
});

test('playingHcp: rounds to nearest whole stroke', () => {
  assert.equal(playingHcp(18, 90), 16); // 16.2 -> 16
  assert.equal(playingHcp(15, 90), 14); // 13.5 -> 14 (round-half-up)
  assert.equal(playingHcp(21, 90), 19); // 18.9 -> 19
});

test('playingHcp: missing/blank handicap treated as 0', () => {
  assert.equal(playingHcp(null, 100), 0);
  assert.equal(playingHcp('', 100), 0);
  assert.equal(playingHcp(undefined, 90), 0);
});

test('playingHcp: missing allowance defaults to 100%', () => {
  assert.equal(playingHcp(12, null), 12);
  assert.equal(playingHcp(12, ''), 12);
});

/* ---------------------------------- shotsFor -------------------------------- */

test('shotsFor: single stroke on the hardest holes for hcp < 18', () => {
  // playing off 11: shots on SI 1-11
  assert.equal(shotsFor(11, 1), 1);
  assert.equal(shotsFor(11, 11), 1);
  assert.equal(shotsFor(11, 12), 0);
  assert.equal(shotsFor(11, 18), 0);
});

test('shotsFor: exactly 18 gives one shot on every hole', () => {
  for (let si = 1; si <= 18; si++) assert.equal(shotsFor(18, si), 1);
});

test('shotsFor: above 18 stacks a second shot on the lowest SI holes', () => {
  // playing off 21: everyone gets 1, plus SI 1-3 get a 2nd
  assert.equal(shotsFor(21, 1), 2);
  assert.equal(shotsFor(21, 3), 2);
  assert.equal(shotsFor(21, 4), 1);
  assert.equal(shotsFor(21, 18), 1);
});

test('shotsFor: exactly 36 gives two shots on every hole', () => {
  for (let si = 1; si <= 18; si++) assert.equal(shotsFor(36, si), 2);
});

test('shotsFor: negative (plus) handicap removes shots on the easiest holes', () => {
  // playing off -3: strokes given back on SI 16-18 (19 - (3%18)=16 -> si>=16)
  assert.equal(shotsFor(-3, 18), -1);
  assert.equal(shotsFor(-3, 16), -1);
  assert.equal(Object.is(shotsFor(-3, 15), -0) || shotsFor(-3, 15) === 0, true);
  assert.equal(Object.is(shotsFor(-3, 1), -0) || shotsFor(-3, 1) === 0, true);
});

test('shotsFor: 0 handicap gives no shots anywhere', () => {
  for (let si = 1; si <= 18; si++) assert.equal(shotsFor(0, si), 0);
});

/* --------------------------------- stableford -------------------------------- */

test('stableford: par net score returns 2 points', () => {
  assert.equal(stableford(4, 4, 0), 2);
});

test('stableford: birdie/eagle nets increase points beyond 2', () => {
  assert.equal(stableford(3, 4, 0), 3); // birdie
  assert.equal(stableford(2, 4, 0), 4); // eagle
});

test('stableford: bogey/double reduce points, floored at 0', () => {
  assert.equal(stableford(5, 4, 0), 1); // bogey
  assert.equal(stableford(6, 4, 0), 0); // double bogey
  assert.equal(stableford(9, 4, 0), 0); // way over par still floors at 0
});

test('stableford: shots received offset the gross score', () => {
  assert.equal(stableford(5, 4, 1), 2); // net par with one shot
  assert.equal(stableford(6, 4, 2), 2); // net par with two shots
});

test('stableford: null/blank/NaN gross returns null (no score entered)', () => {
  assert.equal(stableford(null, 4, 0), null);
  assert.equal(stableford('', 4, 0), null);
  assert.equal(stableford('abc', 4, 0), null);
});

test('stableford: gross of 0 is falsy but still a real score', () => {
  // 0 !== null/'' and not NaN, so it should score, not be treated as blank
  assert.notEqual(stableford(0, 4, 0), null);
});

/* ------------------------------------ sum ------------------------------------ */

test('sum: adds an array of numbers', () => {
  assert.equal(sum([1, 2, 3, 4]), 10);
});

test('sum: treats null/undefined entries as 0', () => {
  assert.equal(sum([1, null, 2, undefined, 3]), 6);
});

test('sum: empty array is 0', () => {
  assert.equal(sum([]), 0);
});

/* -------------------------------- rankGroups --------------------------------- */

test('rankGroups: strict ordering with no ties gives one group each', () => {
  const items = [{ id: 'a', v: 3 }, { id: 'b', v: 1 }, { id: 'c', v: 2 }];
  const groups = rankGroups(items, (a, b) => b.v - a.v);
  assert.deepEqual(groups.map((g) => g.map((x) => x.id)), [['a'], ['c'], ['b']]);
});

test('rankGroups: equal comparator values are grouped together', () => {
  const items = [{ id: 'a', v: 2 }, { id: 'b', v: 2 }, { id: 'c', v: 1 }];
  const groups = rankGroups(items, (a, b) => b.v - a.v);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((x) => x.id).sort(), ['a', 'b']);
  assert.deepEqual(groups[1].map((x) => x.id), ['c']);
});

test('rankGroups: everything tied collapses to a single group', () => {
  const items = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }];
  const groups = rankGroups(items, (a, b) => b.v - a.v);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 3);
});

test('rankGroups: empty input gives no groups', () => {
  assert.deepEqual(rankGroups([], (a, b) => 0), []);
});

/* -------------------------------- sharePoints -------------------------------- */

test('sharePoints: no ties awards points straight down the schedule', () => {
  const groups = [[{ id: 'a' }], [{ id: 'b' }], [{ id: 'c' }]];
  const awarded = sharePoints(groups, [4, 2, 0]);
  assert.deepEqual(awarded, { a: 4, b: 2, c: 0 });
});

test('sharePoints: a tie for first splits 1st+2nd evenly between them', () => {
  const groups = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]];
  const awarded = sharePoints(groups, [4, 2, 0]);
  assert.equal(awarded.a, 3); // (4+2)/2
  assert.equal(awarded.b, 3);
  assert.equal(awarded.c, 0);
});

test('sharePoints: a three-way tie for first splits all three places evenly', () => {
  const groups = [[{ id: 'a' }, { id: 'b' }, { id: 'c' }]];
  const awarded = sharePoints(groups, [4, 2, 0]);
  assert.equal(awarded.a, 2); // (4+2+0)/3
  assert.equal(awarded.b, 2);
  assert.equal(awarded.c, 2);
});

test('sharePoints: missing schedule slots treated as 0', () => {
  const groups = [[{ id: 'a' }], [{ id: 'b' }]];
  const awarded = sharePoints(groups, [4]); // only 1st place defined
  assert.equal(awarded.a, 4);
  assert.equal(awarded.b, 0);
});

/* --------------------------------- betReturn ---------------------------------- */

const marketsOpen = [{ id: 'm1', settled: null }];
const marketsWonA = [{ id: 'm1', settled: 'selA' }];
const marketsVoid = [{ id: 'm1', settled: 'void' }];

test('betReturn: single winning leg returns stake x odds', () => {
  const bet = { stake: 10, legs: [{ marketId: 'm1', selectionId: 'selA', odds: 3 }] };
  const r = betReturn(bet, marketsWonA);
  assert.equal(r.status, 'won');
  assert.equal(r.ret, 30);
});

test('betReturn: single losing leg returns 0', () => {
  const bet = { stake: 10, legs: [{ marketId: 'm1', selectionId: 'selB', odds: 3 }] };
  const r = betReturn(bet, marketsWonA);
  assert.equal(r.status, 'lost');
  assert.equal(r.ret, 0);
});

test('betReturn: unsettled market leaves the bet open', () => {
  const bet = { stake: 10, legs: [{ marketId: 'm1', selectionId: 'selA', odds: 3 }] };
  const r = betReturn(bet, marketsOpen);
  assert.equal(r.status, 'open');
  assert.equal(r.ret, 0);
});

test('betReturn: void leg is dropped from the multiplier, not a loss', () => {
  const bet = { stake: 10, legs: [{ marketId: 'm1', selectionId: 'selA', odds: 3 }] };
  const r = betReturn(bet, marketsVoid);
  assert.equal(r.status, 'won');
  assert.equal(r.ret, 10); // multiplier stays 1x, stake returned
});

test('betReturn: accumulator multiplies odds across winning legs', () => {
  const markets = [
    { id: 'm1', settled: 'selA' },
    { id: 'm2', settled: 'selB' },
  ];
  const bet = {
    stake: 5,
    legs: [
      { marketId: 'm1', selectionId: 'selA', odds: 2 },
      { marketId: 'm2', selectionId: 'selB', odds: 4 },
    ],
  };
  const r = betReturn(bet, markets);
  assert.equal(r.status, 'won');
  assert.equal(r.ret, 40); // 5 * 2 * 4
});

test('betReturn: one losing leg in an accumulator loses the whole bet', () => {
  const markets = [
    { id: 'm1', settled: 'selA' },
    { id: 'm2', settled: 'selX' }, // selB did not win
  ];
  const bet = {
    stake: 5,
    legs: [
      { marketId: 'm1', selectionId: 'selA', odds: 2 },
      { marketId: 'm2', selectionId: 'selB', odds: 4 },
    ],
  };
  const r = betReturn(bet, markets);
  assert.equal(r.status, 'lost');
  assert.equal(r.ret, 0);
});

test('betReturn: an unsettled leg keeps an otherwise-winning acca open, not won', () => {
  const markets = [
    { id: 'm1', settled: 'selA' },
    { id: 'm2', settled: null },
  ];
  const bet = {
    stake: 5,
    legs: [
      { marketId: 'm1', selectionId: 'selA', odds: 2 },
      { marketId: 'm2', selectionId: 'selB', odds: 4 },
    ],
  };
  const r = betReturn(bet, markets);
  assert.equal(r.status, 'open');
});

test('betReturn: a lost leg beats an open leg — the bet is dead, not pending', () => {
  const markets = [
    { id: 'm1', settled: 'selX' }, // lost
    { id: 'm2', settled: null }, // open
  ];
  const bet = {
    stake: 5,
    legs: [
      { marketId: 'm1', selectionId: 'selA', odds: 2 },
      { marketId: 'm2', selectionId: 'selB', odds: 4 },
    ],
  };
  const r = betReturn(bet, markets);
  assert.equal(r.status, 'lost');
});

/* --------------------------------- scoreMark ----------------------------------- */

test('scoreMark: par gets no mark', () => {
  assert.equal(scoreMark(4, 4), null);
});

test('scoreMark: birdie is a single circle', () => {
  assert.deepEqual(scoreMark(3, 4), { shape: 'circle', double: false });
});

test('scoreMark: eagle or better is a double circle', () => {
  assert.deepEqual(scoreMark(2, 4), { shape: 'circle', double: true });
  assert.deepEqual(scoreMark(1, 4), { shape: 'circle', double: true });
});

test('scoreMark: bogey is a single square', () => {
  assert.deepEqual(scoreMark(5, 4), { shape: 'square', double: false });
});

test('scoreMark: double bogey or worse is a double square', () => {
  assert.deepEqual(scoreMark(6, 4), { shape: 'square', double: true });
  assert.deepEqual(scoreMark(9, 4), { shape: 'square', double: true });
});

test('scoreMark: null gross or par gives no mark', () => {
  assert.equal(scoreMark(null, 4), null);
  assert.equal(scoreMark(4, null), null);
});

/* -------------------------------- misc helpers ---------------------------------- */

test('formatName: maps format keys to display labels', () => {
  assert.equal(formatName('betterball'), 'Better ball');
  assert.equal(formatName('combined'), 'Combined stableford');
});

test('fmt: integers print without decimals, fractions to one place', () => {
  assert.equal(fmt(4), '4');
  assert.equal(fmt(3.5), '3.5');
  assert.equal(fmt(null), '0');
});

test('ORDINALS: covers all six possible finishing places', () => {
  assert.equal(ORDINALS.length, 6);
  assert.equal(ORDINALS[0], '1st');
  assert.equal(ORDINALS[5], '6th');
});

/* ---------------------------------------------------------------------------- */

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
