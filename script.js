/* =============================================================
   script.js – Personal Finance Dashboard
   Vanilla JS + Chart.js  |  No external framework required
   =============================================================
   Architecture:
     1. Data loading & parsing
     2. Filter state management
     3. KPI calculations (income-vs-expense, avoiding double-count)
     4. Chart rendering & update helpers
     5. Transaction table (search, sort, pagination)
     6. Event wiring
   ============================================================= */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 0. CONSTANTS & COLOR PALETTE
// ─────────────────────────────────────────────────────────────────────────────

/** Categories treated as expenses (debits that reduce cash) */
const EXPENSE_CATEGORIES = new Set([
  'Alcohol & Bars', 'Auto Insurance', 'Coffee Shops', 'Electronics & Software',
  'Entertainment', 'Fast Food', 'Food & Dining', 'Gas & Fuel', 'Groceries',
  'Haircut', 'Home Improvement', 'Internet', 'Mobile Phone', 'Mortgage & Rent',
  'Movies & Dvds', 'Music', 'Restaurants', 'Shopping', 'Television', 'Utilities',
]);

/**
 * Credit Card Payment is a transfer between accounts — NOT a true expense.
 * Paycheck is income. Both are excluded from expense totals to avoid double-counting.
 */
const CC_PAYMENT_CAT = 'Credit Card Payment';
const INCOME_CAT     = 'Paycheck';

/** Chart.js colour palette */
const PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#6366f1','#fb923c','#a3e635','#f43f5e','#22d3ee',
  '#a78bfa','#fbbf24','#34d399','#60a5fa','#fb7185',
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. STATE
// ─────────────────────────────────────────────────────────────────────────────

let allData = [];       // full dataset loaded once
let filtered = [];      // current view after filters

// Table state
let tableData   = [];   // filtered + searched
let tableSortCol  = 'date';
let tableSortDir  = 'desc';
let tablePage     = 1;
let tablePageSize = 25;
let tableSearch   = '';

// Chart.js instances (kept so we can destroy & re-create on filter change)
const charts = {};

// ─────────────────────────────────────────────────────────────────────────────
// 2. DATA LOADING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise from the inline FINANCE_DATA variable (injected by data.js).
 * This avoids fetch() so the dashboard works on file:// without a web server.
 */
function loadData() {
  try {
    if (typeof FINANCE_DATA === 'undefined') {
      throw new Error('data.js not loaded — make sure <script src="data.js"> is above script.js in index.html');
    }

    // Normalise: ensure amount is a number, date is a Date object
    allData = FINANCE_DATA.map(r => ({
      ...r,
      amount: parseFloat(r.amount) || 0,
      dateObj: new Date(r.date),
    }));

    // Populate filter dropdowns
    populateFilterOptions();

    // Set default date range to full dataset
    const dates = allData.map(r => r.dateObj);
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    document.getElementById('filterDateFrom').value = fmt(minDate);
    document.getElementById('filterDateTo').value   = fmt(maxDate);

    // Show last updated
    document.getElementById('lastUpdated').textContent =
      `Data: ${allData.length} transactions`;

    // Initial render
    applyFilters();

  } catch (err) {
    console.error('Dashboard init error:', err);
    document.getElementById('loadingOverlay').innerHTML =
      `<div class="text-center text-red-500 p-8">
        <p class="font-semibold">Failed to initialise dashboard</p>
        <p class="text-sm mt-1">${err.message}</p>
       </div>`;
  }
}

/** Format a Date to YYYY-MM-DD for input[type=date] */
function fmt(d) {
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. FILTER DROPDOWNS
// ─────────────────────────────────────────────────────────────────────────────

function populateFilterOptions() {
  const categories = [...new Set(allData.map(r => r.category))].sort();
  const accounts   = [...new Set(allData.map(r => r.account_name))].sort();

  const catSel = document.getElementById('filterCategory');
  categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });

  const accSel = document.getElementById('filterAccount');
  accounts.forEach(a => {
    const o = document.createElement('option');
    o.value = a; o.textContent = a;
    accSel.appendChild(o);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. FILTER APPLICATION
// ─────────────────────────────────────────────────────────────────────────────

function applyFilters() {
  const from    = document.getElementById('filterDateFrom').value;
  const to      = document.getElementById('filterDateTo').value;
  const type    = document.getElementById('filterType').value;
  const cat     = document.getElementById('filterCategory').value;
  const account = document.getElementById('filterAccount').value;

  const fromDate = from ? new Date(from) : null;
  const toDate   = to   ? new Date(to + 'T23:59:59') : null;

  filtered = allData.filter(r => {
    if (fromDate && r.dateObj < fromDate) return false;
    if (toDate   && r.dateObj > toDate)   return false;
    if (type    && r.transaction_type !== type)    return false;
    if (cat     && r.category         !== cat)     return false;
    if (account && r.account_name     !== account) return false;
    return true;
  });

  // Reset table pagination on filter change
  tablePage  = 1;
  tableSearch = document.getElementById('tableSearch').value;

  renderAll();
  hideLoading();
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. KPI CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns aggregated KPI figures from the filtered dataset.
 *
 * Income logic:
 *   - Category === 'Paycheck' AND transaction_type === 'credit'  → income
 *
 * Expense logic:
 *   - transaction_type === 'debit' AND category NOT IN [CC_PAYMENT_CAT]
 *   - We DO include debit CC transactions (purchases on card) but
 *     EXCLUDE the Credit Card Payment entries (transfers) to avoid double-count.
 *
 * Savings Rate = (Income − Expenses) / Income × 100
 */
function calcKPIs(data) {
  let totalIncome   = 0;
  let totalExpenses = 0;
  const monthlyExp  = {};

  data.forEach(r => {
    // Income: Paycheck credits
    if (r.category === INCOME_CAT && r.transaction_type === 'credit') {
      totalIncome += r.amount;
    }

    // Expenses: debit transactions that are real spending (not CC payment transfers)
    if (r.transaction_type === 'debit' && r.category !== CC_PAYMENT_CAT) {
      totalExpenses += r.amount;
      // Track per-month for average calc
      monthlyExp[r.month] = (monthlyExp[r.month] || 0) + r.amount;
    }
  });

  const months         = Object.keys(monthlyExp).length || 1;
  const avgMonthlyExp  = totalExpenses / months;
  const netCashFlow    = totalIncome - totalExpenses;
  const savingsRate    = totalIncome > 0
    ? ((totalIncome - totalExpenses) / totalIncome) * 100
    : 0;

  return { totalIncome, totalExpenses, netCashFlow, avgMonthlyExp, savingsRate };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. KPI RENDERING
// ─────────────────────────────────────────────────────────────────────────────

const usd = v => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(v);

const pct = v => `${v.toFixed(1)}%`;

function renderKPIs(data) {
  const kpi = calcKPIs(data);

  document.getElementById('kpiIncome').textContent     = usd(kpi.totalIncome);
  document.getElementById('kpiExpenses').textContent   = usd(kpi.totalExpenses);
  document.getElementById('kpiTxCount').textContent    = data.length.toLocaleString();
  document.getElementById('kpiAvgMonthly').textContent = usd(kpi.avgMonthlyExp);

  const netEl = document.getElementById('kpiNet');
  netEl.textContent = usd(kpi.netCashFlow);
  netEl.className   = `text-xl font-bold ${kpi.netCashFlow >= 0 ? 'text-green-600' : 'text-red-500'}`;

  const savEl = document.getElementById('kpiSavings');
  savEl.textContent = pct(kpi.savingsRate);
  savEl.className   = `text-xl font-bold ${kpi.savingsRate >= 20 ? 'text-green-600'
    : kpi.savingsRate >= 0 ? 'text-orange-500' : 'text-red-500'}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. CHART HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Destroy old chart instance if exists, then create new one */
function makeChart(id, config) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
  const ctx = document.getElementById(id);
  if (!ctx) return;
  charts[id] = new Chart(ctx, config);
}

/** Shared default options for readability */
const baseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: { font: { size: 11 }, color: '#6b7280', boxWidth: 12 },
    },
    tooltip: {
      callbacks: {
        label: ctx => ` ${usd(ctx.parsed.y ?? ctx.parsed ?? ctx.raw)}`,
      },
    },
  },
};

const axisStyle = {
  ticks : { color: '#9ca3af', font: { size: 10 } },
  grid  : { color: '#f3f4f6' },
  border: { display: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. INDIVIDUAL CHART RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

/** 8a. Monthly Income vs Expenses – grouped bar */
function renderChartMonthly(data) {
  const monthMap = {};
  data.forEach(r => {
    if (!monthMap[r.month]) monthMap[r.month] = { income: 0, expense: 0 };
    if (r.category === INCOME_CAT && r.transaction_type === 'credit') {
      monthMap[r.month].income += r.amount;
    }
    if (r.transaction_type === 'debit' && r.category !== CC_PAYMENT_CAT) {
      monthMap[r.month].expense += r.amount;
    }
  });

  const labels   = Object.keys(monthMap).sort();
  const incomes  = labels.map(m => monthMap[m].income);
  const expenses = labels.map(m => monthMap[m].expense);

  makeChart('chartMonthly', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income',   data: incomes,  backgroundColor: '#10b981cc', borderRadius: 3 },
        { label: 'Expenses', data: expenses, backgroundColor: '#ef4444cc', borderRadius: 3 },
      ],
    },
    options: {
      ...baseOpts,
      plugins: {
        ...baseOpts.plugins,
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.raw)}` },
        },
      },
      scales: {
        x: { ...axisStyle, ticks: { ...axisStyle.ticks, maxRotation: 45 } },
        y: { ...axisStyle, ticks: { ...axisStyle.ticks, callback: v => usd(v) } },
      },
    },
  });
}

/** 8b. Expenses by Category – horizontal bar */
function renderChartExpCat(data) {
  const catMap = {};
  data.forEach(r => {
    if (r.transaction_type === 'debit' && r.category !== CC_PAYMENT_CAT) {
      catMap[r.category] = (catMap[r.category] || 0) + r.amount;
    }
  });

  const sorted  = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const labels  = sorted.map(([k]) => k);
  const amounts = sorted.map(([, v]) => v);

  makeChart('chartExpCat', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Expenses',
        data: amounts,
        backgroundColor: PALETTE.slice(0, labels.length),
        borderRadius: 4,
      }],
    },
    options: {
      ...baseOpts,
      indexAxis: 'y',
      plugins: {
        ...baseOpts.plugins,
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${usd(ctx.raw)}` } },
      },
      scales: {
        x: { ...axisStyle, ticks: { ...axisStyle.ticks, callback: v => usd(v) } },
        y: { ...axisStyle },
      },
    },
  });
}

/** 8c. Transaction Type Distribution – doughnut */
function renderChartTypeDistrib(data) {
  const counts = { debit: 0, credit: 0 };
  data.forEach(r => counts[r.transaction_type]++);

  makeChart('chartTypeDistrib', {
    type: 'doughnut',
    data: {
      labels: ['Debit', 'Credit'],
      datasets: [{
        data: [counts.debit, counts.credit],
        backgroundColor: ['#ef4444cc', '#10b981cc'],
        borderWidth: 2,
        borderColor: '#fff',
      }],
    },
    options: {
      ...baseOpts,
      cutout: '60%',
      plugins: {
        ...baseOpts.plugins,
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} txns` } },
      },
    },
  });
}

/** 8d. Account Activity Distribution – pie */
function renderChartAccountDistrib(data) {
  const accMap = {};
  data.forEach(r => { accMap[r.account_name] = (accMap[r.account_name] || 0) + 1; });

  const labels = Object.keys(accMap);
  const counts = labels.map(k => accMap[k]);

  makeChart('chartAccountDistrib', {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: ['#3b82f6cc', '#f59e0bcc', '#8b5cf6cc'],
        borderWidth: 2,
        borderColor: '#fff',
      }],
    },
    options: {
      ...baseOpts,
      plugins: {
        ...baseOpts.plugins,
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} txns` } },
      },
    },
  });
}

/** 8e. Top 10 Highest Transactions – horizontal bar */
function renderChartTop10(data) {
  const top10 = [...data]
    .filter(r => r.category !== CC_PAYMENT_CAT)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  const labels = top10.map(r =>
    r.description.length > 22 ? r.description.slice(0, 22) + '…' : r.description
  );

  makeChart('chartTop10', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Amount',
        data: top10.map(r => r.amount),
        backgroundColor: top10.map(r =>
          r.transaction_type === 'credit' ? '#10b981cc' : '#ef4444cc'
        ),
        borderRadius: 4,
      }],
    },
    options: {
      ...baseOpts,
      indexAxis: 'y',
      plugins: {
        ...baseOpts.plugins,
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const r = top10[ctx.dataIndex];
              return ` ${usd(ctx.raw)} — ${r.category} (${r.transaction_type})`;
            },
          },
        },
      },
      scales: {
        x: { ...axisStyle, ticks: { ...axisStyle.ticks, callback: v => usd(v) } },
        y: { ...axisStyle },
      },
    },
  });
}

/** 8f. Transaction Amount Distribution – histogram (bucket-based bar) */
function renderChartAmtDistrib(data) {
  const amounts = data
    .filter(r => r.category !== CC_PAYMENT_CAT && r.transaction_type === 'debit')
    .map(r => r.amount);

  if (!amounts.length) {
    makeChart('chartAmtDistrib', { type: 'bar', data: { labels: [], datasets: [] }, options: baseOpts });
    return;
  }

  const max    = Math.max(...amounts);
  const bCount = 10;
  const bSize  = Math.ceil(max / bCount);
  const buckets = Array(bCount).fill(0);

  amounts.forEach(a => {
    const idx = Math.min(Math.floor(a / bSize), bCount - 1);
    buckets[idx]++;
  });

  const labels = buckets.map((_, i) => `$${i * bSize}–$${(i + 1) * bSize}`);

  makeChart('chartAmtDistrib', {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: '# Transactions', data: buckets, backgroundColor: '#3b82f6aa', borderRadius: 3 }],
    },
    options: {
      ...baseOpts,
      plugins: {
        ...baseOpts.plugins,
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw} transactions` } },
      },
      scales: {
        x: { ...axisStyle, ticks: { ...axisStyle.ticks, maxRotation: 40 } },
        y: { ...axisStyle },
      },
    },
  });
}

/** 8g. Monthly Spending Trends – stacked area line chart (top 5 expense cats) */
function renderChartTrends(data) {
  // Find top 5 expense categories by total spend
  const catTotals = {};
  data.forEach(r => {
    if (r.transaction_type === 'debit' && r.category !== CC_PAYMENT_CAT) {
      catTotals[r.category] = (catTotals[r.category] || 0) + r.amount;
    }
  });
  const top5 = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  const months = [...new Set(data.map(r => r.month))].sort();

  // Build per-month per-category totals
  const monthCatMap = {};
  data.forEach(r => {
    if (!top5.includes(r.category)) return;
    if (r.transaction_type !== 'debit') return;
    if (!monthCatMap[r.month]) monthCatMap[r.month] = {};
    monthCatMap[r.month][r.category] = (monthCatMap[r.month][r.category] || 0) + r.amount;
  });

  const datasets = top5.map((cat, i) => ({
    label: cat,
    data: months.map(m => monthCatMap[m]?.[cat] || 0),
    borderColor: PALETTE[i],
    backgroundColor: PALETTE[i] + '22',
    fill: false,
    tension: 0.4,
    pointRadius: 3,
    borderWidth: 2,
  }));

  makeChart('chartTrends', {
    type: 'line',
    data: { labels: months, datasets },
    options: {
      ...baseOpts,
      plugins: {
        ...baseOpts.plugins,
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${usd(ctx.raw)}` } },
      },
      scales: {
        x: { ...axisStyle, ticks: { ...axisStyle.ticks, maxRotation: 45 } },
        y: { ...axisStyle, ticks: { ...axisStyle.ticks, callback: v => usd(v) } },
      },
    },
  });
}

/** 8h. Expense Category Comparison – radar chart */
function renderChartRadar(data) {
  const catMap = {};
  data.forEach(r => {
    if (r.transaction_type === 'debit' && r.category !== CC_PAYMENT_CAT) {
      catMap[r.category] = (catMap[r.category] || 0) + r.amount;
    }
  });

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map(([k]) => k);
  const values = sorted.map(([, v]) => v);

  makeChart('chartRadar', {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: 'Total Spent',
        data: values,
        backgroundColor: '#3b82f622',
        borderColor: '#3b82f6',
        pointBackgroundColor: '#3b82f6',
        borderWidth: 2,
        pointRadius: 4,
      }],
    },
    options: {
      ...baseOpts,
      plugins: {
        ...baseOpts.plugins,
        tooltip: { callbacks: { label: ctx => ` ${usd(ctx.raw)}` } },
      },
      scales: {
        r: {
          ticks:    { color: '#9ca3af', font: { size: 9 }, backdropColor: 'transparent', callback: v => usd(v) },
          grid:     { color: '#e5e7eb' },
          angleLines:{ color: '#e5e7eb' },
          pointLabels:{ color: '#4b5563', font: { size: 10 } },
        },
      },
    },
  });
}

/** 8i. Category Summary list with progress bars */
function renderCategorySummary(data) {
  const catMap = {};
  data.forEach(r => {
    if (r.transaction_type === 'debit' && r.category !== CC_PAYMENT_CAT) {
      catMap[r.category] = (catMap[r.category] || 0) + r.amount;
    }
  });

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const maxVal = sorted[0]?.[1] || 1;

  const el = document.getElementById('categorySummary');
  el.innerHTML = sorted.map(([cat, val], i) => `
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full shrink-0" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <span class="text-xs text-gray-600 w-36 truncate" title="${cat}">${cat}</span>
      <div class="cat-bar-track flex-1">
        <div class="cat-bar-fill" style="width:${(val / maxVal * 100).toFixed(1)}%; background:${PALETTE[i % PALETTE.length]}"></div>
      </div>
      <span class="text-xs font-medium text-gray-700 w-20 text-right">${usd(val)}</span>
    </div>
  `).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. TRANSACTION TABLE
// ─────────────────────────────────────────────────────────────────────────────

function getTableData() {
  const search = tableSearch.toLowerCase().trim();
  let rows = search
    ? filtered.filter(r => r.description.toLowerCase().includes(search))
    : [...filtered];

  // Sort
  rows.sort((a, b) => {
    let va = a[tableSortCol], vb = b[tableSortCol];
    if (tableSortCol === 'amount') { va = +va; vb = +vb; }
    if (tableSortCol === 'date')   { va = a.dateObj; vb = b.dateObj; }
    if (va < vb) return tableSortDir === 'asc' ? -1 : 1;
    if (va > vb) return tableSortDir === 'asc' ?  1 : -1;
    return 0;
  });

  return rows;
}

function renderTable() {
  tableData = getTableData();

  const total    = tableData.length;
  const start    = (tablePage - 1) * tablePageSize;
  const pageRows = tableData.slice(start, start + tablePageSize);

  // Update count label
  document.getElementById('tableCount').textContent =
    `${total.toLocaleString()} transaction${total !== 1 ? 's' : ''}`;

  // Render rows
  const tbody = document.getElementById('tableBody');
  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-sm text-gray-400">No transactions found</td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map(r => `
      <tr class="text-sm">
        <td class="px-4 py-2.5 text-gray-500 whitespace-nowrap">${r.date}</td>
        <td class="px-4 py-2.5 text-gray-800 max-w-xs truncate" title="${escHtml(r.description)}">${escHtml(r.description)}</td>
        <td class="px-4 py-2.5 font-medium whitespace-nowrap ${r.transaction_type === 'credit' ? 'text-green-600' : 'text-red-500'}">
          ${r.transaction_type === 'credit' ? '+' : '-'}${usd(r.amount)}
        </td>
        <td class="px-4 py-2.5">
          <span class="badge badge-${r.transaction_type}">${r.transaction_type}</span>
        </td>
        <td class="px-4 py-2.5 text-gray-600">${escHtml(r.category)}</td>
        <td class="px-4 py-2.5 text-gray-600">${escHtml(r.account_name)}</td>
      </tr>
    `).join('');
  }

  renderPagination(total);
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPagination(total) {
  const totalPages = Math.ceil(total / tablePageSize) || 1;
  const el = document.getElementById('pagination');

  // Build page buttons: show at most 7 page numbers
  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (tablePage > 3) pages.push('…');
    for (let i = Math.max(2, tablePage - 1); i <= Math.min(totalPages - 1, tablePage + 1); i++) {
      pages.push(i);
    }
    if (tablePage < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  el.innerHTML = `
    <button class="page-btn" id="pagePrev" ${tablePage === 1 ? 'disabled' : ''}>‹</button>
    ${pages.map(p => p === '…'
      ? `<span class="px-1 text-gray-400 text-xs">…</span>`
      : `<button class="page-btn ${p === tablePage ? 'active' : ''}" data-page="${p}">${p}</button>`
    ).join('')}
    <button class="page-btn" id="pageNext" ${tablePage === totalPages ? 'disabled' : ''}>›</button>
  `;

  // Bind page buttons
  el.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      tablePage = +btn.dataset.page;
      renderTable();
    });
  });
  document.getElementById('pagePrev')?.addEventListener('click', () => {
    if (tablePage > 1) { tablePage--; renderTable(); }
  });
  document.getElementById('pageNext')?.addEventListener('click', () => {
    if (tablePage < totalPages) { tablePage++; renderTable(); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. MASTER RENDER
// ─────────────────────────────────────────────────────────────────────────────

function renderAll() {
  const data = filtered;

  renderKPIs(data);
  renderChartMonthly(data);
  renderChartExpCat(data);
  renderChartTypeDistrib(data);
  renderChartAccountDistrib(data);
  renderChartTop10(data);
  renderChartAmtDistrib(data);
  renderChartTrends(data);
  renderChartRadar(data);
  renderCategorySummary(data);
  renderTable();
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. UTILITY
// ─────────────────────────────────────────────────────────────────────────────

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. EVENT WIRING
// ─────────────────────────────────────────────────────────────────────────────

function wireEvents() {
  // Filter inputs – debounced to avoid excessive re-renders on date typing
  let debounceTimer;
  const debouncedApply = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 250);
  };

  ['filterDateFrom', 'filterDateTo', 'filterType', 'filterCategory', 'filterAccount']
    .forEach(id => document.getElementById(id)?.addEventListener('change', debouncedApply));

  // Reset button
  document.getElementById('resetFiltersBtn')?.addEventListener('click', () => {
    document.getElementById('filterType').value     = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterAccount').value  = '';
    // Restore full date range
    const dates = allData.map(r => r.dateObj);
    const minD  = dates.reduce((a, b) => (a < b ? a : b));
    const maxD  = dates.reduce((a, b) => (a > b ? a : b));
    document.getElementById('filterDateFrom').value = fmt(minD);
    document.getElementById('filterDateTo').value   = fmt(maxD);
    applyFilters();
  });

  // Table search
  let searchTimer;
  document.getElementById('tableSearch')?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      tableSearch = e.target.value;
      tablePage   = 1;
      renderTable();
    }, 200);
  });

  // Table sort headers
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (tableSortCol === col) {
        tableSortDir = tableSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        tableSortCol = col;
        tableSortDir = 'asc';
      }
      // Update visual indicator
      document.querySelectorAll('th.sortable').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
        h.querySelector('.sort-icon').textContent = '↕';
      });
      th.classList.add(`sort-${tableSortDir}`);
      th.querySelector('.sort-icon').textContent = tableSortDir === 'asc' ? '↑' : '↓';

      tablePage = 1;
      renderTable();
    });
  });

  // Page size selector
  document.getElementById('pageSize')?.addEventListener('change', e => {
    tablePageSize = +e.target.value;
    tablePage = 1;
    renderTable();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. BOOT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  loadData();
});
