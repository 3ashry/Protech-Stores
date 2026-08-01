// ═══════════════════════════════════════════════════════════════════
//  WEEKLY PROJECTED-PROFIT CHART
//
//  Buckets all orders + expenses since the first Monday of June into
//  weekly (Mon–Sun) slots and renders:
//    • Weekly bar  = that week's projected profit  (green if +, red if −)
//    • Line overlay = running cumulative profit
//
//  Projected profit for a week =
//      Σ(orderTotal − actual_shipping) for Delivered + In-Transit orders
//      created that week
//    − Σ(buy_price × qty) for those orders (Elashry cost)
//    − Σ(expenses)  logged that week (any category)
//    − Σ(actual_shipping) for Returned orders resolved that week
// ═══════════════════════════════════════════════════════════════════

let _profitChart = null;

// Anchor: first Monday on/after 1 June of the current year (Egypt-time-safe).
function _weekStartOfSeason() {
  const now = new Date();
  const y = now.getFullYear();
  const jun1 = new Date(y, 5, 1); // month is 0-indexed → 5 = June
  const dow = jun1.getDay();      // 0 Sun, 1 Mon, … 6 Sat
  const shift = (dow === 0) ? 1 : (dow === 1 ? 0 : 8 - dow); // days until next Monday (or same day if Mon)
  jun1.setDate(jun1.getDate() + shift);
  jun1.setHours(0, 0, 0, 0);
  return jun1;
}

// Returns the Monday 00:00 of the week that contains `d`.
function _mondayOf(d) {
  const x = new Date(d);
  const dow = x.getDay();
  const shift = (dow === 0) ? -6 : (1 - dow); // Sunday → back 6 days; else back to Mon
  x.setDate(x.getDate() + shift);
  x.setHours(0, 0, 0, 0);
  return x;
}

function _labelForWeek(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  return `${day} ${mo}`;
}

function _lineBuy(p, products) {
  if (typeof lineBuyPrice === 'function') return lineBuyPrice(p, products);
  // Fallback: line's own buy_price, else look up by code, else 0.
  const own = parseFloat(p?.buy_price);
  if (Number.isFinite(own) && own > 0) return own;
  const found = (products || []).find(x => String(x.code || '').toUpperCase() === String(p?.code || '').toUpperCase());
  return parseFloat(found?.buy_price) || 0;
}

function renderWeeklyProfitChart() {
  const canvas = document.getElementById('profit-weekly-chart');
  const note = document.getElementById('profit-weekly-note');
  if (!canvas) return;
  if (typeof Chart === 'undefined') {
    if (note) note.textContent = 'Chart library not loaded yet — will render on next refresh.';
    return;
  }

  const orders = (cache.orders || []).slice();
  const expenses = (cache.expenses || []).slice();
  const products = cache.products || [];

  const seasonStart = _weekStartOfSeason();
  const now = new Date();
  const thisMonday = _mondayOf(now);

  // Build a Monday-indexed map: { epochMs: { revenue, cogs, expenses, retShip } }
  const buckets = new Map();
  const ensure = (t) => {
    if (t < seasonStart.getTime()) return null;
    if (!buckets.has(t)) buckets.set(t, { revenue: 0, cogs: 0, expenses: 0, retShip: 0 });
    return buckets.get(t);
  };
  // Seed every week Mon-of-June … this Monday so the chart shows even zero weeks.
  for (let m = new Date(seasonStart); m.getTime() <= thisMonday.getTime(); m.setDate(m.getDate() + 7)) {
    buckets.set(m.getTime(), { revenue: 0, cogs: 0, expenses: 0, retShip: 0 });
  }

  // Order attribution: use created_at → week bucket.
  for (const o of orders) {
    const t = _mondayOf(new Date(o.created_at || o.date || Date.now())).getTime();
    const b = ensure(t);
    if (!b) continue;
    const st = o.status;
    // Revenue + COGS from delivered / in-transit orders only.
    if (st === 'Delivered' || st === 'In Transit') {
      b.revenue += (parseFloat(o.total || 0) - parseFloat(o.actual_shipping || 0));
      const cogs = (o.products || []).reduce((s, p) => s + _lineBuy(p, products) * (parseInt(p.qty || 1) || 1), 0);
      b.cogs += cogs;
    }
    // Return shipping is charged whenever a return happens — attribute to its week.
    if (st === 'Returned') {
      b.retShip += parseFloat(o.actual_shipping || 0);
    }
  }
  // Expenses: attribute by expense.date (fallback created_at).
  for (const e of expenses) {
    const raw = e.date || e.created_at;
    if (!raw) continue;
    const d = new Date(raw);
    if (isNaN(d.getTime())) continue;
    const t = _mondayOf(d).getTime();
    const b = ensure(t);
    if (!b) continue;
    b.expenses += parseFloat(e.amount || 0) || 0;
  }

  // Build ordered arrays.
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  const labels = keys.map(k => _labelForWeek(new Date(k)));
  const weekly = [];
  const cumulative = [];
  let running = 0;
  for (const k of keys) {
    const b = buckets.get(k);
    const p = (b.revenue) - (b.cogs) - (b.expenses) - (b.retShip);
    weekly.push(Math.round(p));
    running += p;
    cumulative.push(Math.round(running));
  }
  const barColors = weekly.map(v => v >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(220,38,38,0.7)');

  if (_profitChart) {
    _profitChart.data.labels = labels;
    _profitChart.data.datasets[0].data = weekly;
    _profitChart.data.datasets[0].backgroundColor = barColors;
    _profitChart.data.datasets[1].data = cumulative;
    _profitChart.update();
  } else {
    _profitChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Weekly',
            data: weekly,
            backgroundColor: barColors,
            borderRadius: 4,
            order: 2,
          },
          {
            type: 'line',
            label: 'Cumulative',
            data: cumulative,
            borderColor: '#F26A21',
            backgroundColor: 'rgba(242,106,33,0.10)',
            borderWidth: 2.5,
            tension: 0.28,
            pointRadius: 3,
            pointBackgroundColor: '#F26A21',
            fill: true,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            grid: { color: 'rgba(0,0,0,0.06)' },
            ticks: { callback: (v) => v.toLocaleString('en-US') + ' EGP' },
          },
          x: { grid: { display: false } },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: EGP ${Number(ctx.parsed.y || 0).toLocaleString('en-US')}`,
            },
          },
        },
      },
    });
  }

  // Small footnote.
  if (note) {
    const total = cumulative.length ? cumulative[cumulative.length - 1] : 0;
    note.innerHTML = `
      <b>Weeks:</b> ${keys.length}
       &nbsp;•&nbsp; <b>Cumulative to date:</b>
       <span style="color:${total >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">EGP ${Number(total).toLocaleString('en-US')}</span>
      <br>
      Green bar = profitable week, red bar = losing week. Orange line = running total from the first Monday of June.
      Formula: (delivered + in-transit revenue) − (their COGS) − (expenses that week) − (return shipping that week).`;
  }
}
