# MoneyBook — Expense & Savings Manager

A mobile-first personal finance app: any number of bank accounts, month-on-month savings with targets and carry-forward, and a separate password-protected login for each person.

## Features

- **Login per person**: each user has their own User ID and password. Data is encrypted with that password (AES-256-GCM, key from PBKDF2-SHA256, 250k iterations), so people sharing a phone can't read each other's data. Auto-locks after 10 minutes idle.
- **Any number of bank accounts**: add salary, daily-use, cash wallet, credit card and other accounts. One is marked **Main**. Home shows the *Total balance*, the *Main account* balance and the combined balance of *Other accounts*. Closed accounts can be archived with their history kept.
- **Savings tracker**:
  - Saved this month = Income − Expenses (investments/SIP count as savings; you can turn this off)
  - Monthly savings target (a default for every month, with optional per-month overrides)
  - **Carry forward**: what came in from last month → + income → − expenses → what carries into next month
  - Running "ahead / behind target" total, a chart of savings per month, and a month-on-month table
- **Transactions**: Expense / Income / Transfer in one form with category tiles. Transfers between your own accounts are not counted as spending.
- **Budgets** per category with alerts at 80% and when over budget. You can copy last month's budgets.
- **Auto-debits** (SIP, EMI, rent, subscriptions): tap **Paid** to record the payment in the right account.
- **Reports**: spending by category, account and payment mode, income vs expenses, top expenses.
- **Backup**: JSON backup/restore and CSV export of transactions.
- **Installable (PWA)**: Add to Home Screen on Android/iOS, works offline after the first load, and supports dark mode.

## Run it

- **On a computer:** open `index.html` in Chrome or Edge.
- **On your phone:** host the folder on HTTPS, for example GitHub Pages:
  1. Push this folder to a GitHub repo
  2. Go to Settings → Pages → Deploy from branch `main` / root
  3. Open `https://<you>.github.io/<repo>/` on your phone, then use **Add to Home Screen**

> Login and encryption need a secure context (`https://` or a local file). Opening the app over plain `http://` on a LAN IP will not work.

## Where the data lives

Data is stored **in the browser on each device** (localStorage) and is encrypted per user. That means:

- Different people on the **same** phone each log in with their own ID and see only their own data.
- The **same** person on two devices does **not** sync automatically. Use *Profile → Download backup* on one device and *Restore from backup* on the other.
- **Forgotten passwords can't be reset.** The data is unreadable without the password, so take backups.

For real cross-device sync with server accounts, the next step would be a backend such as Firebase Auth + Firestore. `Vault` in `js/data.js` is the only place that would need to change.

## Upgrading from the old 2-account version

The first new user created on a browser that still has old `expenseApp_*` data sees a tick box: **"Bring over data from the previous version"**. Account 1 and Account 2 become named accounts (Account 2 becomes Main), and old paired transfer entries are merged into single transfers. The previous code is kept in `_v1-backup/`.

## Project structure

```
index.html          App shell: login screen, views, bottom sheet
css/style.css       Mobile-first styles (bottom tabs on phone, side rail on desktop), dark mode
js/data.js          Categories, Vault (login + encryption), Legacy migration, Calc (balances, savings, carry forward)
js/app.js           Views, forms, charts (Chart.js)
manifest.json       PWA manifest
sw.js               Service worker (offline cache)
icons/icon.svg      App icon
appsheet-templates/ CSV templates if you prefer building it in AppSheet instead
```
