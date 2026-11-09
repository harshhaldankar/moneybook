# Connect MoneyBook to a Google Sheet (one time, about 5 minutes)

Only the person who owns the data (you) does this. Family members then just paste the link.

## 1. Create the Sheet and add the script
1. Open **https://sheets.new** and name the spreadsheet **MoneyBook Data**.
2. Click **Extensions → Apps Script**.
3. Delete everything in `Code.gs`, paste the full contents of [`Code.gs`](Code.gs) from this folder, then click **Save** (💾).

## 2. Run setup once
1. In the toolbar's function dropdown, pick **`setup`** and click **Run**.
2. Google asks for permission: **Review permissions** → choose your account → **Advanced** → **Go to MoneyBook (unsafe)** → **Allow**.
   ("Unsafe" only means the script isn't published by Google. It's your own script, running in your account.)
3. Go back to the Sheet. You'll see the tabs **Users, Accounts, Transactions, Recurring, Budgets, Settings**. A daily 6 AM job is now set up to record auto-debits (SIP, EMI, rent…).

## 3. Deploy it as a web app
1. In Apps Script, click **Deploy → New deployment**.
2. Click ⚙️ next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**.
4. Click **Deploy** and copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy…/exec`.

## 4. Connect the app
- **Android app or website:** paste that URL on the **Connect your Google Sheet** screen, then create your login.
- **Family members:** in MoneyBook go to **More → Auto-Capture & Reminders → Family** and copy the link for them. Each person creates their own User ID and password, and sees only their own data in the app.

## Updating the script later
Paste the new `Code.gs`, then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The URL stays the same.

## Good to know
- **Who can see what:** each user sees only their own data in the app. As the Sheet owner, **you can see every user's rows in the Sheet**. Don't share the Sheet itself with anyone.
- "Anyone" access means the link can be reached without a Google login, but every request still needs a valid MoneyBook User ID and password (passwords are stored hashed, never in plain text).
- You can browse and filter your data directly in the Sheet. Avoid editing the `id`, `userId` and `token` columns by hand.
