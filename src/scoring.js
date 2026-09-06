/* ==========================================================================
   STOKER'S STAG — pure scoring functions
   Ported verbatim from the original single-file artifact. Do not rederive.
   ========================================================================== */

export function playingHcp(hcp, allowance) {
  const h = Number(hcp) || 0;
  return Math.round((h * (Number(allowance) || 100)) / 100);
}

// Shots received on a hole of stroke index si for playing handicap ph.
export function shotsFor(ph, si) {
  if (ph >= 0) {
    const base = Math.floor(ph / 18);
    return base + (si <= ph % 18 ? 1 : 0);
  }
  const p = -ph;
  return -(si >= 19 - (p % 18) ? 1 : 0) - Math.floor(p / 18);
}

export function stableford(gross, par, shots) {
  if (gross == null || gross === '' || isNaN(gross)) return null;
  const net = Number(gross) - shots;
  return Math.max(0, 2 + par - net);
}

export function sum(arr) {
  return arr.reduce((a, b) => a + (b || 0), 0);
}

// Sort items and group ties. cmp returns <0 if a ranks ahead of b, 0 if tied.
export function rankGroups(items, cmp) {
  const sorted = [...items].sort(cmp);
  const groups = [];
  sorted.forEach((it) => {
    const last = groups[groups.length - 1];
    if (last && cmp(last[0], it) === 0) last.push(it);
    else groups.push([it]);
  });
  return groups;
}

// Awards points from a schedule, sharing evenly across tied positions.
export function sharePoints(groups, pointsArr) {
  const out = {};
  let idx = 0;
  groups.forEach((g) => {
    const slice = [];
    for (let i = 0; i < g.length; i++) slice.push(Number(pointsArr[idx + i]) || 0);
    const share = slice.reduce((a, b) => a + b, 0) / g.length;
    g.forEach((it) => (out[it.id] = share));
    idx += g.length;
  });
  return out;
}

export function formatName(f) {
  return f === 'betterball' ? 'Better ball' : 'Combined stableford';
}

export const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export function betReturn(bet, markets) {
  let mult = 1;
  let status = 'won';
  bet.legs.forEach((leg) => {
    const m = markets.find((x) => x.id === leg.marketId);
    const settled = m ? m.settled : undefined;
    if (settled == null) {
      if (status !== 'lost') status = 'open';
      return;
    }
    if (settled === 'void') return;
    if (settled !== leg.selectionId) {
      status = 'lost';
      return;
    }
    mult *= Number(leg.odds) || 1;
  });
  if (status === 'lost') return { status, ret: 0 };
  if (status === 'open') return { status, ret: 0 };
  return { status: 'won', ret: Number(bet.stake) * mult };
}

export function scoreMark(gross, par) {
  if (gross == null || par == null) return null;
  const diff = gross - par;
  if (diff <= -2) return { shape: 'circle', double: true }; // eagle or better
  if (diff === -1) return { shape: 'circle', double: false }; // birdie
  if (diff === 1) return { shape: 'square', double: false }; // bogey
  if (diff >= 2) return { shape: 'square', double: true }; // double bogey or worse
  return null; // par — no mark
}

export function fmt(n) {
  if (n == null) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
