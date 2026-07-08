const screens = {
  landing: document.getElementById("landing"),
  game: document.getElementById("game"),
  gameOver: document.getElementById("gameOver"),
};

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const finalScoreEl = document.getElementById("finalScore");
const connectButton = document.getElementById("connectButton");
const connectStatus = document.getElementById("connectStatus");
const startButton = document.getElementById("startButton");
const newGameButton = document.getElementById("newGameButton");
const comPortInput = document.getElementById("comPort");
const teamNumberInput = document.getElementById("teamNumber");
const saveStatusEl = document.getElementById("saveStatus");

const FIREBASE_RESULTS_URL =
  "https://bird-rehab-game-default-rtdb.asia-southeast1.firebasedatabase.app/game_results.json";

const config = {
  baudRate: 9600,
  groundRatio: 0.78,
  baselineRatio: 0.59,
  obstacleDelaySeconds: 4,
  smallPressGraceMs: 1500,
  smallPressLiftMs: 1000,
  bigPressArcMs: 2600,
  gravity: 690,
  maxFallSpeed: 620,
  maxRiseSpeed: -520,
  treeSpeed: 190,
};

const state = {
  signal: 0,
  connected: false,
  running: false,
  over: false,
  score: 0,
  startTime: 0,
  lastFrame: 0,
  treeTimer: 0,
  lastSmallPressAt: -Infinity,
  lastBigPressAt: -Infinity,
  lastSerialAt: 0,
  activeKeys: new Set(),
  bird: { x: 190, y: 0, vy: 0, radius: 24 },
  obstacles: [],
  groundBits: [],
  clouds: [],
  jumpLocked: false,
};

let port;
let reader;
let serialAbortController;
let animationId = 0;

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove("screen-active"));
  screens[name].classList.add("screen-active");
}

function setStatus(message, type) {
  connectStatus.textContent = message;
  connectStatus.className = `status ${type || ""}`;
}

function setSignal(value, source = "serial") {
  const nextSignal = Number(value);
  if (![0, 1, 2].includes(nextSignal)) return;

  const now = performance.now();
  const previousSignal = state.signal;
  state.signal = nextSignal;
  if (source === "serial") {
    state.lastSerialAt = now;
  }
  if (nextSignal === 1) {
    state.lastSmallPressAt = now;
  }
  if (nextSignal === 2 && !state.jumpLocked) {
      state.lastBigPressAt = now;
      state.lastSmallPressAt = now;
      state.jumpLocked = true;
  }
}

function resizeCanvas() {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * ratio);
  canvas.height = Math.floor(window.innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  if (state.running) {
    state.bird.x = Math.min(210, window.innerWidth * 0.24);
    state.bird.y = Math.min(state.bird.y, groundY() - state.bird.radius - 2);
  }
}

function groundY() {
  return window.innerHeight * config.groundRatio;
}

function baselineY() {
  return groundY() * config.baselineRatio;
}

function resetWorld() {
  const now = performance.now();
  state.running = true;
  state.over = false;
  state.score = 0;
  state.startTime = now;
  state.lastFrame = now;
  state.treeTimer = 0;
  state.lastSmallPressAt = -Infinity;
  state.lastBigPressAt = -Infinity;
  state.signal = 0;
  state.bird.x = Math.min(210, window.innerWidth * 0.24);
  state.bird.y = baselineY();
  state.bird.vy = 0;
  state.obstacles = [];
  state.groundBits = makeGroundBits();
  state.clouds = makeClouds();
  scoreEl.textContent = "0";
  setSaveStatus("");
}

function makeClouds() {
  return Array.from({ length: 8 }, (_, index) => ({
    x: Math.random() * window.innerWidth + index * 130,
    y: 38 + Math.random() * groundY() * 0.34,
    speed: 14 + Math.random() * 17,
    scale: 0.55 + Math.random() * 0.85,
  }));
}

function makeGroundBits() {
  const bits = [];
  const count = Math.ceil(window.innerWidth / 95) + 8;
  for (let index = 0; index < count; index += 1) {
    bits.push(makeGroundBit(index * 95 + Math.random() * 50));
  }
  return bits;
}

function makeGroundBit(x) {
  const types = ["shrub", "rock", "bush", "flower"];
  return {
    x,
    y: groundY() + 22 + Math.random() * Math.max(20, window.innerHeight - groundY() - 64),
    speed: 160 + Math.random() * 55,
    type: types[Math.floor(Math.random() * types.length)],
    scale: 0.65 + Math.random() * 0.7,
  };
}

function spawnTree() {
  const minHeight = Math.max(140, window.innerHeight * 0.20);
  const maxHeight = Math.max(minHeight + 30, window.innerHeight * 0.26);
  const height = minHeight + Math.random() * (maxHeight - minHeight);
  state.obstacles.push({
    x: window.innerWidth + 90,
    y: groundY() - height,
    width: 62,
    height,
    speed: config.treeSpeed,
  });
}

function handleInput(now, dt) {
  const bird = state.bird;
  const baseline = baselineY();
  const bigArcAge = now - state.lastBigPressAt;
  const isBigArc = bigArcAge >= 0 && bigArcAge < config.bigPressArcMs;
  const smallAge = now - state.lastSmallPressAt;
  const isSmallPressFresh = smallAge >= 0 && smallAge < config.smallPressGraceMs;
  const isSmallPressStrong = smallAge >= 0 && smallAge < config.smallPressLiftMs;

  if (state.signal === 1) {
    state.lastSmallPressAt = now;
  }

  if (isBigArc) {
    const progress = Math.min(1, bigArcAge / config.bigPressArcMs);
    const arcHeight = Math.max(
        190,
        Math.min(260, window.innerHeight * 0.35)
    );
    const target = baseline - Math.sin(progress * Math.PI) * arcHeight;
    bird.y = Math.max(bird.radius + 12, target);
    bird.vy = 0;
    return;
  } else if (isSmallPressFresh || state.signal === 1) {
    const target = baseline;
    const strength = bird.y > baseline ? 10 : isSmallPressStrong ? 8 : 4;
    seekY(target, strength, dt);

    if (bird.y < baseline) {
      bird.vy += 500 * dt;
    }
  } else {
    bird.vy += config.gravity * dt;
  }

  bird.vy = clamp(bird.vy, config.maxRiseSpeed, config.maxFallSpeed);
  bird.y += bird.vy * dt;

  if (!isBigArc && bird.y < baseline) {
    bird.y = Math.min(baseline, bird.y + 135 * dt);
    if (bird.y >= baseline - 3) {
      bird.y = baseline;
      bird.vy = 0;
      state.jumpLocked = false;
    }
  }

  const ceiling = bird.radius + 12;
  if (bird.y < ceiling) {
    bird.y = ceiling;
    bird.vy = Math.max(0, bird.vy);
  }

  console.log(state.signal);
}

function seekY(target, strength, dt) {
  const bird = state.bird;
  bird.vy += (target - bird.y) * strength * dt;
}

function update(dt, now) {
  handleInput(now, dt);

  state.clouds.forEach((cloud) => {
    cloud.x -= cloud.speed * dt;
    if (cloud.x < -190) {
      cloud.x = window.innerWidth + Math.random() * 260;
      cloud.y = 35 + Math.random() * groundY() * 0.34;
    }
  });

  state.groundBits.forEach((bit) => {
    bit.x -= bit.speed * dt;
    if (bit.x < -90) {
      Object.assign(bit, makeGroundBit(window.innerWidth + Math.random() * 180));
    }
  });

  const elapsed = (now - state.startTime) / 1000;
  if (elapsed > config.obstacleDelaySeconds) {
    state.treeTimer -= dt;
    if (state.treeTimer <= 0) {
      spawnTree();
      state.treeTimer = 3.2 + Math.random() * 0.8;
    }
  }

  state.obstacles.forEach((tree) => {
    tree.x -= tree.speed * dt;
  });
  state.obstacles = state.obstacles.filter((tree) => tree.x > -150);

  state.score = Math.floor(elapsed);
  scoreEl.textContent = String(state.score);

  if (state.bird.y + state.bird.radius > groundY()) {
    endGame();
    return;
  }

  for (const tree of state.obstacles) {
    if (collidesWithTree(tree)) {
      endGame();
      return;
    }
  }
}

function collidesWithTree(tree) {
  const bird = state.bird;
  const trunkHit =
    bird.x + bird.radius > tree.x &&
    bird.x - bird.radius < tree.x + tree.width &&
    bird.y + bird.radius > tree.y;

  const canopy = [
    { x: tree.x + tree.width / 2, y: tree.y - 46, r: 46 },
    { x: tree.x - 26, y: tree.y - 10, r: 34 },
    { x: tree.x + tree.width + 24, y: tree.y - 12, r: 34 },
  ];

  return trunkHit || canopy.some((part) => circleHit(bird.x, bird.y, bird.radius, part.x, part.y, part.r));
}

function circleHit(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy < (ar + br) * (ar + br);
}

function draw() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ground = groundY();

  ctx.clearRect(0, 0, width, height);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#74cdf9");
  sky.addColorStop(0.72, "#56b6ed");
  sky.addColorStop(0.721, "#57b846");
  sky.addColorStop(1, "#2f8538");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  state.clouds.forEach(drawCloud);

  ctx.fillStyle = "#52ad41";
  ctx.fillRect(0, ground, width, height - ground);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  for (let x = -30; x < width + 60; x += 54) {
    ctx.fillRect(x, ground + 12 + ((x / 54) % 2) * 10, 28, 4);
  }

  state.groundBits.forEach(drawGroundBit);
  state.obstacles.forEach(drawTree);
  drawBird();
}

function drawCloud(cloud) {
  ctx.save();
  ctx.translate(cloud.x, cloud.y);
  ctx.scale(cloud.scale, cloud.scale);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.ellipse(0, 16, 54, 22, 0, 0, Math.PI * 2);
  ctx.ellipse(42, 2, 38, 28, 0, 0, Math.PI * 2);
  ctx.ellipse(82, 17, 50, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBird() {
  const bird = state.bird;
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(clamp(bird.vy / 700, -0.35, 0.45));
  ctx.fillStyle = "#ffd94f";
  ctx.strokeStyle = "#a96c13";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#f4a62a";
  ctx.beginPath();
  ctx.ellipse(-7, 9, 18, 9, -0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(15, -8, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f2801f";
  ctx.beginPath();
  ctx.moveTo(32, -1);
  ctx.lineTo(52, 8);
  ctx.lineTo(31, 16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTree(tree) {
  ctx.fillStyle = "#7a431d";
  roundRect(tree.x, tree.y, tree.width, tree.height + 16, 8);
  ctx.fill();

  ctx.fillStyle = "#1d7d3d";
  ctx.beginPath();
  ctx.arc(tree.x + tree.width / 2, tree.y - 46, 58, 0, Math.PI * 2);
  ctx.arc(tree.x - 26, tree.y - 10, 45, 0, Math.PI * 2);
  ctx.arc(tree.x + tree.width + 24, tree.y - 12, 45, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.13)";
  ctx.beginPath();
  ctx.arc(tree.x + tree.width / 2 - 20, tree.y - 62, 17, 0, Math.PI * 2);
  ctx.fill();
}

function drawGroundBit(bit) {
  ctx.save();
  ctx.translate(bit.x, bit.y);
  ctx.scale(bit.scale, bit.scale);
  if (bit.type === "rock") {
    ctx.fillStyle = "#7f888a";
    ctx.beginPath();
    ctx.ellipse(0, 12, 34, 20, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(34, 16);
    ctx.lineTo(-34, 16);
    ctx.closePath();
    ctx.fill();
  } else if (bit.type === "flower") {
    ctx.fillStyle = "#247d3c";
    ctx.fillRect(-2, -2, 4, 30);
    ctx.fillStyle = "#f06292";
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI * 2 * i) / 6;
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * 9, Math.sin(angle) * 9 - 5, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd94f";
    ctx.beginPath();
    ctx.arc(0, -5, 6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = bit.type === "bush" ? "#247d3c" : "#32a852";
    ctx.beginPath();
    ctx.arc(-24, 15, 24, Math.PI, Math.PI * 2);
    ctx.arc(0, 6, 30, Math.PI, Math.PI * 2);
    ctx.arc(30, 16, 23, Math.PI, Math.PI * 2);
    ctx.lineTo(54, 18);
    ctx.lineTo(-48, 18);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function roundRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function frame(now) {
  if (!state.running) return;
  const dt = Math.min(0.034, Math.max(0, (now - state.lastFrame) / 1000));
  state.lastFrame = now;
  update(dt, now);
  draw();
  if (state.running) {
    animationId = requestAnimationFrame(frame);
  }
}

function startGame() {
  resizeCanvas();
  resetWorld();
  showScreen("game");
  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(frame);
}

function endGame() {
  if (state.over) return;
  state.running = false;
  state.over = true;
  cancelAnimationFrame(animationId);
  finalScoreEl.textContent = String(state.score);
  showScreen("gameOver");
  sendGameResult(state.score);
}

async function sendGameResult(score) {
  if (score < 4) {
    setSaveStatus("Score too low - not saved", "");
    return;
  }

  const teamNumber = teamNumberInput.value.trim() || "Unassigned";
  setSaveStatus("Saving result...", "");

  try {
    const response = await fetch(FIREBASE_RESULTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamNumber,
        score,
        createdAt: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Firebase returned ${response.status}`);
    }

    setSaveStatus("Result saved", "saved");
  } catch (error) {
    console.error(error);
    setSaveStatus("Failed to save result", "failed");
  }
}

function setSaveStatus(message, type) {
  saveStatusEl.textContent = message;
  saveStatusEl.className = `save-status ${type || ""}`;
}

async function connectSerial() {
  const requestedPort = comPortInput.value.trim();
  if (!requestedPort) {
    state.connected = false;
    setStatus("Failed to connect!", "failed");
    return;
  }

  setStatus("Connecting...", "");
  connectButton.disabled = true;

  if (!("serial" in navigator)) {
    state.connected = false;
    setStatus("Failed to connect!", "failed");
    connectButton.disabled = false;
    return;
  }

  try {
    await disconnectSerial();
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: config.baudRate });
    readSerialValues();

    const connected = await waitForFirstSignal();
    state.connected = connected;
    setStatus(connected ? "Connected!" : "Failed to connect!", connected ? "connected" : "failed");
    if (!connected) {
      await disconnectSerial();
    }
  } catch (error) {
    console.error(error);
    state.connected = false;
    setStatus("Failed to connect!", "failed");
    await disconnectSerial();
  } finally {
    connectButton.disabled = false;
  }
}

async function disconnectSerial() {
  serialAbortController?.abort();
  serialAbortController = undefined;

  if (reader) {
    try {
      await reader.cancel();
      reader.releaseLock();
    } catch (error) {
      console.warn(error);
    }
    reader = undefined;
  }

  if (port?.readable || port?.writable) {
    try {
      await port.close();
    } catch (error) {
      console.warn(error);
    }
  }
  port = undefined;
}

async function waitForFirstSignal() {
  const started = performance.now();
  while (performance.now() - started < 2600) {
    if (state.lastSerialAt >= started && performance.now() - state.lastSerialAt < 850) {
      return true;
    }
    await sleep(80);
  }
  return false;
}

async function readSerialValues() {
  serialAbortController = new AbortController();
  const decoder = new TextDecoderStream();
  const closeReadable = port.readable.pipeTo(decoder.writable, { signal: serialAbortController.signal }).catch(() => {});
  reader = decoder.readable.getReader();
  let buffer = "";

  try {
    while (!serialAbortController.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      parseSerialBuffer(buffer).forEach((signal) => setSignal(signal, "serial"));
      buffer = buffer.slice(-24);
    }
  } catch (error) {
    if (!serialAbortController.signal.aborted) {
      console.error(error);
      state.connected = false;
      setStatus("Failed to connect!", "failed");
    }
  } finally {
    await closeReadable;
  }
}

function parseSerialBuffer(buffer) {
  const tokens = [];
  const matches = buffer.match(/[012]/g);
  if (!matches) return tokens;

  matches.forEach((value) => tokens.push(Number(value)));
  return tokens;
}

function updateKeyboardSignal() {
  if (state.activeKeys.has("2")) {
    setSignal(2, "keyboard");
  } else if (state.activeKeys.has("1")) {
    setSignal(1, "keyboard");
  } else {
    setSignal(0, "keyboard");
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

connectButton.addEventListener("click", connectSerial);
startButton.addEventListener("click", startGame);
newGameButton.addEventListener("click", startGame);

window.addEventListener("resize", () => {
  resizeCanvas();
  if (state.running) {
    draw();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "0" || event.key === "1" || event.key === "2") {
    state.activeKeys.add(event.key);
    updateKeyboardSignal();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "0" || event.key === "1" || event.key === "2") {
    state.activeKeys.delete(event.key);
    updateKeyboardSignal();
  }
});

window.addEventListener("beforeunload", () => {
  serialAbortController?.abort();
});

resizeCanvas();
