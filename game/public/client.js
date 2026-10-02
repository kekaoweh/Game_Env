const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

const joinScreen = document.getElementById("join-screen");
const deathScreen = document.getElementById("death-screen");
const deathMessage = document.getElementById("death-message");
const hud = document.getElementById("hud");
const scoreEl = document.getElementById("score");
const leaderboardEl = document.getElementById("leaderboard");
const roundInfoEl = document.getElementById("round-info");
const colorSwatchEl = document.getElementById("color-swatch");
const nameInput = document.getElementById("name-input");
const playBtn = document.getElementById("play-btn");
const respawnBtn = document.getElementById("respawn-btn");
const winnerScreen = document.getElementById("winner-screen");
const winnerMessage = document.getElementById("winner-message");
const winnerStats = document.getElementById("winner-stats");
const winnerStandings = document.getElementById("winner-standings");
const confettiEl = document.getElementById("confetti");

function fireConfetti() {
  confettiEl.innerHTML = "";
  const colors = ["#e8593a", "#2fb673", "#3b82f6", "#f5b53a", "#a855f7", "#ec4899", "#14b8a6"];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    confettiEl.appendChild(piece);
  }
}

function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

let socket = null;
let myId = null;
let world = { width: 3000, height: 3000 };
let rules = { winScore: 150, roundDurationMs: 5 * 60 * 1000 };
let latestState = { players: [], orbs: [], timeLeftMs: 0, winScore: 150 };
let dir = { x: 0, y: 0 };
let pointerDrag = null;

function connectAndJoin(name) {
  socket = io();
  socket.on("welcome", (data) => {
    myId = data.id;
    world = data.world;
    rules = data.rules;
    joinScreen.classList.add("hidden");
    deathScreen.classList.add("hidden");
    winnerScreen.classList.add("hidden");
    hud.classList.remove("hidden");
  });
  socket.on("state", (state) => {
    latestState = state;
    if (!state.intermission) winnerScreen.classList.add("hidden");
  });
  socket.on("eaten", (data) => {
    deathMessage.textContent = `Eaten by ${data.by}`;
    deathScreen.classList.remove("hidden");
    hud.classList.add("hidden");
  });
  socket.on("roundEnd", (data) => {
    winnerMessage.textContent = data.winner
      ? `${data.winner.name} wins! (${data.winner.score} pts)`
      : `Round over`;
    winnerStats.innerHTML = `
      <div class="stat"><div class="stat-value">${formatDuration(data.durationMs)}</div><div class="stat-label">Time</div></div>
      <div class="stat"><div class="stat-value">${data.dotsEaten}</div><div class="stat-label">Dots eaten</div></div>
    `;
    const medals = ["gold", "silver", "bronze"];
    winnerStandings.innerHTML = data.standings
      .map(
        (s, i) =>
          `<div class="lb-row ${medals[i] || ""}"><span>${i + 1}. ${s.name}</span><span>${s.score}</span></div>`
      )
      .join("");
    deathScreen.classList.add("hidden");
    winnerScreen.classList.remove("hidden");
    fireConfetti();
  });
  socket.emit("join", name);
}

playBtn.addEventListener("click", () => {
  const name = nameInput.value.trim() || "Player";
  connectAndJoin(name);
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") playBtn.click();
});
respawnBtn.addEventListener("click", () => {
  const name = nameInput.value.trim() || "Player";
  connectAndJoin(name);
});

const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function updateDirFromKeys() {
  let x = 0, y = 0;
  if (keys.has("w") || keys.has("arrowup")) y -= 1;
  if (keys.has("s") || keys.has("arrowdown")) y += 1;
  if (keys.has("a") || keys.has("arrowleft")) x -= 1;
  if (keys.has("d") || keys.has("arrowright")) x += 1;
  if (x !== 0 || y !== 0) {
    dir = { x, y };
  }
}

canvas.addEventListener("pointerdown", (e) => {
  pointerDrag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointerDrag) return;
  dir = { x: e.clientX - pointerDrag.x, y: e.clientY - pointerDrag.y };
});
window.addEventListener("pointerup", () => {
  pointerDrag = null;
  dir = { x: 0, y: 0 };
});

setInterval(() => {
  updateDirFromKeys();
  if (socket && myId) {
    if (keys.size === 0 && !pointerDrag) dir = { x: 0, y: 0 };
    socket.emit("input", dir);
  }
}, 1000 / 30);

function draw() {
  requestAnimationFrame(draw);
  if (!myId) {
    ctx.fillStyle = "#0f1115";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const me = latestState.players.find((p) => p.id === myId);
  const camX = me ? me.x : world.width / 2;
  const camY = me ? me.y : world.height / 2;

  ctx.fillStyle = "#0f1115";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2 - camX, canvas.height / 2 - camY);

  // grid background
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  const gridSize = 100;
  const startX = Math.floor((camX - canvas.width) / gridSize) * gridSize;
  const endX = camX + canvas.width;
  const startY = Math.floor((camY - canvas.height) / gridSize) * gridSize;
  const endY = camY + canvas.height;
  for (let x = startX; x < endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }
  for (let y = startY; y < endY; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }

  // world bounds
  ctx.strokeStyle = "rgba(232,89,58,0.4)";
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, world.width, world.height);

  // orbs — matching-color ones get a bright ring so they're easy to spot
  for (const orb of latestState.orbs) {
    ctx.beginPath();
    ctx.fillStyle = orb.color;
    ctx.arc(orb.x, orb.y, 6, 0, Math.PI * 2);
    ctx.fill();
    if (me && orb.color === me.color) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "white";
      ctx.stroke();
    }
  }

  // players
  const sorted = [...latestState.players].sort((a, b) => a.r - b.r);
  for (const p of sorted) {
    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    if (p.id === myId) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "white";
      ctx.stroke();
    }
    ctx.fillStyle = "white";
    ctx.font = "13px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.name, p.x, p.y - p.r - 8);
  }

  ctx.restore();

  // HUD
  if (me) {
    scoreEl.textContent = `Score: ${me.score} / ${latestState.winScore ?? rules.winScore}`;
    colorSwatchEl.style.background = me.color;
  }
  const secondsLeft = Math.ceil((latestState.timeLeftMs ?? rules.roundDurationMs) / 1000);
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");
  roundInfoEl.textContent = `First to ${latestState.winScore ?? rules.winScore} wins — ${mm}:${ss} left`;
  const top = [...latestState.players].sort((a, b) => b.score - a.score).slice(0, 5);
  leaderboardEl.innerHTML =
    '<div class="lb-title">Leaderboard</div>' +
    top
      .map(
        (p, i) =>
          `<div class="lb-row"><span>${i + 1}. ${p.name}${p.id === myId ? " (you)" : ""}</span><span>${p.score}</span></div>`
      )
      .join("");
}
draw();
