# Personal Finance Analytics Dashboard

A fully client-side analytics dashboard built with **HTML**, **Tailwind CSS**, **Vanilla JavaScript**, and **Chart.js**. It reads real transaction data from `data.json` (converted from `Personal_Financial.csv`) and renders KPIs, 8 interactive charts, and a searchable/sortable transaction table — all without any backend or build tool.

---

## 📁 Project Structure

```
├── index.html          # Main HTML shell (semantic, responsive)
├── style.css           # Custom styles supplementing Tailwind
├── script.js           # All application logic (modular, commented)
├── data.json           # Transaction data (auto-generated from CSV)
├── Personal_Financial.csv  # Original source dataset
└── README.md           # This file
```

---

## 🚀 Running Locally

> ⚠️ Because `script.js` uses `fetch('data.json')`, you **must** serve the files through a local web server. Opening `index.html` directly as a `file://` URL will cause a CORS error in most browsers.

### Option A — VS Code Live Server (Recommended)

1. Install the [Live Server extension](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer).
2. Right-click `index.html` → **Open with Live Server**.
3. Browser opens at `http://127.0.0.1:5500`.

### Option B — Python (no install needed on macOS/Linux)

```bash
# Python 3
python -m http.server 8080
```
Then open `http://localhost:8080` in your browser.

### Option C — Node.js `http-server`

```bash
npm install -g http-server
http-server . -p 8080
```
Then open `http://localhost:8080`.

### Option D — PowerShell one-liner (Windows)

```powershell
# Run from the project folder
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:8080/')
$listener.Start()
Write-Host "Serving at http://localhost:8080 — press Ctrl+C to stop"
while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $file = Join-Path (Get-Location) $ctx.Request.Url.LocalPath.TrimStart('/')
    if ($ctx.Request.Url.LocalPath -eq '/') { $file = Join-Path (Get-Location) 'index.html' }
    if (Test-Path $file) {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $ctx.Response.Close()
}
```

---

## 📊 Features

### KPIs (6 cards)
| KPI | Calculation |
|-----|-------------|
| **Total Income** | Sum of `credit` transactions where `Category = Paycheck` |
| **Total Expenses** | Sum of `debit` transactions excluding `Credit Card Payment` (avoids double-count) |
| **Net Cash Flow** | Total Income − Total Expenses |
| **Total Transactions** | Count of filtered rows |
| **Avg Monthly Expenses** | Total Expenses ÷ number of distinct months |
| **Savings Rate** | (Income − Expenses) / Income × 100% |

### Charts (8)
1. **Monthly Income vs Expenses** — grouped bar chart per month
2. **Expenses by Category** — horizontal bar, sorted descending
3. **Transaction Type Distribution** — doughnut (debit vs credit)
4. **Account Activity Distribution** — pie chart by account
5. **Top 10 Highest Transactions** — horizontal bar (excludes CC payments)
6. **Transaction Amount Distribution** — histogram of debit amounts
7. **Monthly Spending Trends** — multi-line chart for top 5 expense categories
8. **Expense Category Comparison** — radar chart (top 10 categories)

### Filters
- **Date Range** (From / To)
- **Transaction Type** (debit / credit)
- **Category** (all categories from dataset)
- **Account Name** (Checking / Platinum Card / Silver Card)
- All filters update every KPI and chart **instantly without page refresh**.
- **Reset Filters** button restores defaults.

### Transaction Table
- Full-text **search** on Description
- **Sort** by Date or Amount (click column header, toggle asc/desc)
- **Pagination** with configurable page size (10 / 25 / 50 / 100)
- Color-coded debit/credit badges

---

## ⚙️ Regenerating data.json from CSV

If you update `Personal_Financial.csv`, regenerate `data.json` with this PowerShell command (run from the project folder):

```powershell
$csv = Import-Csv "Personal_Financial.csv"
$json = $csv | ForEach-Object {
    [PSCustomObject]@{
        date             = $_.Date.Substring(0,10)
        description      = $_.Description
        amount           = [double]$_.Amount
        transaction_type = $_."Transaction Type"
        category         = $_.Category
        account_name     = $_."Account Name"
        month            = $_.Month
    }
} | ConvertTo-Json -Depth 5
Set-Content -Path "data.json" -Value $json -Encoding UTF8
```

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Markup | Semantic HTML5 |
| Styling | [Tailwind CSS](https://tailwindcss.com/) (CDN) + custom `style.css` |
| Charts | [Chart.js 4](https://www.chartjs.org/) (CDN) |
| Logic | Vanilla JavaScript (ES2020, no framework) |
| Data | JSON (converted from CSV) |

No build step, no `node_modules`, no framework. Everything runs in the browser.

---

## 📝 Notes on Financial Calculations

- **Credit Card Payments** (`Category = "Credit Card Payment"`, `Type = "credit"`) are **excluded** from expenses because they represent an internal transfer between the credit card and checking account — including them would double-count spending already captured as debit purchases.
- **Paycheck** entries (`Category = "Paycheck"`, `Type = "credit"`) are counted as **income**.
- All other `debit` transactions are counted as **expenses**.
