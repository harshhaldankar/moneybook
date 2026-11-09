# MoneyBook — Expense & Savings Manager

An Android app (plus website) for tracking multiple bank accounts, spending and monthly savings. It captures bank SMS and UPI payments automatically, sends reminders, and keeps your data in your own Google Sheet.

## Features

- **Auto-capture (Android):**
  - Bank debit/credit SMS and payment alerts from GPay, PhonePe, Paytm, BHIM and bank apps become transactions you save with one tap.
  - OTPs, personal messages, offers, bill reminders and failed payments are ignored and never stored.
  - The app learns each merchant's category, and can save known merchants automatically.
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
 ├─ SmsReceiver + PaymentNotificationListener              │
 │    └─ TxnParser (drops OTPs, keeps only amount,         │
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
   - Turn on auto-capture under **More → Auto-Capture & Reminders**.
3. **Website (optional):** https://harshhaldankar.github.io/moneybook/

> Reading SMS isn't allowed for apps on the Play Store, so MoneyBook is installed directly from the APK. It only uses `RECEIVE_SMS` (new incoming messages). It cannot read your existing inbox.

## Development

```
npm install
npm run sync          # copy web files to www/ and into the Android project
```

- **Every push to `main`:**
  - GitHub Actions runs the SMS parser unit tests, builds the APK and publishes it as a new release.
  - GitHub Pages updates the website.
- **Signing:** to keep updates installable over each other, add the repo secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD`. Without them, CI builds a debug-signed APK.

## Project structure

```
index.html, css/, js/       Web UI (shared by website and APK)
  js/data.js                Categories, Api + Store (Sheet sync, offline queue), Capture matching, Calc
  js/native.js              Android bridge: captures, reminders, back button
  js/app.js                 Views and forms
apps-script/                Google Sheets backend + setup guide
android/                    Capacitor Android project
  app/src/main/java/in/moneybook/app/capture/   SMS + notification capture (TxnParser is unit-tested)
.github/workflows/          APK build + release
scripts/build-web.js        Copies web files into www/ for Capacitor
```
