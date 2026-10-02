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
  mode: 'simple',
  selectedPity: {
    characters: BANNERS.characters.softPityStart,
    weapons: BANNERS.weapons.softPityStart,
  },
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
const heatZonesEl = el('heatZones');
const heatPersonalHintEl = el('heatPersonalHint');
const mobilePityCardEl = el('mobilePityCard');
const sideBody = document.querySelector('#sideTable tbody');
const tooltip = el('tooltip');
const statsEl = el('bannerStats');
const tableExampleEl = el('tableExample');
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
const modeSimpleEl = el('mode-simple');
const modeDetailedEl = el('mode-detailed');

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

function fmtPctCompact(probability) {
  const percent = probability * 100;
  if (percent >= 99.5) return '100%';
  if (percent < 1) return `${percent.toFixed(1).replace('.', ',')}%`;
  if (percent < 10) return `${percent.toFixed(1).replace('.', ',')}%`;
  return `${Math.round(percent)}%`;
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

function zoneName(cfg, pity) {
  if (pity >= cfg.hardPity) return 'hard';
  if (pity >= cfg.softPityStart) return 'soft';
  return 'normal';
}

function zoneTitle(cfg, pity) {
  const zone = zoneName(cfg, pity);
  if (zone === 'hard') return 'Жёсткий гарант';
  if (zone === 'soft') return 'Софт-гарант';
  return 'Обычный шанс';
}

function metricsForRow(type, row, freshTargetSeries) {
  const currentPity = STATE.planner[type].pity;
  if (currentPity <= 0) {
    return {
      personal: false,
      passed: false,
      current: false,
      future: true,
      delta: row.pity,
      anyChance: row.cumulative,
      targetChance: freshTargetSeries[row.pity - 1] ?? 0,
    };
  }

  if (row.pity < currentPity) {
    return {
      personal: true,
      passed: true,
      current: false,
      future: false,
      delta: 0,
      anyChance: 0,
      targetChance: 0,
    };
  }

  if (row.pity === currentPity) {
    return {
      personal: true,
      passed: false,
      current: true,
      future: false,
      delta: 0,
      anyChance: 0,
      targetChance: 0,
    };
  }

  const delta = row.pity - currentPity;
  return {
    personal: true,
    passed: false,
    current: false,
    future: true,
    delta,
    anyChance: anyFiveStarChanceWithin(type, delta, { startingPity: currentPity }),
    targetChance: targetChanceWithin(type, delta, plannerOptions(type)),
  };
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
    ? `по модели максимум достигается примерно к ${cfg.empiricalHardPity}-й крутке`
    : `по модели шанс растёт вплоть до ${cfg.hardPity}-й крутки`;

  statsEl.innerHTML = `
    <div class="stat"><span>Базовый шанс 5★</span><strong>${fmtPct(cfg.baseRate, 1)}</strong></div>
    <div class="stat"><span>Софт-гарант начинается</span><strong>с ${cfg.softPityStart}-й</strong></div>
    <div class="stat"><span>Жёсткий гарант</span><strong>${cfg.hardPity}-я крутка</strong></div>
    <div class="stat"><span>Среднее до 5★ по модели</span><strong>${fmtNumber(stats.expectedPity, 2)} крут.</strong></div>
    <div class="stat"><span>Средний шанс по модели</span><strong>${fmtPct(stats.modelConsolidatedRate, 3)}</strong></div>
    <div class="stat"><span>Официальный средний шанс</span><strong>${fmtPct(cfg.officialConsolidatedRate, 2)}</strong></div>
    <div class="stat"><span>Шанс 50% / 95%</span><strong>к ${stats.medianPity}-й / ${stats.p95Pity}-й</strong></div>
    <div class="stat"><span>Примечание</span><strong title="Точная формула софт-гаранта не опубликована HoYoverse">${empiricalNote}</strong></div>
  `;
}

function renderZoneLegend(type) {
  const cfg = BANNERS[type];
  const normalEnd = cfg.softPityStart - 1;
  const softEnd = cfg.hardPity - 1;
  heatZonesEl.innerHTML = `
    <span class="zone-chip normal">1–${normalEnd}: обычный шанс</span>
    <span class="zone-chip soft">${cfg.softPityStart}–${softEnd}: софт-гарант</span>
    <span class="zone-chip hard">${cfg.hardPity}: жёсткий гарант</span>
  `;
}

function renderTableExample(type, data, freshTargetSeries) {
  const cfg = BANNERS[type];
  const currentPity = STATE.planner[type].pity;

  if (currentPity > 0) {
    tableExampleEl.innerHTML = `
      <b>Сейчас у тебя ${currentPity} круток без 5★.</b>
      Пройденные строки приглушены, а значения «до №» для будущих круток считаются
      <b>от твоего текущего счётчика</b>, а не с нуля.
    `;
    return;
  }

  const exampleIndex = cfg.softPityStart - 1;
  const exampleRow = data[exampleIndex];
  const targetName = type === 'characters' ? 'нужного баннерного персонажа' : 'нужное выбранное оружие';
  tableExampleEl.innerHTML = `
    <b>Пример на ${cfg.softPityStart}-й крутке:</b>
    если ты дошёл до неё без 5★, шанс выбить 5★ <b>именно сейчас — ${fmtPct(exampleRow.hazard)}</b>.
    Но шанс, что <b>любой 5★ уже выпадет к этому моменту — ${fmtPct(exampleRow.cumulative)}</b>.
    А шанс уже получить <b>${targetName} — ${fmtPct(freshTargetSeries[exampleIndex])}</b>.
    Поэтому эти три процента отличаются.
  `;
}

function renderMobilePityCard(type, data, freshTargetSeries) {
  const cfg = BANNERS[type];
  const currentPity = STATE.planner[type].pity;
  let selected = clamp(
    Number(STATE.selectedPity[type]) || cfg.softPityStart,
    1,
    cfg.hardPity,
  );

  if (currentPity > 0 && selected <= currentPity) {
    selected = Math.min(cfg.hardPity, currentPity + 1);
    STATE.selectedPity[type] = selected;
  }

  const row = data[selected - 1];
  const metrics = metricsForRow(type, row, freshTargetSeries);
  const anyText = metrics.current ? '—' : fmtPct(metrics.anyChance);
  const targetText = metrics.current ? '—' : fmtPct(metrics.targetChance);
  const contextText = metrics.personal
    ? `от твоего текущего pity ${currentPity}`
    : 'с начала нового pity-цикла';

  mobilePityCardEl.innerHTML = `
    <div class="mobile-title">Крутка №${selected} · ${zoneTitle(cfg, selected)}</div>
    <div class="mobile-pity-grid">
      <div class="mobile-pity-stat"><span>5★ именно сейчас</span><strong>${fmtPct(row.hazard)}</strong></div>
      <div class="mobile-pity-stat"><span>Любой 5★ до №</span><strong>${anyText}</strong></div>
      <div class="mobile-pity-stat"><span>Нужная цель до №</span><strong>${targetText}</strong></div>
      <div class="mobile-pity-stat"><span>Расчёт</span><strong>${contextText}</strong></div>
    </div>
    <div class="small" style="margin-top:8px;">Тапни другую клетку Heat Map, чтобы посмотреть её.</div>
  `;
}

function selectPity(type, pity, data, freshTargetSeries) {
  STATE.selectedPity[type] = pity;
  document.querySelectorAll('#gridView .cell.selected-pity').forEach((node) => {
    node.classList.remove('selected-pity');
  });
  document.querySelector(`#gridView .cell[data-rolls="${pity}"]`)?.classList.add('selected-pity');
  renderMobilePityCard(type, data, freshTargetSeries);
}

function tooltipHtml(type, row, metrics) {
  const currentPity = STATE.planner[type].pity;

  if (metrics.personal && metrics.passed) {
    return `
      <div>Крутка: <strong>${row.pity}</strong></div>
      <div><strong>Уже пройдена</strong> при твоём текущем pity ${currentPity}.</div>
      <div>Шанс 5★ на этой крутке: <strong>${fmtPct(row.hazard)}</strong></div>
    `;
  }

  if (metrics.personal && metrics.current) {
    return `
      <div>Твой текущий счётчик: <strong>${row.pity}</strong></div>
      <div>Следующая крутка будет <strong>№${Math.min(BANNERS[type].hardPity, row.pity + 1)}</strong>.</div>
    `;
  }

  const scope = metrics.personal
    ? `за следующие ${metrics.delta} крут.`
    : `с 1-й до ${row.pity}-й`;

  return `
    <div>Крутка: <strong>${row.pity}</strong> · ${zoneTitle(BANNERS[type], row.pity)}</div>
    <div>5★ именно на этой: <strong>${fmtPct(row.hazard)}</strong></div>
    <div>Любой 5★ ${scope}: <strong>${fmtPct(metrics.anyChance)}</strong></div>
    <div>Нужная цель ${scope}: <strong>${fmtPct(metrics.targetChance)}</strong></div>
  `;
}

function renderHeatmap(type, { animate = true } = {}) {
  const cfg = BANNERS[type];
  const currentPity = STATE.planner[type].pity;
  const data = firstFiveStarDistribution(type);
  const freshTargetSeries = targetChanceSeries(type, cfg.hardPity, freshTargetOptions(type));

  titleEl.textContent = `${cfg.label} — тепловая карта (Heat Map)`;
  descEl.textContent = currentPity > 0
    ? 'Белая рамка показывает твой текущий счётчик. Прошлые крутки приглушены, будущие проценты считаются от твоего pity.'
    : 'Зоны показывают обычный шанс, софт-гарант и жёсткий гарант. Введи свой pity в калькуляторе — карта станет персональной.';
  rangeEl.textContent = `1 — ${cfg.hardPity}`;
  renderZoneLegend(type);

  heatPersonalHintEl.textContent = currentPity > 0
    ? `Твой pity: ${currentPity}. Маленький процент в будущей клетке = шанс получить любой 5★ от текущего pity до этой крутки.`
    : 'Сейчас показан новый pity-цикл с нуля.';

  if (animate) gridEl.classList.remove('visible');
  clearChildren(gridEl);
  clearChildren(sideBody);

  renderTableExample(type, data, freshTargetSeries);

  data.forEach((row) => {
    const zone = zoneName(cfg, row.pity);
    const metrics = metricsForRow(type, row, freshTargetSeries);

    const cell = document.createElement('div');
    cell.className = `cell zone-${zone}`;
    if (metrics.passed) cell.classList.add('past-pity');
    if (metrics.current) cell.classList.add('current-pity');
    if (metrics.future && currentPity > 0) cell.classList.add('future-pity');
    if (STATE.selectedPity[type] === row.pity) cell.classList.add('selected-pity');

    cell.dataset.rolls = String(row.pity);
    cell.style.background = getColorForPercent((row.pity / cfg.hardPity) * 100);
    cell.innerHTML = `
      <span class="cell-number">${row.pity}</span>
      ${currentPity > 0 && metrics.future ? `<span class="cell-chance">${fmtPctCompact(metrics.anyChance)}</span>` : ''}
    `;
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute(
      'aria-label',
      metrics.future
        ? `${row.pity}-я крутка: шанс 5★ сейчас ${fmtPct(row.hazard)}, накопленный шанс от твоего pity ${fmtPct(metrics.anyChance)}`
        : `${row.pity}-я крутка: ${metrics.current ? 'текущий счётчик' : zoneTitle(cfg, row.pity)}`,
    );

    const show = (event) => {
      tooltip.innerHTML = tooltipHtml(type, row, metrics);
      tooltip.style.display = 'block';
      if (event) moveTooltip(event);
    };

    cell.addEventListener('pointerenter', show);
    cell.addEventListener('pointermove', moveTooltip);
    cell.addEventListener('pointerleave', hideTooltip);
    cell.addEventListener('focus', () => showTooltipForElement(cell, type, row, metrics));
    cell.addEventListener('blur', hideTooltip);
    cell.addEventListener('click', () => selectPity(type, row.pity, data, freshTargetSeries));
    cell.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectPity(type, row.pity, data, freshTargetSeries);
    });
    gridEl.appendChild(cell);

    const tr = document.createElement('tr');
    tr.dataset.rolls = String(row.pity);
    if (metrics.passed) tr.classList.add('past-row');
    if (metrics.current) tr.classList.add('current-row');

    const cumulativeText = metrics.current || metrics.passed ? '—' : fmtPct(metrics.anyChance);
    const targetText = metrics.current || metrics.passed ? '—' : fmtPct(metrics.targetChance);
    tr.innerHTML = `
      <td>${row.pity}</td>
      <td>${fmtPct(row.hazard)}</td>
      <td>${cumulativeText}</td>
      <td>${targetText}</td>
    `;
    tr.addEventListener('click', () => selectPity(type, row.pity, data, freshTargetSeries));
    sideBody.appendChild(tr);
  });

  renderMobilePityCard(type, data, freshTargetSeries);

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

  updatePlannerResults({ refreshHeatmap: false });
}

function updatePlannerResults({ refreshHeatmap = true } = {}) {
  const type = STATE.active;
  const cfg = BANNERS[type];
  const p = STATE.planner[type];
  const oldPity = p.pity;

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

  if (oldPity !== p.pity) {
    STATE.selectedPity[type] = p.pity > 0
      ? Math.min(cfg.hardPity, p.pity + 1)
      : cfg.softPityStart;
  }

  const options = plannerOptions(type);
  const anyChance = anyFiveStarChanceWithin(type, p.pulls, options);
  const targetChance = targetChanceWithin(type, p.pulls, options);
  const worst = worstCaseTargetPulls(type, options);
  const primogems = p.pulls * 160;

  plannerAnyEl.textContent = fmtPct(anyChance);
  plannerTargetEl.textContent = fmtPct(targetChance);
  plannerWorstEl.textContent = `${worst} крут.`;
  plannerPrimogemsEl.textContent = `${primogems.toLocaleString('ru-RU')} Камней • ${p.pulls.toLocaleString('ru-RU')} молитв`;

  persistState();
  if (refreshHeatmap) renderHeatmap(type, { animate: false });
}

function applyMode() {
  const simple = STATE.mode === 'simple';
  document.body.classList.toggle('simple-mode', simple);
  modeSimpleEl.classList.toggle('active', simple);
  modeDetailedEl.classList.toggle('active', !simple);
  modeSimpleEl.setAttribute('aria-pressed', String(simple));
  modeDetailedEl.setAttribute('aria-pressed', String(!simple));
}

function setMode(mode) {
  if (mode !== 'simple' && mode !== 'detailed') return;
  STATE.mode = mode;
  applyMode();
  try { localStorage.setItem('gachaViewMode', mode); } catch { /* optional */ }
}

function render() {
  const type = STATE.active;
  document.querySelectorAll('.tab-btn').forEach((button) => {
    const active = button.id === `tab-${type}`;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  renderStats(type);
  renderPlanner(type);
  renderHeatmap(type);
  applyMode();

  try { localStorage.setItem('lastBanner', type); } catch { /* storage optional */ }
}

function switchTab(type) {
  if (!BANNERS[type] || type === STATE.active) return;
  STATE.active = type;
  hideTooltip();
  render();
}

function showTooltipForElement(element, type, row, metrics) {
  const rect = element.getBoundingClientRect();
  tooltip.innerHTML = tooltipHtml(type, row, metrics);
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
  try {
    localStorage.setItem('gachaPlannerV2', JSON.stringify(STATE.planner));
    localStorage.setItem('gachaSelectedPityV3', JSON.stringify(STATE.selectedPity));
  } catch { /* optional */ }
}

function restoreState() {
  try {
    const savedBanner = localStorage.getItem('lastBanner');
    if (savedBanner && BANNERS[savedBanner]) STATE.active = savedBanner;

    const savedMode = localStorage.getItem('gachaViewMode');
    if (savedMode === 'simple' || savedMode === 'detailed') STATE.mode = savedMode;

    const savedPlanner = JSON.parse(localStorage.getItem('gachaPlannerV2') || 'null');
    if (savedPlanner?.characters) Object.assign(STATE.planner.characters, savedPlanner.characters);
    if (savedPlanner?.weapons) Object.assign(STATE.planner.weapons, savedPlanner.weapons);

    const selected = JSON.parse(localStorage.getItem('gachaSelectedPityV3') || 'null');
    if (selected?.characters) STATE.selectedPity.characters = Number(selected.characters);
    if (selected?.weapons) STATE.selectedPity.weapons = Number(selected.weapons);
  } catch { /* invalid storage is ignored */ }
}

function init() {
  restoreState();
  wireHoverSync();

  el('tab-characters').addEventListener('click', () => switchTab('characters'));
  el('tab-weapons').addEventListener('click', () => switchTab('weapons'));
  modeSimpleEl.addEventListener('click', () => setMode('simple'));
  modeDetailedEl.addEventListener('click', () => setMode('detailed'));

  [currentPityEl, futurePullsEl, characterGuaranteeEl, weaponFatePointEl, weaponGuaranteeEl]
    .forEach((control) => {
      control.addEventListener('input', () => updatePlannerResults());
      control.addEventListener('change', () => updatePlannerResults());
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
