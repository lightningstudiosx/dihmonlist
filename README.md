# Dihmon List

A demon list website: Main / Extended / Legacy lists, a page for every level (video, stats, position history, records),
a player leaderboard, public submissions for records and levels, and an admin page to approve them.

No dependencies. Needs Node.js 18 or newer.

## Run it on your computer

    ADMIN_PASSWORD=pick-something-long node server.js

(On Windows PowerShell: `$env:ADMIN_PASSWORD="pick-something-long"; node server.js`)

Then open http://localhost:3000. The admin page is at http://localhost:3000/#/admin.

## Put it online

Any host that runs Node works (Render, Railway, Fly.io, a VPS...):

- Start command: `node server.js`
- Environment variables:
  - `ADMIN_PASSWORD` - your admin password (the admin page is switched off without it)
  - `PORT` - most hosts set this for you
  - `DATA_FILE` - where to keep the data. Point it at a persistent disk (for example `/data/data.json` on Render
    with a disk mounted at `/data`). Free plans without a disk forget everything when they restart.
- Use the host's https address so your admin password isn't sent in the clear.

## Backups

On the admin page, **Export JSON** downloads everything (levels, records, submissions, hidden players).
**Import and replace** loads one of those files back. Export before big changes.

## How things work

- Anyone can submit a record or a level. Nothing shows up until you approve it on the admin page.
- Approving a level puts it at the position you choose; everything below moves down, and every level's
  position history records the change.
- Editing a level's position (with a reason) moves it and adds history entries.
- Players appear on the leaderboard once you approve one of their records. Hide a player to take them off it.
- Points: #1 is worth 350, falling off down the list, and nothing past #150. On the main list (top 75) a record
  at the level's list percent is worth a tenth of the full score, rising to the full score at 100%. Extended and
  legacy levels take 100% records only. Change `fullScore` / `recordScore` in server.js to use your own formula.
- Thumbnails come from the YouTube video, unless a thumbnail image link is given.
