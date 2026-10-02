export const BANNERS = Object.freeze({
  characters: Object.freeze({
    key: 'characters',
    label: 'Легендарные персонажи',
    hardPity: 90,
    empiricalHardPity: 90,
    baseRate: 0.006,
    officialConsolidatedRate: 0.016,
    softPityStart: 74,
    softPityStep: 0.06,
    targetHardGuaranteePulls: 180,
    freshTargetFiveStarRate: 0.55,
  }),
  weapons: Object.freeze({
    key: 'weapons',
    label: 'Легендарное оружие',
    hardPity: 80,
    empiricalHardPity: 77,
    baseRate: 0.007,
    officialConsolidatedRate: 0.0185,
    softPityStart: 63,
    softPityStep: 0.07,
    targetHardGuaranteePulls: 160,
    freshTargetFiveStarRate: 0.375,
  }),
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function getBanner(type) {
  const banner = BANNERS[type];
  if (!banner) throw new Error(`Unknown banner type: ${type}`);
  return banner;
}

/**
 * Community / empirical 5★ hazard model.
 *
 * Official: base rates, consolidated rates and hard-pity guarantees.
 * Community model: exact soft-pity ramp is not published by HoYoverse.
 * Character: 0.6% through pity 73, then +6 percentage points per pity.
 * Weapon: 0.7% through pity 62, then +7 percentage points per pity.
 *
 * Returns P(5★ on this pull | no 5★ since last reset).
 */
export function fiveStarRate(type, pity) {
  const cfg = getBanner(type);
  if (!Number.isFinite(pity)) throw new TypeError('pity must be a finite number');
  const x = Math.max(1, Math.floor(pity));

  if (x >= cfg.hardPity) return 1;
  if (x < cfg.softPityStart) return cfg.baseRate;

  return clamp01(cfg.baseRate + (x - (cfg.softPityStart - 1)) * cfg.softPityStep);
}

/** Distribution of the first 5★ in a pity cycle starting from 0 pity. */
export function firstFiveStarDistribution(type) {
  const cfg = getBanner(type);
  const rows = [];
  let survivalBefore = 1;

  for (let pity = 1; pity <= cfg.hardPity; pity += 1) {
    const hazard = fiveStarRate(type, pity);
    const exact = survivalBefore * hazard;
    const survival = survivalBefore * (1 - hazard);
    const cumulative = 1 - survival;
    rows.push({ pity, hazard, exact, cumulative, survival });
    survivalBefore = survival;
  }

  return rows;
}

export function distributionStats(type) {
  const rows = firstFiveStarDistribution(type);
  const expectedPity = rows.reduce((sum, row) => sum + row.pity * row.exact, 0);
  const modelConsolidatedRate = expectedPity > 0 ? 1 / expectedPity : 0;
  const quantile = (q) => rows.find((row) => row.cumulative >= q)?.pity ?? rows.at(-1).pity;

  return {
    expectedPity,
    modelConsolidatedRate,
    medianPity: quantile(0.5),
    p90Pity: quantile(0.9),
    p95Pity: quantile(0.95),
    p99Pity: quantile(0.99),
  };
}

/** P(at least one 5★ within N future pulls), given current pity. */
export function anyFiveStarChanceWithin(type, pulls, { startingPity = 0 } = {}) {
  const cfg = getBanner(type);
  const n = Math.max(0, Math.floor(Number(pulls) || 0));
  let pity = Math.max(0, Math.min(cfg.hardPity - 1, Math.floor(Number(startingPity) || 0)));
  let survival = 1;

  for (let i = 0; i < n && survival > 0; i += 1) {
    const hazard = fiveStarRate(type, pity + 1);
    survival *= 1 - hazard;
    pity += 1;
    if (pity >= cfg.hardPity) break;
  }

  return clamp01(1 - survival);
}

/**
 * Exact DP under the selected character-banner assumptions.
 *
 * `nonGuaranteedWinRate=0.55` uses HoYoverse's published consolidated
 * promotional-character probability INCLUDING Capturing Radiance for a
 * non-guaranteed 5★. It is an aggregate rate, not an account-specific hidden
 * Capturing Radiance counter reconstruction.
 */
export function featuredCharacterChanceSeries(
  maxPulls,
  { startingPity = 0, guaranteed = false, nonGuaranteedWinRate = 0.55 } = {},
) {
  const cfg = BANNERS.characters;
  const n = Math.max(0, Math.floor(Number(maxPulls) || 0));
  const initialPity = Math.max(0, Math.min(cfg.hardPity - 1, Math.floor(Number(startingPity) || 0)));
  const winRate = clamp01(nonGuaranteedWinRate);

  let success = 0;
  let states = new Map([[`${initialPity}|${guaranteed ? 1 : 0}`, 1]]);
  const series = [];

  for (let pull = 1; pull <= n; pull += 1) {
    const next = new Map();

    for (const [key, mass] of states) {
      const [pityRaw, guaranteeRaw] = key.split('|').map(Number);
      const hazard = fiveStarRate('characters', pityRaw + 1);
      const missMass = mass * (1 - hazard);

      if (missMass > 0) {
        const nextPity = Math.min(pityRaw + 1, cfg.hardPity - 1);
        addMass(next, `${nextPity}|${guaranteeRaw}`, missMass);
      }

      const fiveMass = mass * hazard;
      if (fiveMass <= 0) continue;

      if (guaranteeRaw === 1) {
        success += fiveMass;
      } else {
        success += fiveMass * winRate;
        const lossMass = fiveMass * (1 - winRate);
        if (lossMass > 0) addMass(next, '0|1', lossMass);
      }
    }

    states = next;
    series.push(clamp01(success));
  }

  return series;
}

export function featuredCharacterChanceWithin(pulls, options = {}) {
  return featuredCharacterChanceSeries(pulls, options).at(-1) ?? 0;
}

/**
 * Exact DP for a charted Epitomized Path (v5.0+ one Fate Point system).
 * With 0 Fate Points, chosen weapon chance on a 5★ is:
 * - 37.5% normally: 75% promotional × 1/2 of the two promo weapons;
 * - 50% if the next 5★ is already guaranteed promotional after a 75/25 loss.
 * Any non-target 5★ gives 1 Fate Point, making the following 5★ the target.
 */
export function featuredWeaponChanceSeries(
  maxPulls,
  { startingPity = 0, fatePoint = 0, featuredGuaranteed = false } = {},
) {
  const cfg = BANNERS.weapons;
  const n = Math.max(0, Math.floor(Number(maxPulls) || 0));
  const initialPity = Math.max(0, Math.min(cfg.hardPity - 1, Math.floor(Number(startingPity) || 0)));
  const initialFatePoint = Number(fatePoint) >= 1 ? 1 : 0;
  const initialFeaturedGuarantee = Boolean(featuredGuaranteed);

  let success = 0;
  let states = new Map([
    [`${initialPity}|${initialFatePoint}|${initialFeaturedGuarantee ? 1 : 0}`, 1],
  ]);
  const series = [];

  for (let pull = 1; pull <= n; pull += 1) {
    const next = new Map();

    for (const [key, mass] of states) {
      const [pityRaw, fateRaw, guaranteeRaw] = key.split('|').map(Number);
      const hazard = fiveStarRate('weapons', pityRaw + 1);
      const missMass = mass * (1 - hazard);

      if (missMass > 0) {
        const nextPity = Math.min(pityRaw + 1, cfg.hardPity - 1);
        addMass(next, `${nextPity}|${fateRaw}|${guaranteeRaw}`, missMass);
      }

      const fiveMass = mass * hazard;
      if (fiveMass <= 0) continue;

      if (fateRaw === 1) {
        success += fiveMass;
        continue;
      }

      const targetRate = guaranteeRaw === 1 ? 0.5 : 0.375;
      success += fiveMass * targetRate;

      const nonTargetMass = fiveMass * (1 - targetRate);
      if (nonTargetMass > 0) {
        addMass(next, '0|1|1', nonTargetMass);
      }
    }

    states = next;
    series.push(clamp01(success));
  }

  return series;
}

export function featuredWeaponChanceWithin(pulls, options = {}) {
  return featuredWeaponChanceSeries(pulls, options).at(-1) ?? 0;
}

export function targetChanceWithin(type, pulls, options = {}) {
  if (type === 'characters') return featuredCharacterChanceWithin(pulls, options);
  if (type === 'weapons') return featuredWeaponChanceWithin(pulls, options);
  throw new Error(`Unknown banner type: ${type}`);
}

export function targetChanceSeries(type, maxPulls, options = {}) {
  if (type === 'characters') return featuredCharacterChanceSeries(maxPulls, options);
  if (type === 'weapons') return featuredWeaponChanceSeries(maxPulls, options);
  throw new Error(`Unknown banner type: ${type}`);
}

function addMass(map, key, mass) {
  map.set(key, (map.get(key) || 0) + mass);
}
