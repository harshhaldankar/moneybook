# 💰 Expense Manager App

A personal expense management web application designed for a **two-account financial setup**.

## Features

- 📊 **Dashboard** — At-a-glance view of both account balances, monthly income/expenses/savings, category chart, and daily spending trend
- ➕ **Add Transaction** — Quick form to log income or expenses with category, payment mode, and notes
- 🔄 **Inter-Account Transfer** — Transfer money between accounts without inflating expense totals
- 📋 **Transaction List** — Filterable, searchable list of all transactions
- 🔁 **Recurring / Auto-Debits** — Track SIPs, EMIs, subscriptions with debit day reminders
- 🎯 **Budgets** — Set monthly budgets per category with visual progress bars
- 📈 **Reports** — Category breakdown, income vs expenses trend, account-wise & payment mode charts, top expenses
- ⚙️ **Settings** — Configure account names, opening balances, export/import data as JSON

## Quick Start

1. Open `index.html` in any modern browser
2. Go to **Settings** to set your account names and opening balances
3. Start adding transactions!

## Tech Stack

- **HTML5** + **CSS3** (responsive, mobile-friendly)
- **Vanilla JavaScript** (no framework dependencies)
- **Chart.js** for charts
- **Font Awesome** for icons
- **LocalStorage** for data persistence

## Project Structure

```
├── index.html                  # Main app (single page)
├── css/
│   └── style.css               # Complete stylesheet
├── js/
│   ├── data.js                 # Data layer (categories, storage, helpers)
│   └── app.js                  # Application logic
└── appsheet-templates/         # Google Sheets CSV templates for AppSheet
    ├── accounts.csv
    ├── transactions.csv
    ├── recurring_items.csv
    ├── budgets.csv
    ├── categories.csv
    └── README.md               # AppSheet setup guide
```

## AppSheet Setup

If you prefer a mobile-first no-code approach, use the CSV templates in `appsheet-templates/` folder:

1. Upload the CSVs to Google Sheets
2. Create an AppSheet app from the sheet
3. Follow the guide in `appsheet-templates/README.md`

## Data Management

- All data is stored in browser **LocalStorage**
- **Export**: Settings → Export Data (JSON) to back up
- **Import**: Settings → Import Data to restore from backup
- **Clear**: Settings → Clear All Data to reset
