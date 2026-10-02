import {
  BANNERS,
  anyFiveStarChanceWithin,
  distributionStats,
  firstFiveStarDistribution,
  targetChanceSeries,
  targetChanceWithin,
} from './gacha-math.js';

const STATE = {
  active: 'characters',
  planner: {
    characters: { pity: 0, pulls: 90, guaranteed: false },
    weapons: { pity: 0, pulls: 80, fatePoint: 0, featuredGuaranteed: false },
  },
};

const el = (id) => document.getElementById(id);
const gridEl = el('gridView');
const titleEl = el('bannerTitle');
const descEl = el('bannerDesc');
const rangeEl = el('countRange');
const sideBody = document.querySelector('#sideTable tbody');
const tooltip = el('tooltip');
const statsEl = el('bannerStats');
const currentPityEl = el('currentPity');
const futurePullsEl = el('futurePulls');
const characterGuaranteeWrap = el('characterGuaranteeWrap');
const characterGuaranteeEl = el('characterGuarantee');
const weaponFateWrap = el('weaponFateWrap');
const weaponFatePointEl = el('weaponFatePoint');
const weaponGuaranteeEl = el('weaponGuarantee');
const plannerAnyEl = el('plannerAny');
const plannerTargetEl = el('plannerTarget');
const plannerWorstEl = el('plannerWorst');
const plannerPrimogemsEl = el('plannerPrimogems');

const COLOR_STOPS = [
  { pct: 0, color: '#16a34a' },
  { pct: 40, color: '#bef264' },
  { pct: 60, color: '#facc15' },
  { pct: 80, color: '#f97316' },
  { pct: 100, color: '#ef4444' },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clearChildren = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const n = Number.parseInt(normalized, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function getColorForPercent(percent) {
  const pct = clamp(percent, 0, 100);
  let left = COLOR_STOPS[0];
  let right = COLOR_STOPS.at(-1);

  for (let i = 0; i < COLOR_STOPS.length - 1; i += 1) {
    if (pct >= COLOR_STOPS[i].pct && pct <= COLOR_STOPS[i + 1].pct) {
      left = COLOR_STOPS[i];
      right = COLOR_STOPS[i + 1];
      break;
    }
  }

  const t = (pct - left.pct) / (right.pct - left.pct || 1);
  const lc = hexToRgb(left.color);
  const rc = hexToRgb(right.color);
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  return rgbToHex(lerp(lc[0], rc[0]), lerp(lc[1], rc[1]), lerp(lc[2], rc[2]));
}

function fmtPct(probability, digits = 2) {
  const percent = probability * 100;
  if (percent > 0 && percent < 0.001) return '<0,001%';
  if (percent >= 99.9995) return '100%';
  return `${percent.toFixed(digits).replace('.', ',')}%`;
}

function fmtNumber(value, digits = 2) {
  return Number(value).toFixed(digits).replace('.', ',');
}

function plannerOptions(type) {
  const p = STATE.planner[type];
  if (type === 'characters') {
    return { startingPity: p.pity, guaranteed: p.guaranteed };
  }
  return {
    startingPity: p.pity,
    fatePoint: p.fatePoint,
    featuredGuaranteed: p.featuredGuaranteed,
  };
}

function freshTargetOptions(type) {
  if (type === 'characters') return { startingPity: 0, guaranteed: false };
  return { startingPity: 0, fatePoint: 0, featuredGuaranteed: false };
}

function worstCaseTargetPulls(type, options) {
  const cfg = BANNERS[type];
  const pityCredit = clamp(Number(options.startingPity) || 0, 0, cfg.hardPity - 1);

  if (type === 'characters') {
    return (options.guaranteed ? cfg.hardPity : cfg.targetHardGuaranteePulls) - pityCredit;
  }
  return (Number(options.fatePoint) >= 1 ? cfg.hardPity : cfg.targetHardGuaranteePulls) - pityCredit;
}

function assignStaggerIndicesRowMajor() {
  const positions = Array.from(gridEl.children).map((cell) => ({
    cell,
    top: Math.round(cell.offsetTop),
    left: Math.round(cell.offsetLeft),
  }));
  positions.sort((a, b) => a.top - b.top || a.left - b.left);
  positions.forEach(({ cell }, index) => cell.style.setProperty('--i', index));
}

function renderStats(type) {
  const cfg = BANNERS[type];
  const stats = distributionStats(type);
  const empiricalNote = type === 'weapons'
    ? `эмпирическая кривая достигает 100% на ${cfg.empiricalHardPity}-й`
    : `эмпирическая кривая до hard pity ${cfg.hardPity}`;

  statsEl.innerHTML = `
    <div class="stat"><span>База 5★</span><strong>${fmtPct(cfg.baseRate, 1)}</strong></div>
    <div class="stat"><span>Soft pity</span><strong>${cfg.softPityStart}+</strong></div>
    <div class="stat"><span>Офиц. гарант</span><strong>${cfg.hardPity}</strong></div>
    <div class="stat"><span>Среднее по модели</span><strong>${fmtNumber(stats.expectedPity, 2)} крут.</strong></div>
    <div class="stat"><span>Сводный шанс модели</span><strong>${fmtPct(stats.modelConsolidatedRate, 3)}</strong></div>
    <div class="stat"><span>Офиц. сводный шанс</span><strong>${fmtPct(cfg.officialConsolidatedRate, 2)}</strong></div>
    <div class="stat"><span>Медиана / 95%</span><strong>${stats.medianPity} / ${stats.p95Pity}</strong></div>
    <div class="stat"><span>Модель</span><strong title="Soft pity не опубликован HoYoverse">${empiricalNote}</strong></div>
  `;
}

function renderHeatmap(type) {
  const cfg = BANNERS[type];
  const data = firstFiveStarDistribution(type);
  const targetSeries = targetChanceSeries(type, cfg.hardPity, freshTargetOptions(type));

  titleEl.textContent = `${cfg.label} — реальное распределение 5★`;
  descEl.textContent = 'Цвет показывает, насколько поздней является крутка; проценты внутри — математические, а не линейный прогресс до гаранта.';
  rangeEl.textContent = `1 — ${cfg.hardPity}`;

  gridEl.classList.remove('visible');
  clearChildren(gridEl);
  clearChildren(sideBody);

  data.forEach((row, index) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.rolls = String(row.pity);
    cell.style.background = getColorForPercent((row.pity / cfg.hardPity) * 100);
    cell.textContent = row.pity;
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute(
      'aria-label',
      `${row.pity}-я крутка: шанс 5 звёзд ${fmtPct(row.hazard)}, накопленный шанс ${fmtPct(row.cumulative)}`,
    );
    cell.addEventListener('pointerenter', (event) => showTooltip(event, row, targetSeries[index]));
    cell.addEventListener('pointermove', moveTooltip);
    cell.addEventListener('pointerleave', hideTooltip);
    cell.addEventListener('focus', () => showTooltipForElement(cell, row, targetSeries[index]));
    cell.addEventListener('blur', hideTooltip);
    gridEl.appendChild(cell);

    const tr = document.createElement('tr');
    tr.dataset.rolls = String(row.pity);
    tr.innerHTML = `
      <td>${row.pity}</td>
      <td>${fmtPct(row.hazard)}</td>
      <td>${fmtPct(row.cumulative)}</td>
      <td>${fmtPct(targetSeries[index])}</td>
    `;
    sideBody.appendChild(tr);
  });

  requestAnimationFrame(() => {
    assignStaggerIndicesRowMajor();
    gridEl.classList.add('visible');
  });
}

function renderPlanner(type) {
  const cfg = BANNERS[type];
  const p = STATE.planner[type];

  currentPityEl.max = String(cfg.hardPity - 1);
  currentPityEl.value = String(p.pity);
  futurePullsEl.max = String(cfg.targetHardGuaranteePulls);
  futurePullsEl.value = String(p.pulls);

  characterGuaranteeWrap.hidden = type !== 'characters';
  weaponFateWrap.hidden = type !== 'weapons';

  if (type === 'characters') {
    characterGuaranteeEl.checked = p.guaranteed;
  } else {
    weaponFatePointEl.value = String(p.fatePoint);
    weaponGuaranteeEl.checked = p.featuredGuaranteed;
  }

  updatePlannerResults();
}

function updatePlannerResults() {
  const type = STATE.active;
  const cfg = BANNERS[type];
  const p = STATE.planner[type];

  p.pity = clamp(Math.floor(Number(currentPityEl.value) || 0), 0, cfg.hardPity - 1);
  p.pulls = clamp(Math.floor(Number(futurePullsEl.value) || 0), 0, cfg.targetHardGuaranteePulls);

  if (type === 'characters') {
    p.guaranteed = characterGuaranteeEl.checked;
  } else {
    p.fatePoint = Number(weaponFatePointEl.value) >= 1 ? 1 : 0;
    p.featuredGuaranteed = weaponGuaranteeEl.checked;
  }

  currentPityEl.value = String(p.pity);
  futurePullsEl.value = String(p.pulls);

  const options = plannerOptions(type);
  const anyChance = anyFiveStarChanceWithin(type, p.pulls, options);
  const targetChance = targetChanceWithin(type, p.pulls, options);
  const worst = worstCaseTargetPulls(type, options);

  plannerAnyEl.textContent = fmtPct(anyChance);
  plannerTargetEl.textContent = fmtPct(targetChance);
  plannerWorstEl.textContent = `${worst} крут.`;
  plannerPrimogemsEl.textContent = `${(p.pulls * 160).toLocaleString('ru-RU')} примо`;

  persistState();
}

function render() {
  const type = STATE.active;
  document.querySelectorAll('.tab-btn').forEach((button) => {
    const active = button.id === `tab-${type}`;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  renderHeatmap(type);
  renderStats(type);
  renderPlanner(type);
  try { localStorage.setItem('lastBanner', type); } catch { /* storage optional */ }
}

function switchTab(type) {
  if (!BANNERS[type] || type === STATE.active) return;
  STATE.active = type;
  hideTooltip();
  render();
}

function tooltipHtml(row, targetChance) {
  return `
    <div>Крутка: <strong>${row.pity}</strong></div>
    <div>5★ именно сейчас: <strong>${fmtPct(row.hazard)}</strong></div>
    <div>Первый 5★ ровно здесь: <strong>${fmtPct(row.exact, 3)}</strong></div>
    <div>5★ уже получен к этой крутке: <strong>${fmtPct(row.cumulative)}</strong></div>
    <div>Целевой 5★ к этой крутке*: <strong>${fmtPct(targetChance)}</strong></div>
  `;
}

function showTooltip(event, row, targetChance) {
  tooltip.innerHTML = tooltipHtml(row, targetChance);
  tooltip.style.display = 'block';
  moveTooltip(event);
}

function showTooltipForElement(element, row, targetChance) {
  const rect = element.getBoundingClientRect();
  tooltip.innerHTML = tooltipHtml(row, targetChance);
  tooltip.style.display = 'block';
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.top}px`;
}

function moveTooltip(event) {
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;
}

function hideTooltip() {
  tooltip.style.display = 'none';
}

function wireHoverSync() {
  document.addEventListener('pointerover', (event) => {
    const cell = event.target.closest?.('#gridView .cell');
    const row = event.target.closest?.('#sideTable tbody tr');
    const rolls = cell?.dataset.rolls ?? row?.dataset.rolls;
    if (!rolls) return;
    document.querySelector(`#gridView .cell[data-rolls="${rolls}"]`)?.classList.add('highlighted');
    document.querySelector(`#sideTable tbody tr[data-rolls="${rolls}"]`)?.classList.add('row-highlighted');
  });

  document.addEventListener('pointerout', (event) => {
    const cell = event.target.closest?.('#gridView .cell');
    const row = event.target.closest?.('#sideTable tbody tr');
    const rolls = cell?.dataset.rolls ?? row?.dataset.rolls;
    if (!rolls) return;
    document.querySelector(`#gridView .cell[data-rolls="${rolls}"]`)?.classList.remove('highlighted');
    document.querySelector(`#sideTable tbody tr[data-rolls="${rolls}"]`)?.classList.remove('row-highlighted');
  });
}

function persistState() {
  try { localStorage.setItem('gachaPlannerV2', JSON.stringify(STATE.planner)); } catch { /* optional */ }
}

function restoreState() {
  try {
    const savedBanner = localStorage.getItem('lastBanner');
    if (savedBanner && BANNERS[savedBanner]) STATE.active = savedBanner;

    const savedPlanner = JSON.parse(localStorage.getItem('gachaPlannerV2') || 'null');
    if (savedPlanner?.characters) Object.assign(STATE.planner.characters, savedPlanner.characters);
    if (savedPlanner?.weapons) Object.assign(STATE.planner.weapons, savedPlanner.weapons);
  } catch { /* invalid storage is ignored */ }
}

function init() {
  restoreState();
  wireHoverSync();

  el('tab-characters').addEventListener('click', () => switchTab('characters'));
  el('tab-weapons').addEventListener('click', () => switchTab('weapons'));

  [currentPityEl, futurePullsEl, characterGuaranteeEl, weaponFatePointEl, weaponGuaranteeEl]
    .forEach((control) => {
      control.addEventListener('input', updatePlannerResults);
      control.addEventListener('change', updatePlannerResults);
    });

  document.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (event.key === '1') switchTab('characters');
    if (event.key === '2') switchTab('weapons');
  });

  window.addEventListener('scroll', hideTooltip, { passive: true });
  window.addEventListener('resize', hideTooltip, { passive: true });
  render();
}

init();
