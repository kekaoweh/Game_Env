import { io } from "socket.io-client";

const socket = io("http://localhost:3000");
let gotWelcome = false;
let welcomeRules = null;
let ticks = 0;
let firstScore = null;
let lastScore = null;
let firstPos = null;
let lastPos = null;
let sawTimeLeft = false;
let sawWinScore = false;

socket.on("connect", () => {
  socket.emit("join", "SmokeTester");
});
socket.on("welcome", (data) => {
  gotWelcome = true;
  welcomeRules = data.rules;
  console.log("welcome:", data);
});
socket.on("state", (state) => {
  ticks++;
  if (typeof state.timeLeftMs === "number" && state.timeLeftMs > 0) sawTimeLeft = true;
  if (typeof state.winScore === "number") sawWinScore = true;
  const me = state.players.find((p) => p.id === socket.id);
  if (!me) return;
  if (firstScore === null) {
    firstScore = me.score;
    firstPos = { x: me.x, y: me.y };
  }
  lastScore = me.score;
  lastPos = { x: me.x, y: me.y };
  if (state.orbs.length) {
    const target = state.orbs[0];
    socket.emit("input", { x: target.x - me.x, y: target.y - me.y });
  }
});

setTimeout(() => {
  const moved = firstPos && lastPos && (firstPos.x !== lastPos.x || firstPos.y !== lastPos.y);
  const ate = lastScore !== null && firstScore !== null && lastScore > firstScore;
  console.log("ticks:", ticks, "moved:", moved, "score:", firstScore, "->", lastScore, "ate:", ate);
  console.log("rules from welcome:", welcomeRules, "sawTimeLeft:", sawTimeLeft, "sawWinScore:", sawWinScore);
  const ok = gotWelcome && ticks > 10 && moved && ate && sawTimeLeft && sawWinScore && welcomeRules?.winScore > 0;
  console.log("RESULT ok:", ok);
  process.exit(ok ? 0 : 1);
}, 6000);
