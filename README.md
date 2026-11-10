# MoneyBook — Expense & Savings Manager

An Android app (plus website) for tracking multiple bank accounts, spending and monthly savings. Add a bank SMS in two taps with **Share → MoneyBook**, get reminders, and keep your data in your own Google Sheet.

## Features

- **Share a bank SMS (Android):**
  - Long-press a debit/credit SMS → **Share → MoneyBook**. Amount, account (by last 4 digits), merchant and category are filled in; tap Save.
  - MoneyBook has **no SMS or notification permission**. It only sees what you share. OTPs, offers, bill reminders and failed payments are refused, and the message text is never stored.
  - The app learns each merchant's category, and can save known merchants instantly.
- **Auto-debits without SMS:** SIP, EMI, rent and subscriptions are recorded by the Google Sheet on their debit day, with a reminder the day before.
- **Reminders:** a daily nudge for cash spends, auto-debit reminders, budget alerts at 80% and 100%, and a monthly savings summary.
- **Any number of bank accounts** with a Main account. Shows the total balance, the Main balance and the other accounts' balance.
- **Savings:** monthly target, carry forward month to month, a running ahead/behind-target total, a chart and a month-on-month table.
- **Logins per person:** each family member has their own User ID and password, and sees only their own data.
- **Google Sheets database:** syncs across devices, works offline (changes upload when you're back online), and you can open your data directly in Sheets.
- Budgets, reports, CSV export and JSON backup.

## Architecture

```
Android APK (Capacitor)                              Website (GitHub Pages)
 ├─ web UI: index.html, css/, js/                     same web UI
 ├─ Share target ("Share → MoneyBook")                    │
 │    └─ TxnParser (refuses OTPs, keeps only amount,       │
 │       type, last 4 digits, merchant)                    │
 ├─ local notifications (reminders)                        │
 └─ offline cache + sync queue ───────────┬────────────────┘
                                          ▼
                      Google Apps Script web app (apps-script/Code.gs)
                       ├─ login, pull/push sync (per-user rows)
                       └─ daily trigger: records auto-debits
                                          ▼
                      Google Sheet: Users · Accounts · Transactions · Recurring · Budgets · Settings
```

## Setup

1. **Google Sheet backend:** follow [`apps-script/SETUP.md`](apps-script/SETUP.md) (one time, about 5 minutes).
2. **Install the Android app:**
   - Download **MoneyBook.apk** from the [latest release](https://github.com/harshhaldankar/moneybook/releases/latest) on your phone, open it, and allow "install unknown apps" when asked.
   - Paste your Sheet link, then log in.
   - Allow notifications under **More → Share SMS & Reminders**.
3. **Website (optional):** https://harshhaldankar.github.io/moneybook/

> The APK asks for only two permissions: **Internet** (to sync with your Sheet) and **Notifications** (reminders). Because it has no SMS or notification-reading access, Google Play Protect installs it like any normal app.

## Development

```
npm install
npm run sync          # copy web files to www/ and into the Android project
```

- **Every push to `main`:**
  - GitHub Actions runs the SMS parser unit tests, builds the APK and publishes it as a new release.
  - GitHub Pages updates the website.
- **Built-in Sheet link:** add the repo secret `APPS_SCRIPT_URL` (your web app link ending in `/exec`). The APK and website builds write it into the app, so nobody sees the Connect step. It never appears in the code; sign-ups are capped by the `MAX_USERS` script property (default 10).
- **Website:** deployed by the `Website` workflow (Settings → Pages → Source: **GitHub Actions**).
- **Signing:** to keep updates installable over each other, add the repo secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD`. Without them, CI builds a debug-signed APK.

## Project structure

```
index.html, css/, js/       Web UI (shared by website and APK)
  js/data.js                Categories, Api + Store (Sheet sync, offline queue), Capture matching, Calc
  js/native.js              Android bridge: captures, reminders, back button
  js/app.js                 Views and forms
apps-script/                Google Sheets backend + setup guide
android/                    Capacitor Android project
  app/src/main/java/in/moneybook/app/capture/   Share handling + TxnParser (unit-tested)
.github/workflows/          APK build + release
scripts/build-web.js        Copies web files into www/ for Capacitor
```
