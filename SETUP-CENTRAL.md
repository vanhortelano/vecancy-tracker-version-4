# Setup — Super Admin platform (separate "central" database)

Uses the **same Firebase project and API key** as the branch app (`firebase-config.js`),
but all Super Admin data lives in a second Firestore database named `central`.

## 1. Create the database
Firebase console → Firestore Database → database dropdown → **Add database** → ID: `central`
(use the same location as your default one). Firebase may ask you to enable billing (Blaze)
for extra databases; usage at this scale is normally within the free quotas.

Or from a terminal (recent firebase-tools): `firebase firestore:databases:create central --location=<your-location>`.
If the database is missing or its rules aren't published, `superadmin.html` shows these steps with
a button that opens the right console page and one that copies the rules for you.

## 2. Publish the rules
`firebase deploy --only firestore` (firebase.json now lists both databases),
or paste `central.rules` into the Rules tab of the `central` database.

## 3. Deploy the site
`firebase deploy --only hosting` so `superadmin.html` is online. Google sign-in needs the
hosted URL (not a `file://` page).

## 4. Make yourself the first Super Admin
1. Open `superadmin.html` and sign in with your existing account.
2. It will say "Not a Super Admin" and show your **user ID**.
3. In the console, `central` database → Start collection `superAdmins` → Document ID = that user ID,
   add any field (for example `role` = `super`). Reload the page.

Anyone can create an account in the branch app, so being signed in proves nothing:
only people listed in `superAdmins` get access, and `central.rules` enforces it on the server.

## 5. Marketing Viewers
`marketing.html` is a read-only directory. Any account that signs in can see it, but it only reads
`directory/*` records (dormitory name, location and bed counts). A record exists only while that
branch has **Directory** approved, and it is deleted when the branch revokes or disconnects.

## 6. Connect a dormitory
1. Branch Admin: **Central Link** tab → Generate pairing code (single use, 10 minutes).
2. Super Admin: **Dormitories** → enter the code and a purpose → Connect server.
3. Branch Admin approves or rejects **Directory** and **Analytics** separately.
4. While the branch admin is signed in to the branch app, vacancy counts sync every minute
   (when changed) and an analytics snapshot is stored about every 15 minutes.

Super Admin tabs: Overview, Dormitories, Trading (needs Analytics approval, history builds up from
approval onward), Inbox (branch decisions and sync alerts), Accounts (authorize/remove Super Admins,
disconnect branches), Server Details (read-only), Security (audit log).

Not built yet: Gmail sending, private room access ("View this dormitory"), live session kick/block
(needs a server), two-factor sign-in, server shutdown/change approval workflow.
