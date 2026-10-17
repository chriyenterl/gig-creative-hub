# GIG Creative Hub

One central place for your marketing media — instead of juggling Google Sheets, Docs and Drive.

| Area | What it does |
|---|---|
| **Dashboard** | Totals at a glance: how much content you have, what's waiting for approval, what's been used vs. not used (photos and videos separately), content per season, and your talent pipeline. |
| **Review** | Everything creators upload lands here. Approve it, request changes, or reject it — with a team-only note. |
| **Library** | Every file in one searchable grid, split into **Final content**, **Raw footage** and **Brand kit** (logos, mascot, guidelines…). Filter by type, season, approval, used/not used, talent or tag. Download, copy a share link, or **mark as used** (where + when). Bulk-edit many at once. Export the list to CSV. |
| **Seasons** | Content sorted by campaign season (starts with New Year, Valentine's Day, Back to School and Christmas & Holidays), plus **Evergreen** for regular any-time content. Add, rename, recolour and reorder seasons. |
| **Talents** | Scout and track influencers: platforms, followers, **tier** (Nano UGC / Micro KOL…), **type**, **brand**, **languages**, rates, contact, notes — and a clear **decision** status (Prospect → Contacted → Awaiting approval → Approved – go ahead → In production → Delivered, or Not proceeding). Switch between a **table** and a **board** (drag cards between statuses). **Import your list from Notion** or any CSV. |
| **Upload links** | Give each creator their **own private link**. They see only an upload page — nothing else. You can **disable**, **change** (new address, old one stops working), set an **expiry**, or **delete** each link at any time. |

| **Print Hub** | A second app — **GIG Print Hub** (sidebar → **Print Hub**) for print orders. Customers fill in your order form through one shared link; staff see **New → Pending → Completed**, open any order for full details and artwork, add internal notes, and print a job sheet. Your bot is notified when a **new order** comes in and when an order is **completed**, so it can message the customer (e.g. “ready for pickup”). |

---

## How it's hosted

| Part | Where | Cost |
|---|---|---|
| The website (this folder) | **GitHub Pages** | Free |
| Files (videos, photos, logos, artwork…) | **Cloudflare R2** | First 10 GB free, then about US$0.015 per GB a month (100 GB ≈ US$1.50, 1 TB ≈ US$15). No download fees. |
| Data (talents, links, approvals, usage, print orders…) | **Cloudflare D1** database | Free (up to 5 GB — that's millions of rows) |
| The server that connects them | A **Cloudflare Worker** ([`cloudflare/worker.js`](cloudflare/worker.js)) | Free (up to 100,000 requests a day) |

Cloudflare needs a payment card on file before it turns on R2, even though the first 10 GB are free.
**The app stops new uploads at 10 GB** (change the limit in **Settings → Storage**), so you're never charged unless you raise it.
Files are stored in tidy folders: *final/*, *raw/*, *brand/*, *creators/&lt;creator&gt;/*, *print/*.

> Prefer Google Drive + Sheets (no card needed) or Supabase? Both are still supported — see the
> [alternatives](#alternative-google-drive--google-sheets) at the end.

---

## Try it right now (demo mode)

With `config.js` left empty, the app runs in **demo mode** with sample data saved only in your browser.
To open it on your computer, run this inside this folder, then visit http://localhost:8000:

```bash
python3 -m http.server 8000
```

(Double-clicking `index.html` won't work — browsers block it. It needs to be served, like above.)

---

## Going live on Cloudflare + GitHub — step by step

### 1. Cloudflare account and file storage
1. Create a free account at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. In the dashboard's left menu open **R2 Object Storage** and turn it on. Cloudflare asks for a payment card here — the
   first 10 GB each month are free.

### 2. Install Node.js (once)
Download the **LTS** version from [nodejs.org](https://nodejs.org) and install it. It gives you `npx`, which runs
Cloudflare's own tool, **wrangler**.

### 3. Create the storage, the database and the server
In Terminal, inside this folder's `cloudflare` folder:

```bash
npx wrangler login
```
(A browser window opens — click **Allow**.) Then:

```bash
npx wrangler r2 bucket create gig-hub-files
```
```bash
npx wrangler d1 create gig-hub
```
The second command prints a `database_id`. Paste it into [`cloudflare/wrangler.toml`](cloudflare/wrangler.toml)
in place of `PASTE-YOUR-D1-DATABASE-ID-HERE`. Then publish the server:

```bash
npx wrangler deploy
```
It prints your server's address, like `https://gig-hub-api.yourname.workers.dev`. Open it in a browser — it should say
*"The GIG Creative Hub backend is running"*. The database tables are created automatically on first use.

### 4. Connect the website
Open [`config.js`](config.js) and paste that address:
```js
CLOUDFLARE_API_URL: 'https://gig-hub-api.yourname.workers.dev',
```

### 5. Put the website on GitHub Pages
1. Create a new repository on [github.com/new](https://github.com/new) (e.g. `gig-creative-hub`, **Public**, no README).
2. Upload everything in this folder (or push it with git).
3. In the repo: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
4. After a minute the site is live at `https://<your-username>.github.io/gig-creative-hub/`.

### 6. Create your admin account
Open the site. The first time, it asks you to **create the admin account** (your email + a password).
Do this straight away — the first person to open it becomes the owner.
Then share the **join link** with your team (Print Hub → Links & access → Team): each person types their name and picks a
6-digit passcode, you approve them, and they sign in with name + passcode — no email needed. Other **owners** (who can
manage everything) can be added in **Settings → Owners** with an email and a temporary password.

**Updating the server later:** run `npx wrangler deploy` again in the `cloudflare` folder. The address stays the same.

### Passcode reset emails (so the team can reset forgotten passcodes themselves)
Emails are sent through **Resend** (free for 3,000 a month) from an address on **your own domain**:
1. Create an account at [resend.com](https://resend.com) → **Domains → Add domain** → add the DNS records it shows at your
   domain's provider (or in Cloudflare if your domain is there) and wait until it says **Verified**.
2. In [`cloudflare/wrangler.toml`](cloudflare/wrangler.toml) set `MAIL_FROM` (e.g. `"GIG <noreply@yourdomain.com>"`) and check
   `SITE_URL` is your website's address.
3. Make an API key in Resend, then in the `cloudflare` folder run `npx wrangler secret put RESEND_API_KEY`, paste the key,
   and run `npx wrangler deploy`.

Until then, “Forgot your passcode?” tells people to ask you, and you use **Reset passcode**.

---

## Everyday use

**Send a creator an upload link** — Upload links → **New upload link** → pick the talent (optional), the season their files belong to, and a message
("Please upload the final cut in 9:16…"). The link is copied — paste it to them on WhatsApp / email / DM.
They only see an upload page. Their files land in **Review** (and in their own folder in storage).

**Stop a link**
- **Disable** — pauses it (you can enable it again).
- **Change link** — new address; the old one stops working immediately. Use this if a link was forwarded.
- **Delete** — removes it for good. Files already uploaded always stay.
- **Expires on** — set a date and it switches off by itself.

**Move your talent list from Notion** — in Notion open the talent database → **•••** → **Export** → **Markdown & CSV**, unzip it.
In the app: Talents → **Import from Notion / CSV** → drop the `.csv` file. Columns are matched automatically (you can change any);
handles are read from profile links, and talents already in the app are skipped. Works with Google Sheets / Excel CSVs too.

**Approve content** — Review → Approve / Request changes / Reject.

**Reuse content** — Library → filter e.g. *Approved* + *Not used yet* + a season → open an item → **Download**,
then **Mark as used** with where it went. The dashboard's used / not-used numbers update automatically.

**Deleting** an item removes its file for good on Cloudflare (on the Google version it goes to Drive's **Trash** for 30 days).

---

## Print Hub

Open it from the Creative Hub sidebar (**Print Hub**). Owners signed in to the hub with a password have **master** access.

| Link | For | Can do |
|---|---|---|
| **Customer order link** — `print/order.html#…` | All customers (one shared link) | Fill in the order form, attach artwork, submit, get an order number |
| **Print Hub admin link** — `print/index.html#k=…` | Your team (one shared link, no sign-up) | Work on print orders: see, add and move orders, notes, job sheets |
| **Creative Hub admin link** — `index.html#k=…` | Your team (one shared link, no sign-up) | The whole Creative Hub, with the Print Hub in its menu |
| **Join link** — `join.html#…` | Your team (one shared link) | Ask to join with their name + a 6-digit passcode; you approve each person as **Print Hub only** or **Print Hub + Creative Hub** |
| **Master link** — `print/index.html#k=…` | You | Everything, plus: edit the order form, links & bot settings, delete orders |

All of them are in **Print Hub → Links & access** (master). The admin links, the join link and the team list are also in the
**Creative Hub → Links & access** (owners), so you can manage your team from either app.

**Admin links (quickest — no sign-up):** send the **Print Hub admin link** or the **Creative Hub admin link** to your team.
Whoever opens one is asked their name once (kept on their phone, shown in the order history) and is straight in. They can do the
everyday work but can't change settings or manage the team. Because it's one shared link, **Change link** (everyone using the old
one is signed out) or **Disable** it if it's passed around too widely. For individual sign-ins you can turn off one person at a
time, use the join link + passcode below instead.

**Your team — join link + passcode (no email):**
1. Share the **join link** in your team group. A new person opens it, types their **name**, their **email** (only used if they
   forget their passcode) and picks a **6-digit passcode**.
2. You get a notification (“Ali wants to join”) and the request appears under **Waiting for approval** — tap
   **Approve — Print Hub only**, **Approve — Print Hub + Creative Hub**, or **Decline**.
3. They sign in on any phone or computer with **name + passcode** (sign-in page → **Team** tab, or the Print Hub's welcome
   screen). Print-Hub-only people go straight to the Print Hub; the others get the Creative Hub with the Print Hub in its menu.
   Their name shows in the menu and in order history (“by Ali”).
- **Forgot passcode?** They tap **Forgot your passcode?** on the sign-in screen, type their email and get a link (valid 30 minutes)
  to choose a new one — no need to ask you (needs email sending, see *Passcode reset emails* below). You can still tap
  **Reset passcode** next to their name to make a new one yourself; either way their other sign-ins end. They can change their
  passcode and email any time (Settings → My account, or **Change my passcode** in the Print Hub menu).
- **Remove access:** **Turn off** (temporary — turn on again any time) or **Remove** (for good). Either way they're signed out on
  every device straight away and their phone stops getting order alerts.
- Also per person: **Add Creative Hub / Make Print Hub only**, **Rename** (that's the name they sign in with), and **Copy sign-in
  link** (a personal link that signs them in without a passcode — handy for a shared shop computer).
- Team members can do the everyday work; **only owners (email + password) can manage the team, the storage limit and Print Hub
  settings**. Wrong passcodes lock that name for 15 minutes after 5 tries. Turn the join link off or **Change link** if it's
  shared too widely — people already on the team aren't affected.

The customer link can be changed or disabled; the master link can be changed. A link is remembered on the device it's opened on; "Forget this link" signs it out.

**Order form:** **Order form** page (master). The default form asks: name, company, phone/WhatsApp, what to print, quantity,
**size**, **paper type** (hard card / normal / not sure), **lamination** (only shown when the item isn't stickers or a banner),
**do you have a design ready?** — *Yes* shows a design upload, *No* shows a box to describe the design **or record a voice note
(up to 5 minutes)** — then the due date and any notes. You can add, remove, reorder and edit questions: short answer, paragraph,
number, email, phone, date, dropdown, buttons, checkboxes, file upload, or text-or-voice-note; mark them required; set
**"Only show this question when…"** another answer is (or isn't) one of the choices you pick; and choose "Show in order list as"
(customer name, company, phone, email, what they ordered, quantity, due date). Changes only affect new orders.
Voice notes play right inside the order page (and are saved with the artwork).

**Adding an order yourself** (walk-in, phone or WhatsApp customers): **New order** on the Overview or any order list. It's the
same form customers fill in, but only the customer's name or phone is needed, you can attach their artwork, start it as **New**
or **Pending**, add internal notes, and choose whether your bot sends them the “order received” message. Everyone else on the
team gets the new-order alert (not the person who added it), and the history shows “Order added · by Ali”.

**Messaging customers on WhatsApp (no bot needed):** every order has a green **WhatsApp** button — *“order received”* on
new orders and *“ready for pickup”* on completed ones. It opens WhatsApp (phone or WhatsApp Web) with the customer's number and
your message already typed; you just press Send. It's free and sent from your own WhatsApp. Each tap is noted in the order's
history. Edit both messages in **Links & access** (tags like `{name}`, `{order_no}`, `{item}`, `{due}` are filled in automatically).
Local numbers like `012-345 6789` get the country code from `WHATSAPP_COUNTRY_CODE` in `config.js` (default `60`, Malaysia).

**Automatic messages through your bot:** in **Links & access → Bot connection**, paste your bot's link (a webhook URL,
`https://…`). The app tells the bot when a **new order** comes in (`"event": "order.created"`) and when an order is **completed**
(`"event": "order.completed"`), each with its own on/off switch. Every call includes `message` (your customer message from
**Customer messages**), `team_message` (a short alert for your team's group), the customer's name and phone, the order number,
all answers and artwork links. **Show what the bot receives** shows the exact JSON; **Test** sends a sample marked
`"test": true`; an optional secret is sent as the `X-Webhook-Secret` header. Each order's history shows whether the bot was
reached, with **Send to bot again** buttons. Any bot or tool with a webhook link works (Make, Zapier, n8n, a WhatsApp/Telegram
bot platform…). Note: bots that send WhatsApp messages officially still go through Meta's WhatsApp Business Platform, so
Meta's per-message fees and one-time template approval apply there.

**New-order alerts** (push notifications — Links & access → New-order alerts shows which devices get them):
- The first time someone opens the Print Hub on a device (their team link, the master link or from the Creative Hub) it asks
  *“Get alerted when a new order comes in?”* — one tap on **Turn on alerts** (and **Allow**) and that device gets a notification
  for every new order, **even when the app is closed**. Each order is its own notification and it **stays in the notification
  centre until it's opened or swiped away**, like a WhatsApp message (on computers it also stays on screen until clicked).
  A test notification arrives straight away to confirm it works. Tapping a notification opens that order.
  Switch it on/off any time with **New-order alerts** at the bottom of the menu. Nobody can switch this on for someone else.
  - **iPhone / iPad:** needs iOS 16.4 or newer, and the Print Hub must be **added to the Home Screen** first (Share → Add to
    Home Screen) — turn alerts on inside that app. To keep the banner on screen until it's dismissed: Settings →
    Notifications → GIG Print Hub → Banner Style → **Persistent**.
  - **Android:** works in Chrome (installing the app is optional). **Computers:** Chrome, Edge, Safari and Firefox.
  - **Sound:** the phone's own notification sound (websites can't ship a custom sound). On Android you can pick a different
    tone for these alerts in the phone's notification settings for Chrome / the site. While the Print Hub is open it also
    plays its own chime.
  - Turning off, changing or deleting someone's team link also stops alerts to their devices; you can also stop alerts on
    any device from Links & access.
  - Push notifications are sent by your own Cloudflare server (free, no extra account). On the Google version, alerts only
    appear while the Print Hub is open. The tab title also shows the count, e.g. “(2) GIG Print Hub”.
- **Bot:** post the `team_message` to your team's WhatsApp or Telegram group.

**Install it as an app on your team's phones and computers** — no app store needed. Both the Creative Hub and the Print Hub
have an **Install app** button at the bottom of the menu (it disappears once installed):
- **iPhone / iPad (Safari):** Share button ⬆︎ → **Add to Home Screen** → **Add**. The first time the installed app opens, it asks
  for the team or master link — paste it once and it's remembered (iPhone keeps home-screen apps separate from Safari).
- **Android (Chrome):** tap **Install app** in the menu, or ⋮ → **Install app**.
- **Computer (Chrome / Edge):** the install icon at the right of the address bar. **Mac Safari:** File → **Add to Dock**.

The app opens full-screen with its own icon and shows the live order list, and new-order notifications arrive even when
it's closed (see *New-order alerts* above). The icon shows a **number** — how many orders are waiting in *New* — like an unread
count (iPhone/iPad with alerts on, Android launchers that support it, and computers).

Artwork and voice notes are stored in the **print/** folder of your file storage; orders are in the **print_orders** table.
The Print Hub works with the Cloudflare or Google setup (or demo mode) — not with the Supabase option.

## Good to know (Cloudflare version)

- **Speed:** saves take a fraction of a second. Big videos upload in 10 MB pieces, and a piece that fails is retried
  automatically. Keep the page open until an upload finishes.
- **File links:** so previews, video playback and downloads work in the app, each file has its own long, random address
  (only shown inside the app). **Copy share link** gives that address — anyone you send it to can view the file.
- **Storage limit:** **Settings → Storage** shows how much is used. The dashboard warns from 80% full; at the limit
  (10 GB to start) new uploads stop — for the team, creator links and print orders — until you delete old files or raise it.
  Cloudflare's own view is under **R2 Object Storage → gig-hub-files**.
- **Limits:** the free plan allows 100,000 server requests a day — plenty for a team. If you ever hit it, Cloudflare's
  Workers Paid plan (US$5/month) lifts it.

## Good to know (Google version)

- **Speed:** each save takes about 1–2 seconds (that's Google Apps Script). Uploads go straight to Drive when possible; otherwise they're passed through the script in 4 MB pieces — slower, but reliable. Keep the page open until an upload finishes.
- **Previews:** so previews, video playback and downloads work inside the app, uploaded files are shared as **"Anyone with the link can view"**. The links are long random codes that are only shown inside the app. To turn this off, set `SHARE_FILES_BY_LINK = false` at the top of `Code.gs` (previews then only work for people signed in to Google with access to the folder).
- **Brand-new videos** can take a few minutes before Google Drive can play them (it's processing them).
- **Company Google Workspace accounts:** some admins block "Who has access: Anyone" or link sharing. If so, use a regular Gmail account to own the Sheet and files.
- **Storage:** 15 GB free per Google account (shared with Gmail and Photos). Check usage at [drive.google.com/settings/storage](https://drive.google.com/settings/storage).

## Security

- Only people on the **Team members** list can sign in to the team app. Passwords are stored hashed (never in plain text), and every request is checked by the script.
- A private upload link can only **add** files to its own folder while it's active. It can't see, open or delete anything, and it only shows the creator the titles/status of what *they* sent.
- Send each link only to its person, and use **Change link** if one leaks.

---

## Customising

- **Name & logo** — `config.js` (`BRAND_NAME`, `LOGO_URL`).
- **Seasons** — in the app (Seasons page).
- **Talent statuses / platforms / "where used" options** — the lists at the top of `js/util.js`.
- **Colours** — the variables at the top of `css/styles.css` (light and dark mode).

## What's in this folder

```
index.html                  Team app (login required)
upload.html                 Creator upload page (opened via a private link)
join.html, js/join.js       Join page: new team members ask to join with name, email + passcode
reset.html, js/reset.js     Forgot passcode: emailed link → choose a new one
config.js                   Your settings — the only file you must edit
css/styles.css              Look & feel (light + dark mode, mobile friendly)
js/app.js, js/views/*.js    The screens
js/backend-cloudflare.js    Connection to the Cloudflare server
js/backend-google.js        Connection to Google Drive + Sheets
js/backend-demo.js          In-browser demo data
js/backend-supabase.js      Optional Supabase connection
print/index.html            Print Hub — staff app (admin & master)
print/order.html            Print Hub — customer order form
print/sw.js                 Lets new-order pop-ups work on Android phones
manifest.json, print/manifest.json   Make both apps installable (home-screen icon, full-screen)
icons/                      App icons
js/print/*.js               Print Hub screens and rules
cloudflare/worker.js        The Cloudflare server (files in R2, data in D1)
cloudflare/wrangler.toml    Its settings for the wrangler tool
google-apps-script/Code.gs  Alternative: Google backend — paste into Apps Script
supabase/schema.sql         Only needed for the Supabase option
```

No build step, no npm: plain files that any static host can serve.

---

## Alternative: Google Drive + Google Sheets

Free, no card needed — files live in a Google Drive (15 GB free per account). Setup takes about 15 minutes.

Use the Google account that should **own** the files (a shared company account is ideal).

### 1. Create the Sheet and paste the script
1. Go to [sheets.new](https://sheets.new) to create a new Google Sheet. Name it e.g. **GIG Creative Hub — data**.
2. In the Sheet: **Extensions → Apps Script**. A code editor opens.
3. Delete what's there, then copy **everything** from [`google-apps-script/Code.gs`](google-apps-script/Code.gs) and paste it in. Click **Save** (💾).

### 2. Run the setup once
1. At the top of the editor, pick the function **`setup`** in the dropdown, then click **Run**.
2. Google asks for permission → **Review permissions** → choose your account.
   You'll see *"Google hasn't verified this app"* — that's normal for your own scripts. Click **Advanced → Go to … (unsafe)** → **Allow**.
   (It needs access to your Sheets and Drive to store data and files, and to connect to Google's upload service.)
3. When it finishes, your Sheet has new tabs (seasons, talents, assets…) and your Drive has a **GIG Creative Hub files** folder.

### 3. Publish it as a web app
1. Click **Deploy → New deployment**. Click the ⚙️ next to "Select type" → **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**. (Anyone is needed so creators without Google accounts can upload through their links — the script itself checks every request.)
3. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

### 4. Connect the website
Open [`config.js`](config.js), leave `CLOUDFLARE_API_URL` empty, and paste the URL:
```js
GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfy…/exec',
```

### 5. Put the website on GitHub Pages
1. Create a new repository on [github.com/new](https://github.com/new) (e.g. `gig-creative-hub`).
2. Upload everything in this folder (**Add file → Upload files**, drag it all in, **Commit**).
3. In the repo: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
4. After a minute the site is live at `https://<your-username>.github.io/gig-creative-hub/`.

### 6. Create your admin account
Open the site. The first time, it asks you to **create the admin account** (your email + a password).
Do this straight away — the first person to open it becomes the owner.
Add teammates later in **Settings → Team members** (you give each a temporary password).

**Updating the script later:** after pasting a newer `Code.gs`, go to **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The URL stays the same.

---

## Alternative: Supabase

Faster and fully private files, but video use needs the paid plan (~$25/month; free plan: 1 GB, 50 MB per file).
1. Create a project at [supabase.com](https://supabase.com); in **SQL Editor** run all of [`supabase/schema.sql`](supabase/schema.sql).
2. **Authentication → Users → Add user** (tick *Auto Confirm*), then run
   `insert into public.team_members (email, name) values ('you@company.com', 'Your Name');`
3. **Authentication → Sign In / Providers →** turn off *Allow new users to sign up*.
4. Put the **Project URL** and **publishable/anon key** in `config.js` (leave `GOOGLE_SCRIPT_URL` empty).
5. **Authentication → URL Configuration →** set the Site URL to your GitHub Pages address.
