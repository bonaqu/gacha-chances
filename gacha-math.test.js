import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANNERS,
  anyFiveStarChanceWithin,
  distributionStats,
  featuredCharacterChanceWithin,
  featuredWeaponChanceWithin,
  firstFiveStarDistribution,
  fiveStarRate,
} from './gacha-math.js';

const almost = (actual, expected, eps = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);
};

test('character hazard curve matches the community model and official hard pity', () => {
  almost(fiveStarRate('characters', 1), 0.006);
  almost(fiveStarRate('characters', 73), 0.006);
  almost(fiveStarRate('characters', 74), 0.066);
  almost(fiveStarRate('characters', 76), 0.186);
  almost(fiveStarRate('characters', 80), 0.426);
  almost(fiveStarRate('characters', 89), 0.966);
  almost(fiveStarRate('characters', 90), 1);
});

test('weapon hazard curve matches the community model', () => {
  almost(fiveStarRate('weapons', 1), 0.007);
  almost(fiveStarRate('weapons', 62), 0.007);
  almost(fiveStarRate('weapons', 63), 0.077);
  almost(fiveStarRate('weapons', 70), 0.567);
  almost(fiveStarRate('weapons', 76), 0.987);
  almost(fiveStarRate('weapons', 77), 1);
  almost(fiveStarRate('weapons', 80), 1);
});

test('first-5★ distributions normalize to 100%', () => {
  for (const type of Object.keys(BANNERS)) {
    const rows = firstFiveStarDistribution(type);
    almost(rows.reduce((sum, row) => sum + row.exact, 0), 1, 1e-12);
    almost(rows.at(-1).cumulative, 1, 1e-12);
  }
});

test('headline distribution stats match the empirical curves', () => {
  const character = distributionStats('characters');
  almost(character.expectedPity, 62.297332039630945, 1e-12);
  almost(character.modelConsolidatedRate, 0.016052051785521763, 1e-12);
  assert.equal(character.medianPity, 76);
  assert.equal(character.p95Pity, 81);

  const weapon = distributionStats('weapons');
  almost(weapon.expectedPity, 53.25039058538857, 1e-12);
  almost(weapon.modelConsolidatedRate, 0.018779204978721622, 1e-12);
  assert.equal(weapon.medianPity, 65);
  assert.equal(weapon.p95Pity, 70);
});

test('current pity affects future 5★ chance', () => {
  almost(anyFiveStarChanceWithin('characters', 1, { startingPity: 73 }), 0.066);
  almost(anyFiveStarChanceWithin('weapons', 1, { startingPity: 62 }), 0.077);
  almost(anyFiveStarChanceWithin('characters', 90), 1);
  almost(anyFiveStarChanceWithin('weapons', 80), 1);
});

test('featured character guarantee closes by 180 pulls', () => {
  almost(featuredCharacterChanceWithin(180), 1, 1e-12);
  almost(featuredCharacterChanceWithin(90, { guaranteed: true }), 1, 1e-12);
});

test('charted weapon guarantee closes by 160 official hard-pity pulls', () => {
  almost(featuredWeaponChanceWithin(160), 1, 1e-12);
  almost(featuredWeaponChanceWithin(80, { fatePoint: 1 }), 1, 1e-12);
});

test('target probabilities are monotonic', () => {
  for (const fn of [featuredCharacterChanceWithin, featuredWeaponChanceWithin]) {
    let previous = 0;
    for (let pulls = 1; pulls <= 180; pulls += 1) {
      const current = fn(pulls);
      assert.ok(current + 1e-14 >= previous);
      previous = current;
    }
  }
});
