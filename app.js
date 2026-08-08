let datasets = [];

// ---------- Supabase / Storage Sync Module ----------
const DEFAULT_SUPABASE_URL = 'https://gxbpsbqpuaudtlfliezs.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_HgFswhUnZWkHwtVyXTxt2g_h371PL5z';

const LOCAL_STORAGE_KEY = 'readings_tracker_datasets';
let supabaseClient = null;
let currentUser = null;
let saveDebounceTimer = null;

function initSupabase() {
  const url = window.SUPABASE_URL || DEFAULT_SUPABASE_URL || localStorage.getItem('VITE_SUPABASE_URL') || '';
  const key = window.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY || localStorage.getItem('VITE_SUPABASE_ANON_KEY') || '';
  
  if (url && key && window.supabase) {
    try {
      supabaseClient = window.supabase.createClient(url, key);
      setupAuthListeners();
    } catch (e) {
      console.warn('Supabase init error:', e);
    }
  } else {
    updateAuthUI();
  }
}

function setupAuthListeners() {
  if (!supabaseClient) return;

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user || null;
    updateAuthUI();

    if (currentUser) {
      await loadFromSupabase();
    } else {
      loadFromLocalStorage();
    }
  });
}

function updateAuthUI() {
  const badge = document.getElementById('authBadge');
  const label = document.getElementById('userLabel');
  const btn = document.getElementById('authBtn');

  if (!badge || !btn || !label) return;

  if (currentUser) {
    badge.textContent = 'Cloud Mode';
    badge.className = 'auth-badge cloud';
    label.textContent = currentUser.email || 'Logged in';
    btn.textContent = 'Sign Out';
    btn.onclick = handleSignOut;
  } else {
    badge.textContent = 'Guest Mode';
    badge.className = 'auth-badge guest';
    label.textContent = 'Offline / LocalStorage';
    btn.textContent = 'Sign in with Google';
    btn.onclick = handleGoogleSignIn;
  }
}

async function handleGoogleSignIn() {
  if (!supabaseClient) {
    promptSupabaseConfig();
    return;
  }
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) alert('Login error: ' + error.message);
}

async function handleSignOut() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
}

function promptSupabaseConfig() {
  const url = prompt('Enter your Supabase URL:');
  const key = prompt('Enter your Supabase Anon Key:');
  if (url && key) {
    localStorage.setItem('VITE_SUPABASE_URL', url.trim());
    localStorage.setItem('VITE_SUPABASE_ANON_KEY', key.trim());
    initSupabase();
  }
}

function persistState() {
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    const serializable = datasets.map(d => ({
      name: d.name,
      entries: d.entries,
      collapsed: d.collapsed
    }));
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serializable));

    if (supabaseClient && currentUser) {
      syncToSupabase(serializable);
    }
  }, 300);
}

async function syncToSupabase(serializableData) {
  if (!supabaseClient || !currentUser) return;
  try {
    const { error } = await supabaseClient
      .from('user_readings')
      .upsert({
        user_id: currentUser.id,
        data_key: 'readings_data',
        payload: serializableData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id, data_key' });

    if (error) console.error('Cloud sync error:', error.message);
  } catch (e) {
    console.error('Cloud sync exception:', e);
  }
}

async function loadFromSupabase() {
  if (!supabaseClient || !currentUser) return;
  try {
    const { data, error } = await supabaseClient
      .from('user_readings')
      .select('payload')
      .eq('user_id', currentUser.id)
      .eq('data_key', 'readings_data')
      .maybeSingle();

    if (error) {
      console.error('Error loading cloud data:', error.message);
      return;
    }

    if (data && Array.isArray(data.payload)) {
      datasets = data.payload.map(d => ({
        name: d.name,
        entries: d.entries || [],
        chart: null,
        barCharts: {},
        collapsed: !!d.collapsed
      }));
      renderDatasets(false);
    }
  } catch (e) {
    console.error('Exception loading cloud data:', e);
  }
}

function loadFromLocalStorage() {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        datasets = parsed.map(d => ({
          name: d.name,
          entries: d.entries || [],
          chart: null,
          barCharts: {},
          collapsed: !!d.collapsed
        }));
        renderDatasets(false);
      }
    } catch (e) {
      console.error('Error parsing local state:', e);
    }
  }
}

// ---------- CRUD / UI ----------


function addDataset() {
  const input = document.getElementById('newCategory');
  const name = (input.value || '').trim();
  if (!name) return;

  datasets.push({ name, entries: [], chart: null, barCharts: {}, collapsed: false });
  input.value = '';
  renderDatasets();
}

function toggleCollapse(i) {
  datasets[i].collapsed = !datasets[i].collapsed;
  renderDatasets();
}

function addEntry(i) {
  const today = new Date().toISOString().slice(0, 10);
  datasets[i].entries.push({ date: today, value: 0 });
  renderDatasets();
}

function updateEntry(i, j, field, value) {
  datasets[i].entries[j][field] = field === 'value' ? Number(value) : value;
  renderDatasets();
}

function deleteEntry(i, j) {
  datasets[i].entries.splice(j, 1);
  renderDatasets();
}

function moveEntry(i, j, dir) {
  const arr = datasets[i].entries;
  if (dir === -1 && j > 0) [arr[j - 1], arr[j]] = [arr[j], arr[j - 1]];
  if (dir === 1 && j < arr.length - 1) [arr[j + 1], arr[j]] = [arr[j], arr[j + 1]];
  renderDatasets();
}

function exportCSV(i) {
  const rows = [['category', 'date', 'value'], ...datasets[i].entries.map(e => [datasets[i].name, e.date, e.value])];
  const csv = rows.map(r => r.join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${datasets[i].name}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function importCSV(event, i) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = e.target.result.split(/\r?\n/).filter(Boolean).slice(1);
    const entries = lines
      .map(line => {
        const [category, date, value] = line.split(',');
        return { date: (date || '').trim(), value: Number(value) };
      })
      .filter(r => r.date);

    datasets[i].entries = entries;
    datasets[i].collapsed = true;
    renderDatasets();
    event.target.value = '';
  };
  reader.readAsText(file);
}

function downloadChartImage(chartInstance, filename) {
  if (!chartInstance) return;
  const url = chartInstance.toBase64Image();
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportLineChart(i) {
  const chart = datasets[i].chart;
  downloadChartImage(chart, `${datasets[i].name}-line.png`);
}

// ---------- Date helpers (UTC) ----------

function toUTCDate(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function yyyymm(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function fmtYMD(y, m1, d) {
  const mm = String(m1).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function daysBetweenUTC(a, b) {
  return (b.getTime() - a.getTime()) / 86400000;
}

function daysInMonthUTC(year, monthIndex0) {
  const start = new Date(Date.UTC(year, monthIndex0, 1));
  const next = new Date(Date.UTC(year, monthIndex0 + 1, 1));
  return Math.round(daysBetweenUTC(start, next));
}

// allocate `amount` proportionally to days in each month that intersects [start, end)
function allocateByMonth(startUTC, endUTC, amount, outMonthTotals) {
  const totalDays = daysBetweenUTC(startUTC, endUTC);
  if (!(totalDays > 0)) return;

  let cursor = new Date(startUTC.getTime());

  while (cursor < endUTC) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();

    const monthStart = new Date(Date.UTC(y, m, 1));
    const nextMonthStart = new Date(Date.UTC(y, m + 1, 1));

    const segStart = cursor > monthStart ? cursor : monthStart;
    const segEnd = endUTC < nextMonthStart ? endUTC : nextMonthStart;

    const segDays = daysBetweenUTC(segStart, segEnd);
    if (segDays > 0) {
      const key = yyyymm(segStart);
      outMonthTotals[key] = (outMonthTotals[key] || 0) + amount * (segDays / totalDays);
    }

    cursor = nextMonthStart;
  }
}

// ---------- Forecast for "active month" (month of last reading) ----------

function interpolateValueAt(targetDateUTC, leftEntry, rightEntry) {
  const a = toUTCDate(leftEntry.date);
  const b = toUTCDate(rightEntry.date);
  const t = targetDateUTC;

  const totalDays = daysBetweenUTC(a, b);
  const leftDays = daysBetweenUTC(a, t);
  if (!(totalDays > 0) || leftDays < 0) return leftEntry.value;

  const rate = (rightEntry.value - leftEntry.value) / totalDays;
  return leftEntry.value + rate * leftDays;
}

// returns null if not enough info
function getActiveMonthForecast(sorted) {
  if (!sorted?.length) return null;

  const last = sorted[sorted.length - 1];
  const lastUTC = toUTCDate(last.date);

  const activeYear = lastUTC.getUTCFullYear();
  const activeMonthIdx = lastUTC.getUTCMonth(); // 0..11
  const activeMonth = String(activeMonthIdx + 1).padStart(2, '0');

  const monthStartUTC = new Date(Date.UTC(activeYear, activeMonthIdx, 1));
  const nextMonthStartUTC = new Date(Date.UTC(activeYear, activeMonthIdx + 1, 1));
  const monthDays = Math.round(daysBetweenUTC(monthStartUTC, nextMonthStartUTC));

  // inclusive days elapsed like "5 days = ..."
  const elapsedDays = Math.max(1, Math.floor(daysBetweenUTC(monthStartUTC, lastUTC) + 1));

  // need value at month start
  const monthStartStr = fmtYMD(activeYear, activeMonthIdx + 1, 1);
  const direct = sorted.find(e => e.date === monthStartStr);
  let valueAtMonthStart = null;

  if (direct) {
    valueAtMonthStart = Number(direct.value);
  } else {
    // find pair prev < monthStart < next to interpolate
    let prev = null;
    let next = null;

    for (let i = 0; i < sorted.length; i++) {
      const d = toUTCDate(sorted[i].date);
      if (d < monthStartUTC) prev = sorted[i];
      if (d > monthStartUTC) { next = sorted[i]; break; }
      if (d.getTime() === monthStartUTC.getTime()) { next = sorted[i]; break; }
    }

    if (prev && next && toUTCDate(prev.date) < monthStartUTC && toUTCDate(next.date) > monthStartUTC) {
      valueAtMonthStart = interpolateValueAt(monthStartUTC, prev, next);
    }
  }

  if (valueAtMonthStart === null || !isFinite(valueAtMonthStart)) return null;

  const consumedSoFar = Number(last.value) - Number(valueAtMonthStart);
  if (!isFinite(consumedSoFar) || consumedSoFar <= 0) return null;

  const predictedMonth = (consumedSoFar / elapsedDays) * monthDays;

  // end-of-month date string for line chart
  const monthEndUTC = new Date(Date.UTC(activeYear, activeMonthIdx + 1, 0)); // last day of month
  const monthEndStr = fmtYMD(activeYear, activeMonthIdx + 1, monthEndUTC.getUTCDate());

  // if already at last day, no forecast line needed
  if (lastUTC.getTime() >= monthEndUTC.getTime()) return null;

  return {
    activeYear: String(activeYear),
    activeMonthIdx,
    activeMonth,
    monthStartStr,
    monthEndStr,
    monthDays,
    elapsedDays,
    valueAtMonthStart,
    lastDateStr: last.date,
    lastValue: Number(last.value),
    predictedMonth,
    predictedEndValue: Number(valueAtMonthStart) + predictedMonth
  };
}

// ---------- Same-level projection helpers ----------

function mmddFromRefDate(d) {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

// points: [{x:'2000-MM-DD', y:number}, ...], sorted by x asc
function findDateAtLevel(points, targetY) {
  if (!points?.length || !isFinite(targetY)) return null;

  let maxY = -Infinity;
  for (const p of points) {
    const yy = Number(p.y);
    if (isFinite(yy)) maxY = Math.max(maxY, yy);
  }
  if (!(maxY >= targetY)) return null;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const ya = Number(a.y);
    const yb = Number(b.y);
    if (!isFinite(ya) || !isFinite(yb)) continue;

    if (ya === targetY) return new Date(a.x);
    if (yb === targetY) return new Date(b.x);

    const crosses = (ya < targetY && yb > targetY) || (ya > targetY && yb < targetY);
    if (!crosses) continue;

    const denom = (yb - ya);
    if (denom === 0) continue;

    const t = (targetY - ya) / denom; // 0..1
    const ax = new Date(a.x).getTime();
    const bx = new Date(b.x).getTime();
    const x = ax + t * (bx - ax);
    return new Date(x);
  }

  return null;
}

// ---------- Line chart: synthetic 12-31 only for "closed" years ----------

function addSyntheticDec31ForClosedYears(yearGroups, yearsSortedAsc) {
  for (let idx = 0; idx < yearsSortedAsc.length - 1; idx++) {
    const year = yearsSortedAsc[idx];
    const nextYear = yearsSortedAsc[idx + 1];

    const list = yearGroups[year];
    const nextList = yearGroups[nextYear];
    if (!list?.length || !nextList?.length) continue;

    const hasDec31 = list.some(e => String(e.date).endsWith('-12-31'));
    if (hasDec31) continue;

    const lastThis = list[list.length - 1];
    const firstNext = nextList[0];

    const dec31UTC = new Date(Date.UTC(Number(year), 11, 31));
    const lastThisUTC = toUTCDate(lastThis.date);
    const firstNextUTC = toUTCDate(firstNext.date);

    // only "closed year": lastThis < 12-31 < firstNext
    if (lastThisUTC < dec31UTC && firstNextUTC > dec31UTC) {
      const syntheticValue = interpolateValueAt(dec31UTC, lastThis, firstNext);
      yearGroups[year] = [...list, { date: `${year}-12-31`, value: syntheticValue }]
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    }
  }
}

// ---------- Charts ----------

function drawChart(i) {
  const canvas = document.getElementById(`chart-${i}`);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (datasets[i].chart) datasets[i].chart.destroy();

  const sorted = [...datasets[i].entries]
    .filter(e => e.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (!sorted.length) return;

  const forecast = getActiveMonthForecast(sorted);

  const yearColors = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
    '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
    '#16a085', '#c0392b', '#2980b9', '#8e44ad'
  ];

  // group by year
  const yearGroups = {};
  sorted.forEach(e => {
    const year = String(e.date).slice(0, 4);
    if (!yearGroups[year]) yearGroups[year] = [];
    yearGroups[year].push(e);
  });

  const years = Object.keys(yearGroups).sort(); // asc

  // add 12-31 only for closed years
  addSyntheticDec31ForClosedYears(yearGroups, years);

  const chartDatasets = [];
  const yearBaselines = {};
  const yearPointsMap = {}; // year -> baseline-applied points
  const REFERENCE_YEAR = 2000;

  // clear comparisons for stats
  datasets[i]._comparisons = null;

  years.forEach((year, yearIndex) => {
    let baseline = 0;

    if (yearIndex === 0) {
      baseline = yearGroups[year][0].value;
    } else {
      const prevYear = years[yearIndex - 1];
      const prevYearEntries = yearGroups[prevYear];
      const lastPrevEntry = prevYearEntries[prevYearEntries.length - 1];
      const firstCurrEntry = yearGroups[year][0];

      const lastPrevDate = toUTCDate(lastPrevEntry.date);
      const firstCurrDate = toUTCDate(firstCurrEntry.date);
      const jan1 = toUTCDate(`${year}-01-01`);

      const totalDays = daysBetweenUTC(lastPrevDate, firstCurrDate);
      const daysToJan1 = daysBetweenUTC(lastPrevDate, jan1);

      if (totalDays > 0 && daysToJan1 >= 0) {
        const rate = (firstCurrEntry.value - lastPrevEntry.value) / totalDays;
        baseline = lastPrevEntry.value + (rate * daysToJan1);
      } else {
        baseline = firstCurrEntry.value;
      }
    }

    yearBaselines[year] = baseline;

    const points = yearGroups[year].map(e => {
      const monthDay = String(e.date).slice(5); // MM-DD
      return { x: `${REFERENCE_YEAR}-${monthDay}`, y: e.value - baseline };
    });

    points.unshift({ x: `${REFERENCE_YEAR}-01-01`, y: 0 });
    yearPointsMap[year] = points;

    // main year dataset
    chartDatasets.push({
      label: year,
      data: points,
      borderColor: yearColors[yearIndex % yearColors.length],
      backgroundColor: yearColors[yearIndex % yearColors.length],
      fill: false,
      tension: 0.15,
      pointRadius: 3,
      borderWidth: 2,
      spanGaps: false
    });

    // forecast dashed dataset only for active year
    if (forecast && year === forecast.activeYear) {
      const x0 = `${REFERENCE_YEAR}-${String(forecast.lastDateStr).slice(5)}`;
      const x1 = `${REFERENCE_YEAR}-${String(forecast.monthEndStr).slice(5)}`;

      const y0 = forecast.lastValue - baseline;
      const y1 = forecast.predictedEndValue - baseline;

      const c = yearColors[yearIndex % yearColors.length];
      const cSoft = `${c}99`;

      chartDatasets.push({
        label: `${year} (forecast)`,
        data: [
          { x: x0, y: y0 },
          { x: x1, y: y1 }
        ],
        borderColor: cSoft,
        backgroundColor: cSoft,
        borderDash: [6, 6],
        fill: false,
        tension: 0.0,
        pointRadius: (ctx) => (ctx.dataIndex === 1 ? 4 : 0),
        pointHoverRadius: (ctx) => (ctx.dataIndex === 1 ? 8 : 0),
        pointHitRadius: (ctx) => (ctx.dataIndex === 1 ? 14 : 0),
        borderWidth: 2,
        spanGaps: false
      });
    }
  });

  // ---- Same-level projection to other years (based on last reading) ----
  const last = sorted[sorted.length - 1];
  const currentYear = String(last.date).slice(0, 4);

  if (yearPointsMap[currentYear] && isFinite(yearBaselines[currentYear])) {
    const currY = Number(last.value) - Number(yearBaselines[currentYear]);
    const currX = `${REFERENCE_YEAR}-${String(last.date).slice(5)}`;

    const comparisons = [];

    years.forEach((y) => {
      if (y === currentYear) return;

      const pts = yearPointsMap[y];
      if (!pts?.length) return;

      const matchDate = findDateAtLevel(pts, currY);
      if (!matchDate) return;

      const matchMMDD = mmddFromRefDate(matchDate);
      const matchX = `${REFERENCE_YEAR}-${matchMMDD}`;

      const idx = years.indexOf(y);
      const color = yearColors[(idx >= 0 ? idx : 0) % yearColors.length];
      const soft = `${color}77`;

      // dashed connector at same Y from "now" to that year's date
      chartDatasets.push({
        label: `${y} (same level)`,
        data: [{ x: currX, y: currY }, { x: matchX, y: currY }],
        borderColor: soft,
        backgroundColor: soft,
        borderDash: [4, 4],
        borderWidth: 1,
        pointRadius: 0,
        tension: 0,
        fill: false
      });

      // marker point at the match
      chartDatasets.push({
        type: 'scatter',
        label: `${y} (match)`,
        data: [{ x: matchX, y: currY }],
        pointRadius: 4,
        pointHoverRadius: 8,
        pointHitRadius: 14,
        backgroundColor: color,
        borderColor: color
      });

      comparisons.push({ year: y, mmdd: matchMMDD });
    });

    if (comparisons.length) {
      datasets[i]._comparisons = {
        currentDate: last.date,
        items: comparisons
      };
    }
  }

  const xMin = new Date(`${REFERENCE_YEAR}-01-01`);
  const xMax = new Date(`${REFERENCE_YEAR}-12-31`);

  datasets[i].chart = new Chart(ctx, {
    type: 'line',
    data: { datasets: chartDatasets },
    options: {
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      },
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: { unit: 'month', displayFormats: { month: 'MMM' } },
          min: xMin,
          max: xMax,
          grid: { color: '#2b2b2b' },
          title: { display: true, text: 'Month', color: '#ddd' }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#2b2b2b' },
          title: { display: true, text: 'Relative Consumption', color: '#ddd' }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#ddd',
            font: { size: 12 },
            filter: (legendItem) => {
              const t = legendItem.text || '';
              if (t.includes('(same level)')) return false;
              if (t.includes('(match)')) return false;
              return true;
            }
          },
          display: true
        },
        tooltip: {
          callbacks: {
            title: function (context) {
              const date = new Date(context[0].parsed.x);
              const month = date.toLocaleString('en-US', { month: 'long' });
              const day = date.getDate();
              return `${day} ${month}`;
            },
            label: function (context) {
              const label = context.dataset?.label ? `${context.dataset.label}: ` : '';
              const y = context.parsed?.y;
              if (!isFinite(y)) return label;
              return `${label}${Math.round(y)}`;
            }
          }
        }
      }
    }
  });

  drawBarChart(i, sorted, forecast);
  updateStats(i, sorted, yearGroups, yearBaselines);
}

// ---------- Bar plugin (use LAST dataset, so forecast dataset doesn't break arrows) ----------

const deltaArrowsPlugin = {
  id: 'deltaArrows',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;

    const dsIndex = chart.data.datasets.length - 1; // last dataset = actual
    const meta = chart.getDatasetMeta(dsIndex);
    const data = chart.data.datasets[dsIndex]?.data || [];
    if (!meta || !meta.data?.length) return;

    const xScale = chart.scales[meta.xAxisID || meta.xScaleID || 'x'];
    if (!xScale) return;

    const baseY = xScale.bottom + 4;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '12px Arial';

    for (let i = 1; i < data.length; i++) {
      const curr = Number(data[i]);
      const prev = Number(data[i - 1]);
      const el = meta.data[i];
      if (!el) continue;

      let label = '—';
      let color = '#999';

      if (isFinite(curr) && isFinite(prev) && prev !== 0) {
        const pct = ((curr - prev) / prev) * 100;
        const up = pct >= 0;
        const arrow = up ? '↑' : '↓';
        color = up ? '#e74c3c' : '#2ecc71';
        label = `${arrow} ${pct >= 0 ? '+' : ''}${Math.round(pct)}%`;
      }

      ctx.fillStyle = color;
      ctx.fillText(label, el.x, baseY);
    }

    ctx.restore();
  }
};

// ---------- Bar charts (monthly totals across years + forecast overlay) ----------

function drawBarChart(i, sorted, forecast) {
  const barContainer = document.getElementById(`bar-container-${i}`);
  if (!barContainer) return;

  barContainer.innerHTML = '';
  datasets[i].barCharts = {};
  if (!sorted.length) return;

  const yearColors = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
    '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
    '#16a085', '#c0392b', '#2980b9', '#8e44ad'
  ];

  // Build month totals for ALL years from consecutive pairs (cross-year included)
  const monthTotals = {}; // key: YYYY-MM -> value
  for (let k = 0; k < sorted.length - 1; k++) {
    const a = sorted[k];
    const b = sorted[k + 1];
    if (!a?.date || !b?.date) continue;

    const aDate = toUTCDate(a.date);
    const bDate = toUTCDate(b.date);
    const diff = Number(b.value) - Number(a.value);

    if (!isFinite(diff)) continue;
    if (!(bDate > aDate)) continue;

    allocateByMonth(aDate, bDate, diff, monthTotals);
  }

  // Determine which years exist (from data + from monthTotals)
  const yearsSet = new Set();
  sorted.forEach(e => yearsSet.add(String(e.date).slice(0, 4)));
  Object.keys(monthTotals).forEach(k => yearsSet.add(k.slice(0, 4)));

  const years = Array.from(yearsSet).sort().reverse(); // newest first

  years.forEach((year, yearIndex) => {
    const labels = [];
    const actualData = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      labels.push(mm);
      actualData.push(monthTotals[`${year}-${mm}`] || 0);
    }

    const yearTotal = actualData.reduce((s, v) => s + v, 0);

    const yearColor = yearColors[(years.length - 1 - yearIndex) % yearColors.length];

    const yearSection = document.createElement('div');
    yearSection.style.marginTop = '15px';
    yearSection.style.borderLeft = `4px solid ${yearColor}`;
    yearSection.style.paddingLeft = '10px';

    const yearHeader = document.createElement('div');
    yearHeader.style.marginBottom = '8px';
    yearHeader.style.display = 'flex';
    yearHeader.style.justifyContent = 'space-between';
    yearHeader.style.alignItems = 'center';
    yearHeader.style.flexWrap = 'wrap';
    yearHeader.style.gap = '8px';

    const yearInfo = document.createElement('div');
    yearInfo.style.display = 'flex';
    yearInfo.style.alignItems = 'center';
    yearInfo.style.gap = '12px';
    yearInfo.innerHTML = `
      <span style="font-weight:bold; color:${yearColor}; font-size:16px">${year}</span>
      <span style="color:#aaa">Total: <strong style="color:${yearColor}">${Math.round(yearTotal)}</strong></span>
    `;

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-export-chart-small';
    exportBtn.textContent = `📸 Export ${year}`;
    exportBtn.onclick = () => {
      const chart = datasets[i].barCharts[year];
      downloadChartImage(chart, `${datasets[i].name}-${year}-bars.png`);
    };

    yearHeader.appendChild(yearInfo);
    yearHeader.appendChild(exportBtn);

    const chartWrap = document.createElement('div');
    chartWrap.style.position = 'relative';
    chartWrap.style.width = '100%';
    chartWrap.style.height = '200px';
    chartWrap.style.marginTop = '8px';

    const canvas = document.createElement('canvas');
    canvas.id = `bar-${i}-${year}`;
    chartWrap.appendChild(canvas);

    yearSection.appendChild(yearHeader);
    yearSection.appendChild(chartWrap);
    barContainer.appendChild(yearSection);

    const ds = [];

    // forecast overlay dataset (behind) only for active year
    if (forecast && year === forecast.activeYear && isFinite(forecast.predictedMonth)) {
      const monthIdx = forecast.activeMonthIdx; // 0..11
      const predicted = new Array(12).fill(null);
      predicted[monthIdx] = forecast.predictedMonth;

      const actualThisMonth = actualData[monthIdx] || 0;
      if (forecast.predictedMonth > actualThisMonth) {
        ds.push({
          label: `Forecast ${year}`,
          data: predicted,
          backgroundColor: `${yearColor}33`,
          borderWidth: 0,
          order: 0
        });
      }
    }

    // actual dataset (on top)
    ds.push({
      label: `Consumption ${year}`,
      data: actualData,
      backgroundColor: `${yearColor}AA`,
      order: 1
    });

    const ctx = canvas.getContext('2d');
    const barChart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: ds },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { bottom: 15 } },
        scales: {
          x: { grid: { color: '#2b2b2b' }, ticks: { padding: 5, color: '#ddd' } },
          y: { grid: { color: '#2b2b2b' }, ticks: { color: '#ddd' } }
        },
        plugins: { legend: { display: false } }
      },
      plugins: [deltaArrowsPlugin]
    });

    datasets[i].barCharts[year] = barChart;
  });
}

// ---------- Stats ----------

function updateStats(i, sorted, yearGroups, yearBaselines) {
  const statsBox = document.getElementById(`stats-${i}`);
  if (!sorted.length) { statsBox.innerHTML = ''; return; }

  const years = Object.keys(yearGroups).sort();
  let statsHTML = '';

  years.forEach((year) => {
    const yearEntries = yearGroups[year];
    const lastVal = yearEntries[yearEntries.length - 1].value;
    const yearGrowth = lastVal - yearBaselines[year];
    statsHTML += `<strong>${year}:</strong> ${Math.round(yearGrowth)} | `;
  });

  const totalGrowth = sorted[sorted.length - 1].value - sorted[0].value;
  statsHTML += `<strong>Total:</strong> ${Math.round(totalGrowth)}`;

  const cmp = datasets[i]._comparisons;
  if (cmp?.items?.length) {
    const s = cmp.items.map(x => `${x.year}: ${x.mmdd}`).join(' · ');
    statsHTML += `<br><span style="color:#aaa">Same level (${cmp.currentDate}):</span> <span style="color:#ddd">${s}</span>`;
  }

  statsBox.innerHTML = statsHTML;
}

// ---------- Render ----------

function renderDatasets(shouldPersist = true) {
  const host = document.getElementById('datasets');
  if (!host) return;
  host.innerHTML = '';

  datasets.forEach((ds, i) => {
    const card = document.createElement('div');
    card.className = 'dataset';

    const hasData = ds.entries.length > 0;

    card.innerHTML = `
      <div class="header-controls">
        <h2 style="margin:0; flex:1;">${ds.name}</h2>
        <button class="btn-toggle" onclick="toggleCollapse(${i})">
          ${ds.collapsed ? '📊 Expand' : '📋 Collapse'}
        </button>
        ${hasData ? `<button class="btn-export-chart" onclick="exportLineChart(${i})">📸 Export Line Chart</button>` : ''}
      </div>

      <div style="display:${ds.collapsed ? 'none' : 'block'};">
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Value</th><th>Actions</th></tr></thead>
          <tbody>
            ${ds.entries.map((e, j) => `
              <tr>
                <td>${j + 1}</td>
                <td><input type="date" value="${e.date || ''}" onchange="updateEntry(${i},${j},'date',this.value)"></td>
                <td><input type="number" value="${isNaN(e.value) ? '' : e.value}" onchange="updateEntry(${i},${j},'value',this.value)"></td>
                <td class="controls">
                  <button onclick="moveEntry(${i},${j},-1)" title="Move Up">↑</button>
                  <button onclick="moveEntry(${i},${j},1)" title="Move Down">↓</button>
                  <button onclick="deleteEntry(${i},${j})" title="Delete">🗑️</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>

        <button class="btn-add-row" onclick="addEntry(${i})" title="Add new row">+ Add Row</button>

        <div class="action-buttons">
          <button class="btn-export" onclick="exportCSV(${i})">📥 Export CSV</button>
          <label style="display:inline-flex; cursor:pointer;">
            <span class="btn-import">📤 Import CSV</span>
            <input type="file" accept=".csv" style="display:none" onchange="importCSV(event,${i})">
          </label>
        </div>
      </div>

      <div class="stats" id="stats-${i}"></div>
      <div class="chart-wrap"><canvas id="chart-${i}"></canvas></div>
      <div id="bar-container-${i}"></div>
    `;

    host.appendChild(card);
    drawChart(i);
  });

  if (shouldPersist) {
    persistState();
  }
}

// init
document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('addCategoryBtn');
  const input = document.getElementById('newCategory');

  if (addBtn) addBtn.addEventListener('click', addDataset);
  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addDataset();
      }
    });
  }

  loadFromLocalStorage();
  initSupabase();
});

