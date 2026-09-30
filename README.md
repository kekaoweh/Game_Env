# Game_Env

**Play now:** https://game-env.onrender.com

(Free-tier host — if nobody's played in a while, the server sleeps and the
first load can take 30-60s to spin back up.)

A real-time, server-backed multiplayer arena game.

Players move a circle around a shared world, eating orbs to grow and eating
smaller players on contact — bigger players move slightly slower, so growth
is a trade-off.

## How you win

Each round runs on a clock, and ends the instant either condition is hit:

- **Score race:** first player to reach **150 points** wins immediately.
- **Clock:** if nobody hits 150, the round ends after **5 minutes** and
  whoever has the most points wins.

When a round ends, everyone sees the winner and the top 5 standings for 8
seconds, then scores and positions reset and the next round starts
automatically — no need to reconnect. All three numbers (target score, round
length, intermission length) are configurable via `WIN_SCORE`,
`ROUND_DURATION_MS` and `INTERMISSION_MS` environment variables on the server.

## Stack

- `game/server` — Node.js + Express + Socket.IO authoritative server. Runs the
  game loop (30 Hz), tracks all players and orbs, and broadcasts world state.
- `game/public` — Static HTML5 canvas client. Connects over WebSocket, sends
  movement input, renders the server's state.

## Running it

```bash
cd game
npm install
npm start
```

Then open `http://localhost:3000` in a browser. Open it in multiple tabs/
windows (or from other machines on the network) to play against others.

## Smoke test

`game/smoketest.mjs` is a scripted Socket.IO client that joins, drives toward
an orb, and asserts that the player moves and its score increases — a quick
way to confirm the server is behaving after a change, without a browser:

```bash
cd game
node smoketest.mjs
```
