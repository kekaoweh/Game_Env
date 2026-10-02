import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const WORLD = { width: 3000, height: 3000 };
// Only same-color orbs are collectible now (see the eat loop below), so the
// field carries more orbs than before to keep enough of your color around.
const MAX_ORBS = 350;
const ORB_RADIUS = 6;
const BASE_RADIUS = 16;
const SPEED = 260; // px/sec at base size
const EAT_MARGIN = 1.15; // must be 15% bigger to eat another player
const TICK_HZ = 30;

// Orb pickup feel: eating registers well before you visually overlap an orb
// (PICKUP_BONUS widens the hit radius), and any orb within ATTRACT_RADIUS
// gets pulled toward the nearest player each tick instead of sitting still —
// together this makes collecting feel snappy instead of requiring a precise hit.
const PICKUP_BONUS = 20;
const ATTRACT_RADIUS = 160;
const ORB_ATTRACT_SPEED = 480; // px/sec

// Win conditions: a round ends the instant someone hits WIN_SCORE, or when
// the clock runs out — whichever comes first. Highest score wins the round.
const WIN_SCORE = Number(process.env.WIN_SCORE) || 100;
const ROUND_DURATION_MS = Number(process.env.ROUND_DURATION_MS) || 3 * 60 * 1000; // 3 minutes
const INTERMISSION_MS = Number(process.env.INTERMISSION_MS) || 8 * 1000; // pause between rounds showing the winner

let roundStartedAt = Date.now();
let intermissionUntil = 0; // 0 = round is live; otherwise timestamp when next round starts
let dotsEatenThisRound = 0;

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

/** @type {Map<string, {id:string,name:string,x:number,y:number,r:number,color:string,score:number,dx:number,dy:number,alive:boolean}>} */
const players = new Map();
/** @type {Map<string, {id:string,x:number,y:number,color:string}>} */
const orbs = new Map();

let orbSeq = 0;
function randColor() {
  const hues = ["#e8593a", "#2fb673", "#3b82f6", "#f5b53a", "#a855f7", "#ec4899", "#14b8a6"];
  return hues[Math.floor(Math.random() * hues.length)];
}
function spawnOrb() {
  const id = "o" + orbSeq++;
  const orb = {
    id,
    x: Math.random() * WORLD.width,
    y: Math.random() * WORLD.height,
    color: randColor(),
  };
  orbs.set(id, orb);
  return orb;
}
for (let i = 0; i < MAX_ORBS; i++) spawnOrb();

function radiusForScore(score) {
  return BASE_RADIUS + Math.sqrt(score) * 2.2;
}

function startNewRound() {
  roundStartedAt = Date.now();
  intermissionUntil = 0;
  dotsEatenThisRound = 0;
  for (const p of players.values()) {
    p.score = 0;
    p.x = Math.random() * WORLD.width;
    p.y = Math.random() * WORLD.height;
    p.alive = true;
  }
  orbs.clear();
  orbSeq = 0;
  for (let i = 0; i < MAX_ORBS; i++) spawnOrb();
}

function endRound(reason) {
  const ranked = [...players.values()].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  io.emit("roundEnd", {
    reason,
    winner: winner ? { name: winner.name, score: winner.score } : null,
    standings: ranked.slice(0, 5).map((p) => ({ name: p.name, score: p.score })),
    durationMs: Date.now() - roundStartedAt,
    dotsEaten: dotsEatenThisRound,
    nextRoundInMs: INTERMISSION_MS,
  });
  intermissionUntil = Date.now() + INTERMISSION_MS;
}

io.on("connection", (socket) => {
  socket.on("join", (name) => {
    const clean = (name || "Player").toString().slice(0, 16).trim() || "Player";
    const player = {
      id: socket.id,
      name: clean,
      x: Math.random() * WORLD.width,
      y: Math.random() * WORLD.height,
      r: BASE_RADIUS,
      color: randColor(),
      score: 0,
      dx: 0,
      dy: 0,
      alive: true,
    };
    players.set(socket.id, player);
    socket.emit("welcome", {
      id: socket.id,
      world: WORLD,
      rules: { winScore: WIN_SCORE, roundDurationMs: ROUND_DURATION_MS },
    });
  });

  socket.on("input", (dir) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    let { x = 0, y = 0 } = dir || {};
    const len = Math.hypot(x, y) || 1;
    p.dx = x / len;
    p.dy = y / len;
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;

  // Intermission: hold between rounds (showing the winner), then reset and
  // go live again for the next tick.
  if (intermissionUntil) {
    if (now >= intermissionUntil) {
      startNewRound();
    } else {
      io.emit("state", {
        players: [...players.values()].map((p) => ({
          id: p.id,
          name: p.name,
          x: Math.round(p.x),
          y: Math.round(p.y),
          r: Math.round(p.r),
          color: p.color,
          score: p.score,
        })),
        orbs: [...orbs.values()],
        timeLeftMs: 0,
        intermission: true,
      });
      return;
    }
  }

  for (const p of players.values()) {
    if (!p.alive) continue;
    p.r = radiusForScore(p.score);
    const speed = SPEED * (BASE_RADIUS / p.r) ** 0.5; // bigger players move slightly slower
    p.x = Math.min(WORLD.width, Math.max(0, p.x + p.dx * speed * dt));
    p.y = Math.min(WORLD.height, Math.max(0, p.y + p.dy * speed * dt));
  }

  // orbs: any nearby orb gets pulled toward the nearest player (that's the
  // "absorbing from being close" feel) — but it's only actually eaten, and
  // only counts, if its color matches that player's. A different-colored
  // orb just clings nearby instead of scoring.
  for (const orb of orbs.values()) {
    let nearest = null;
    let nearestD = Infinity;
    for (const p of players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - orb.x, p.y - orb.y);
      if (d < nearestD) {
        nearestD = d;
        nearest = p;
      }
    }
    if (!nearest) continue;
    const matchesColor = orb.color === nearest.color;
    if (matchesColor && nearestD < nearest.r + ORB_RADIUS + PICKUP_BONUS) {
      orbs.delete(orb.id);
      nearest.score += 1;
      dotsEatenThisRound += 1;
      spawnOrb();
    } else if (nearestD < ATTRACT_RADIUS) {
      const pull = Math.min(nearestD, ORB_ATTRACT_SPEED * dt);
      orb.x += ((nearest.x - orb.x) / nearestD) * pull;
      orb.y += ((nearest.y - orb.y) / nearestD) * pull;
    }
  }

  // player vs player
  const list = [...players.values()].filter((p) => p.alive);
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const a = list[i];
      const b = list[j];
      if (!a.alive || !b.alive) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < Math.max(a.r, b.r) * 0.6) {
        if (a.r > b.r * EAT_MARGIN) {
          a.score += Math.max(1, Math.floor(b.score / 2));
          b.alive = false;
          io.to(b.id).emit("eaten", { by: a.name });
        } else if (b.r > a.r * EAT_MARGIN) {
          b.score += Math.max(1, Math.floor(a.score / 2));
          a.alive = false;
          io.to(a.id).emit("eaten", { by: b.name });
        }
      }
    }
  }
  for (const [id, p] of players) {
    if (!p.alive) players.delete(id);
  }

  // Win conditions: first to WIN_SCORE ends it immediately; otherwise the
  // clock runs out and the leader wins.
  const timeLeftMs = Math.max(0, ROUND_DURATION_MS - (now - roundStartedAt));
  const scoreWinner = [...players.values()].find((p) => p.score >= WIN_SCORE);
  if (scoreWinner) {
    endRound(`${scoreWinner.name} reached ${WIN_SCORE} points`);
  } else if (timeLeftMs <= 0) {
    endRound("Time's up");
  }

  const state = {
    players: [...players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: Math.round(p.x),
      y: Math.round(p.y),
      r: Math.round(p.r),
      color: p.color,
      score: p.score,
    })),
    orbs: [...orbs.values()],
    timeLeftMs,
    winScore: WIN_SCORE,
    intermission: false,
  };
  io.emit("state", state);
}, 1000 / TICK_HZ);

httpServer.listen(PORT, () => {
  console.log(`Game server listening on http://localhost:${PORT}`);
});
