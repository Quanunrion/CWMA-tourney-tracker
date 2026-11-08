# CWMA Tourney Tracker

A browser-based platform for running karate tournaments. One machine (usually the front desk) runs a small server that holds the **master list** of competitors, divisions, rings, and results. Every other device opens a web page on the same network:

| Screen | URL | Who uses it |
|---|---|---|
| Front Desk & Admin | `/frontdesk` | Check-in, walk-ins, divisions, rings, PINs, results corrections, exports |
| Ring | `/ring` | One per ring: runs brackets, writes in competitors, calls missing competitors |
| Display Control | `/display` | Display operator: approves/queues slides, goes live, designs slide looks |
| Display Output | `/output` | The projector/TV (second monitor). Double-click for full screen |
| Ring Status Board | `/status` | Read-only: what each ring is doing, on deck, "where do I go?" lookup |
| Print | `/print` | Paper backup bracket sheets, rosters and results |

## Running it

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start          # http://localhost:3000 — the console prints the address other devices should use
```

Try it with sample data first:

```bash
npm run demo       # demo tournament: admin/display PIN 1234, ring PINs 1111 / 2222 / 3333
```

The default admin and display PIN is **1234**. Change it under Front Desk → Settings. Ring PINs are generated automatically and shown on the Rings tab. The admin PIN also unlocks any ring or the display.

Options: `PORT=8080 npm start` changes the port; `DATA_DIR=/some/folder npm start` changes where data is kept (default `./data`).

## Tournament day workflow

1. **Before the event (front desk):** Settings → name, date, logo. Competitors → *Import CSV* from the registration site (first/last name or name, age, sex, belt: beginner / intermediate / advanced / black belt; dojo optional). Rings → add rings. Divisions → create them one by one, or with *Bulk add* (paste CSV). Use the criteria (age, sex, belts) to get suggested competitors, then assign each division to a ring and order the ring's schedule.
2. **Check-in:** search a name, tap *Check in*. The panel shows every division and ring the competitor needs to go to. Walk-ins are added with *＋ Walk-in* (payment is handled in the separate payment system).
3. **Rings:** sign in with the ring's PIN. Pick the division, mark anyone absent, then *Start → draw bracket*. Tap a name to mark the winner, and tap again to undo. 📢 next to a name sends a *missing competitor* request to the display. *Add / write in competitor* adds someone from the master list or writes in a new person. Written-in competitors are flagged for the front desk. When finished, check the final places and press **Submit results**.
4. **Display:** awards land in the queue automatically when a ring submits. Missing-competitor requests wait under *Needs approval*. Click an item to preview it, then press **Go live** (or Space). **L** returns to the logo. Use ▲▼ to reorder, ✓ to skip, ✕ to remove, *Requeue* to show something again.
5. **Mistakes:** the ring presses *Reopen / fix results*, which pulls the division's award slide from the queue until the ring resubmits. The front desk can also correct places directly under *Results → Fix*. Slides always show the latest results.

## Features

- **Division formats** (chosen per division): single elimination with byes, a 3rd-place match or ring-chosen 3rd; round robin with standings; judged kata (3 judges by default, straight total, no drops); manual placement. The bracket draw keeps same-dojo competitors apart where possible.
- **Results** record 1st, 2nd and 3rd. Award slides show 1st and 2nd (3rd is optional); grand championship divisions show a *Grand Champion* slide.
- **Recording points:** match scores and penalties (`bracket.setScore`) and per-judge kata scores are stored. Rings currently only tap winners; entering points is optional.
- **Withdrawals / DQ:** the opponent advances automatically. Editing an earlier match clears the later results that depended on it.
- **Divisions** can be merged, split, duplicated, moved between rings, and reordered on the fly.
- **Slide design:** for each slide type you can set colors, background image, fonts, sizes, logo position, text templates (`{division}`, `{ring}`) and the transition, with a live preview. Custom/sponsor slides and an idle rotation are included.
- **Sync & offline:** every device updates live. If a ring loses Wi-Fi it keeps working, shows "Offline · N unsent", and syncs automatically when the connection returns (keep the tab open).
- **History:** every change is logged with time, device role and ring (Front Desk → History).
- **Exports:** results CSV, medal count by dojo, competitors CSV, full JSON backup and restore. Automatic backups are saved every 5 minutes to `data/backups`.
- **Placeholders** for payment status, waiver and phone (for future text notifications) exist on each competitor record.

## How it's built

```
shared/   model.js (data shapes), reducer.js (every change = a command), bracket.js (draws & scoring)
server/   index.js (Express + Socket.IO), store.js (JSON file persistence, PINs, audit log), exports.js
public/   browser clients (Preact + htm, no build step), served by the server
test/     node --test unit tests for brackets and commands
```

Every change is a small *command* (e.g. `bracket.setWinner`). The server validates it, applies it to the master list, saves it, and broadcasts it. Each client runs the same `reducer.js`, so it applies its own changes instantly and stays in sync. Storage is isolated in `server/store.js`, so moving the master list to a hosted database later only means replacing that module.

```bash
npm test
```
