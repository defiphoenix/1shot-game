const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const BASE = document.baseURI;
const LEVEL_IDS = [
  "level-1",
  "level-2",
  "level-3",
  "level-4",
  "level-5",
  "level-6",
  "level-7",
  "level-8",
  "level-9",
  "level-10"
];
const GRAVITY = 2100;
const WALK_SPEED = 280;
const JUMP_SPEED = 900;
const HERO_SCALE = 0.72;
const STONE_GRAVITY = 1100;
const STONE_SPEED = 390;
const STONE_DAMAGE = 14;

const ui = {
  levelTitle: document.querySelector("#levelTitle"),
  health: document.querySelector("#healthReadout"),
  coins: document.querySelector("#coinReadout"),
  coinTotal: document.querySelector("#coinTotalReadout"),
  overlay: document.querySelector("#overlay"),
  overlayKicker: document.querySelector("#overlayKicker"),
  overlayTitle: document.querySelector("#overlayTitle"),
  start: document.querySelector("#startButton"),
  restart: document.querySelector("#restartButton"),
  levelButtons: [...document.querySelectorAll(".level-button")]
};

const keys = new Set();
const assets = {};
const state = {
  started: false,
  levelId: "level-1",
  level: null,
  frames: new Map(),
  cameraX: 0,
  coins: new Set(),
  hazards: [],
  platforms: [],
  enemies: [],
  projectiles: [],
  portal: null,
  messageTimer: 0,
  completed: false,
  overlayAction: "start",
  overlayShortcut: null,
  player: makePlayer()
};

function asset(path) {
  return new URL(path, BASE).href;
}

function makePlayer() {
  return {
    x: 140,
    y: 260,
    vx: 0,
    vy: 0,
    width: 54,
    height: 118,
    health: 100,
    facing: 1,
    grounded: false,
    invincible: 0,
    attack: 0,
    anim: "idle",
    animTime: 0
  };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function frameRect(entity) {
  return {
    x: entity.x - entity.width / 2,
    y: entity.y - entity.height,
    width: entity.width,
    height: entity.height
  };
}

function objectDrawRect(object, frame) {
  const scale = object.scale ?? 1;
  const anchor = frame.anchor ?? { x: 0.5, y: 1 };
  const width = frame.bounds.width * scale;
  const height = frame.bounds.height * scale;

  return {
    x: object.x - width * anchor.x,
    y: object.y - height * anchor.y,
    width,
    height
  };
}

function objectCollisionRect(object, frame, collision = frame.collision ?? frame.trigger ?? frame.bounds) {
  const draw = objectDrawRect(object, frame);
  const scale = object.scale ?? 1;
  const source = frame.collision ?? frame.trigger ? collision : {
    x: 0,
    y: 0,
    width: frame.bounds.width,
    height: frame.bounds.height
  };

  return {
    x: draw.x + source.x * scale,
    y: draw.y + source.y * scale,
    width: source.width * scale,
    height: source.height * scale
  };
}

async function loadJson(path) {
  const response = await fetch(asset(path));
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

async function boot() {
  const [tileManifest, levels] = await Promise.all([
    loadJson("assets/tiles/quest/atlas-transparent.manifest.json"),
    loadJson("assets/levels/index.json")
  ]);

  tileManifest.frames.forEach((frame) => state.frames.set(frame.name, frame));
  assets.levels = levels.levels;

  await loadLevel("level-1");
  bindInput();
  requestAnimationFrame(loop);
}

async function loadLevel(levelId) {
  const entry = assets.levels?.find((level) => level.id === levelId);
  const levelExport = await loadJson(`assets/levels/${levelId}.json`);
  const level = levelExport.level ?? levelExport;
  state.levelId = levelId;
  state.level = level;
  state.cameraX = 0;
  state.completed = false;
  state.messageTimer = 0;
  state.coins = new Set();
  state.hazards = [];
  state.platforms = [];
  state.enemies = [];
  state.projectiles = [];
  state.portal = null;
  state.player = makePlayer();
  state.player.x = level.playerStart.x;
  state.player.y = level.playerStart.y;

  for (const object of level.objects) {
    const frame = state.frames.get(object.frameName);
    if (object.frameName === "enemy-v3-purple-orc") {
      state.enemies.push({
        ...object,
        x: object.x,
        y: object.y,
        homeX: object.x,
        vx: -70,
        facing: -1,
        health: 2,
        alive: true,
        attack: 0,
        throwCooldown: 0.65 + (object.x % 7) * 0.11,
        animTime: 0,
        width: 60,
        height: 112
      });
      continue;
    }

    if (!frame) {
      continue;
    }
    if (frame.kind === "whole-platform" || frame.kind === "repeatable-tile") {
      state.platforms.push({ object, rect: objectCollisionRect(object, frame) });
    }
    if (frame.kind === "hazard") {
      state.hazards.push({ object, rect: objectCollisionRect(object, frame) });
    }
    if (frame.kind === "collectible") {
      state.coins.add(object.id);
    }
    if (object.frameName === "portal-exit-complete") {
      state.portal = { object, rect: objectCollisionRect(object, frame, frame.trigger) };
    }
  }

  ui.levelTitle.textContent = entry?.title ?? level.title;
  ui.coinTotal.textContent = `${state.coins.size}`;
  ui.levelButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.level === levelId));
}

function bindInput() {
  window.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    if (ui.overlay.classList.contains("is-visible") && event.code === state.overlayShortcut) {
      event.preventDefault();
      runOverlayAction();
      return;
    }
    keys.add(event.code);
    if (event.code === "KeyR") {
      restart();
    }
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  ui.start.addEventListener("click", () => runOverlayAction());
  ui.restart.addEventListener("click", () => restart());
  ui.levelButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      await loadLevel(button.dataset.level);
      start();
    });
  });
}

function start() {
  state.started = true;
  ui.overlay.classList.remove("is-visible");
}

function runOverlayAction() {
  if (state.overlayAction === "restart-all") {
    loadLevel(LEVEL_IDS[0]).then(start).catch((err) => {
      console.error(err);
      showOverlay("불러오기 오류", "레벨을 불러올 수 없습니다.", { action: "restart-all", buttonText: "다시 시도" });
    });
    return;
  }
  if (state.overlayAction === "restart" || (state.player && state.player.health <= 0)) {
    restart();
    return;
  }
  start();
}

function showOverlay(kicker, title, options = {}) {
  ui.overlayKicker.textContent = kicker;
  ui.overlayTitle.textContent = title;
  ui.start.textContent = options.buttonText ?? "다시 하기";
  state.overlayAction = options.action ?? "start";
  state.overlayShortcut = options.shortcut ?? null;
  ui.overlay.classList.add("is-visible");
}

function restart() {
  loadLevel(state.levelId).then(start).catch((err) => {
    console.error(err);
    showOverlay("불러오기 오류", "레벨을 불러올 수 없습니다.", { action: "restart", buttonText: "다시 시도" });
  });
}

let lastTime = 0;
function loop(time) {
  const dt = Math.min(0.033, (time - lastTime) / 1000 || 0);
  lastTime = time;

  if (state.started && state.level) {
    update(dt);
  }
  draw();
  requestAnimationFrame(loop);
}

function update(dt) {
  const player = state.player;
  player.animTime += dt;
  player.invincible = Math.max(0, player.invincible - dt);
  player.attack = Math.max(0, player.attack - dt);

  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  const jump = keys.has("ArrowUp") || keys.has("KeyW") || keys.has("Space");
  const attack = keys.has("KeyJ") || keys.has("KeyX");

  player.vx = 0;
  if (left) player.vx -= WALK_SPEED;
  if (right) player.vx += WALK_SPEED;
  if (player.vx !== 0) player.facing = Math.sign(player.vx);
  if (jump && player.grounded) {
    player.vy = -JUMP_SPEED;
    player.grounded = false;
  }
  if (attack && player.attack <= 0) {
    player.attack = 0.22;
    player.animTime = 0;
  }

  player.vy += GRAVITY * dt;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.grounded = false;

  resolvePlatforms(player);
  updateEnemies(dt);
  updateProjectiles(dt);
  resolveHazards();
  resolveCoins();
  resolvePortal();
  updateCamera();
  updateHud();

  if (player.y > HEIGHT + 320 || player.health <= 0) {
    player.health = 0;
    state.started = false;
    showOverlay("패배", "게이트에서 여정을 다시 시작합니다.", {
      action: "restart",
      buttonText: "다시 하기"
    });
  }
}

function resolvePlatforms(player) {
  const body = frameRect(player);
  for (const platform of state.platforms) {
    if (!rectsOverlap(body, platform.rect)) continue;
    const previousBottom = body.y + body.height - player.vy / 60;
    if (player.vy >= 0 && previousBottom <= platform.rect.y + 18) {
      player.y = platform.rect.y;
      player.vy = 0;
      player.grounded = true;
      body.y = player.y - player.height;
    }
  }

  player.x = Math.max(30, Math.min(state.level.bounds.width - 30, player.x));
}

function updateEnemies(dt) {
  const player = state.player;
  const attackBox = {
    x: player.x + player.facing * 18,
    y: player.y - 92,
    width: player.facing > 0 ? 90 : -90,
    height: 70
  };
  const normalizedAttack = {
    x: Math.min(attackBox.x, attackBox.x + attackBox.width),
    y: attackBox.y,
    width: Math.abs(attackBox.width),
    height: attackBox.height
  };

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    enemy.animTime += dt;
    enemy.attack = Math.max(0, enemy.attack - dt);
    enemy.throwCooldown = Math.max(0, enemy.throwCooldown - dt);
    enemy.x += enemy.vx * dt;
    if (enemy.x > enemy.homeX + 190) {
      enemy.vx = -Math.abs(enemy.vx);
    } else if (enemy.x < enemy.homeX - 190) {
      enemy.vx = Math.abs(enemy.vx);
    }
    enemy.facing = Math.sign(enemy.vx) || enemy.facing;

    const enemyRect = frameRect(enemy);
    maybeThrowStone(enemy, player);
    if (player.attack > 0.09 && rectsOverlap(normalizedAttack, enemyRect)) {
      enemy.health -= 1;
      enemy.vx = player.facing * 120;
      player.attack = 0.06;
      if (enemy.health <= 0) enemy.alive = false;
    } else if (rectsOverlap(frameRect(player), enemyRect) && player.invincible <= 0) {
      hurtPlayer(18);
      enemy.attack = 0.25;
    }
  }
}

function maybeThrowStone(enemy, player) {
  if (enemy.throwCooldown > 0) return;
  const dx = player.x - enemy.x;
  const dy = (player.y - 78) - (enemy.y - 72);
  const distance = Math.abs(dx);
  if (distance < 150 || distance > 680 || Math.abs(dy) > 260) return;

  const direction = Math.sign(dx) || 1;
  enemy.facing = direction;
  const flightTime = Math.min(1.35, Math.max(0.55, distance / STONE_SPEED));
  const vy = Math.min(90, Math.max(-540, (dy - STONE_GRAVITY * flightTime * flightTime * 0.5) / flightTime));

  state.projectiles.push({
    x: enemy.x + direction * 28,
    y: enemy.y - 72,
    vx: direction * STONE_SPEED,
    vy,
    radius: 10,
    spin: direction * (5.8 + distance / 180),
    time: 0,
    owner: enemy.id
  });
  enemy.attack = 0.34;
  enemy.throwCooldown = 1.45 + Math.min(0.65, distance / 1200);
}

function updateProjectiles(dt) {
  const playerRect = frameRect(state.player);
  for (const projectile of state.projectiles) {
    projectile.time += dt;
    projectile.vy += STONE_GRAVITY * dt;
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    const rect = projectileRect(projectile);
    if (rectsOverlap(rect, playerRect)) {
      hurtPlayer(STONE_DAMAGE);
      state.player.vy = Math.min(state.player.vy, -260);
      projectile.hit = true;
      continue;
    }

    if (state.platforms.some((platform) => rectsOverlap(rect, platform.rect))) {
      projectile.hit = true;
    }
  }

  state.projectiles = state.projectiles.filter((projectile) => (
    !projectile.hit &&
    projectile.x > -120 &&
    projectile.x < state.level.bounds.width + 120 &&
    projectile.y < HEIGHT + 180
  ));
}

function projectileRect(projectile) {
  return {
    x: projectile.x - projectile.radius,
    y: projectile.y - projectile.radius,
    width: projectile.radius * 2,
    height: projectile.radius * 2
  };
}

function resolveHazards() {
  const playerRect = frameRect(state.player);
  for (const hazard of state.hazards) {
    if (rectsOverlap(playerRect, hazard.rect)) {
      hurtPlayer(22);
      state.player.vy = -420;
      state.player.y -= 12;
      break;
    }
  }
}

function hurtPlayer(amount) {
  if (state.player.invincible > 0) return;
  state.player.health = Math.max(0, state.player.health - amount);
  state.player.invincible = 0.85;
  state.player.animTime = 0;
}

function resolveCoins() {
  const playerRect = frameRect(state.player);
  for (const object of state.level.objects) {
    if (!state.coins.has(object.id)) continue;
    const frame = state.frames.get(object.frameName);
    const rect = objectCollisionRect(object, frame);
    if (rectsOverlap(playerRect, rect)) {
      state.coins.delete(object.id);
    }
  }
}

function resolvePortal() {
  if (!state.portal || state.coins.size > 0 || state.completed) return;
  if (rectsOverlap(frameRect(state.player), state.portal.rect)) {
    state.completed = true;
    const index = LEVEL_IDS.indexOf(state.levelId);
    const next = LEVEL_IDS[index + 1];
    state.started = false;
    if (next) {
      loadLevel(next).then(() => {
        showOverlay("게이트 열림", "다음 길이 준비되었습니다.", {
          buttonText: "다음 스테이지",
          shortcut: "KeyN"
        });
      }).catch((err) => {
        console.error(err);
        showOverlay("임무 완수", "마지막 게이트가 복구되었습니다.", {
          action: "restart-all",
          buttonText: "처음부터"
        });
      });
    } else {
      showOverlay("임무 완수", "마지막 게이트가 복구되었습니다.", {
        action: "restart-all",
        buttonText: "처음부터"
      });
    }
  }
}

function updateCamera() {
  const maxX = Math.max(0, state.level.bounds.width - WIDTH);
  const target = Math.max(0, Math.min(maxX, state.player.x - WIDTH * 0.38));
  state.cameraX += (target - state.cameraX) * 0.12;
}

function updateHud() {
  ui.health.textContent = `${Math.ceil(state.player.health)}`;
  ui.coins.textContent = `${Number(ui.coinTotal.textContent) - state.coins.size}`;
}

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawBackground();
  if (!state.level) return;

  const objects = [...state.level.objects].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  for (const object of objects) {
    if (object.frameName === "enemy-v3-purple-orc") continue;
    if (state.coins.has(object.id) || object.frameName !== "collectible-coin") {
      drawTileObject(object);
    }
  }
  drawEnemies();
  drawProjectiles();
  drawPlayer();
  drawVignette();
}

function drawBackground() {
  // 보따리 일러스트풍: 밝은 종이 배경 + 옅은 언덕 + 손그림 풀·꽃 점경
  ctx.fillStyle = "#fbf7ee";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawHillBand(0.06, HEIGHT * 0.70, 130, 620, "#f2ebdb");
  drawHillBand(0.16, HEIGHT * 0.80, 90, 460, "#eadfc8");
  drawMeadowDoodles(0.38);
}

function drawHillBand(factor, baseY, height, width, fill) {
  const offset = -(state.cameraX * factor) % width;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(offset - width, HEIGHT);
  ctx.lineTo(offset - width, baseY);
  for (let x = offset - width; x < WIDTH + width; x += width) {
    ctx.quadraticCurveTo(x + width / 2, baseY - height, x + width, baseY);
  }
  ctx.lineTo(WIDTH + width, HEIGHT);
  ctx.closePath();
  ctx.fill();
}

function drawMeadowDoodles(factor) {
  // 월드 좌표 기준 결정적 배치(시드 해시) — 스크롤해도 같은 자리에 그려진다.
  const spacing = 130;
  const scroll = state.cameraX * factor;
  const first = Math.floor(scroll / spacing) - 1;
  const count = Math.ceil(WIDTH / spacing) + 2;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let i = first; i < first + count; i += 1) {
    const seed = ((i * 2654435761) >>> 0) % 1000;
    const x = i * spacing - scroll + (seed % 53);
    const y = HEIGHT * 0.87 + (seed % 47) * (HEIGHT * 0.0014);
    const kind = seed % 3;
    if (kind === 0) {
      drawGrassTuft(x, y);
    } else if (kind === 1) {
      drawDaisy(x, y);
    } else {
      ctx.fillStyle = "rgba(239, 143, 58, 0.5)";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawGrassTuft(x, y) {
  ctx.strokeStyle = "rgba(74, 68, 58, 0.45)";
  ctx.beginPath();
  ctx.moveTo(x - 6, y); ctx.quadraticCurveTo(x - 7, y - 9, x - 9, y - 12);
  ctx.moveTo(x, y); ctx.quadraticCurveTo(x, y - 11, x - 1, y - 15);
  ctx.moveTo(x + 6, y); ctx.quadraticCurveTo(x + 7, y - 9, x + 9, y - 12);
  ctx.stroke();
}

function drawDaisy(x, y) {
  ctx.strokeStyle = "rgba(74, 68, 58, 0.45)";
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x, y - 10);
  ctx.stroke();
  for (let a = 0; a < 5; a += 1) {
    const ang = (a / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(ang) * 4.5, y - 14 + Math.sin(ang) * 4.5, 2.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(239, 143, 58, 0.8)";
  ctx.beginPath();
  ctx.arc(x, y - 14, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawTileObject(object) {
  const frame = state.frames.get(object.frameName);
  if (!frame) return;
  const draw = objectDrawRect(object, frame);
  const r = {
    x: Math.round(draw.x - state.cameraX),
    y: Math.round(draw.y),
    width: Math.round(draw.width),
    height: Math.round(draw.height)
  };
  if (r.x + r.width < -60 || r.x > WIDTH + 60) return;
  drawInkTile(object, r);
}

// --- 보따리 화풍 타일 렌더러 ---
// 타일 아틀라스 대신 잉크 선 + 종이 채움 + 오렌지 포인트로 직접 그린다.
const INK = {
  line: "#3a352e",
  paper: "#fffdf7",
  soft: "rgba(58, 53, 46, 0.32)",
  orange: "#ef8f3a"
};

function inkHash(n) {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

function drawInkTile(object, r) {
  const name = object.frameName;
  if (name === "collectible-coin") return drawInkCoin(r);
  if (name === "portal-exit-complete") return drawInkPortal(r);
  if (name === "hazard-spike-strip") return drawInkSpikes(r);
  if (name === "prop-grass-tuft") return drawInkDoodle(drawGrassTuft, r, 22, 16);
  if (name === "prop-flower") return drawInkDoodle(drawDaisy, r, 16, 24);
  if (name === "prop-bush-clump") return drawInkBush(r);
  // 그 외(플랫폼 계열)는 잔디 종이 블록
  drawInkPlatform(r, Math.round(object.x * 31 + object.y * 7));
}

function drawInkPlatform(r, seed) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const radius = Math.min(16, r.height * 0.18, r.width * 0.18);

  // 종이 블록 몸체
  ctx.beginPath();
  ctx.moveTo(r.x + radius, r.y);
  ctx.arcTo(r.x + r.width, r.y, r.x + r.width, r.y + r.height, radius);
  ctx.arcTo(r.x + r.width, r.y + r.height, r.x, r.y + r.height, radius);
  ctx.arcTo(r.x, r.y + r.height, r.x, r.y, radius);
  ctx.arcTo(r.x, r.y, r.x + r.width, r.y, radius);
  ctx.closePath();
  ctx.fillStyle = "#f7f1e3";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK.line;
  ctx.stroke();

  // 돌 질감: 시드 기반 짧은 가로 선
  ctx.strokeStyle = INK.soft;
  ctx.lineWidth = 2;
  const nDash = Math.max(2, Math.floor(r.width / 80));
  for (let i = 0; i < nDash; i += 1) {
    const h = inkHash(seed + i * 97);
    const dx = r.x + 16 + (h % Math.max(1, r.width - 52));
    const dy = r.y + r.height * 0.42 + ((h >>> 4) % Math.max(1, Math.floor(r.height * 0.42)));
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(dx + 12 + (h % 10), dy);
    ctx.stroke();
  }

  // 윗면 잔디 술 + 이따금 오렌지 점
  const nTuft = Math.max(2, Math.floor(r.width / 56));
  for (let i = 0; i < nTuft; i += 1) {
    const h = inkHash(seed + 991 + i * 53);
    const gx = r.x + 12 + ((i + 0.5) / nTuft) * (r.width - 24) + (h % 11) - 5;
    ctx.strokeStyle = INK.soft;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(gx - 4, r.y + 2);
    ctx.quadraticCurveTo(gx - 5, r.y - 6, gx - 7, r.y - 9);
    ctx.moveTo(gx, r.y + 2);
    ctx.quadraticCurveTo(gx, r.y - 8, gx - 1, r.y - 12);
    ctx.moveTo(gx + 4, r.y + 2);
    ctx.quadraticCurveTo(gx + 5, r.y - 6, gx + 7, r.y - 9);
    ctx.stroke();
    if (h % 5 === 0) {
      ctx.fillStyle = INK.orange;
      ctx.beginPath();
      ctx.arc(gx + 10, r.y - 5, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawInkCoin(r) {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const rad = Math.min(r.width, r.height) * 0.4;
  ctx.save();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK.line;
  ctx.fillStyle = INK.paper;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK.soft;
  ctx.beginPath();
  ctx.arc(cx, cy, rad * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = INK.orange;
  ctx.beginPath();
  ctx.arc(cx, cy, rad * 0.24, 0, Math.PI * 2);
  ctx.fill();
  // 반짝임 표시 (오렌지 짧은 선 2개)
  ctx.strokeStyle = INK.orange;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx + rad * 0.85, cy - rad * 1.05);
  ctx.lineTo(cx + rad * 1.15, cy - rad * 1.35);
  ctx.moveTo(cx + rad * 1.15, cy - rad * 0.6);
  ctx.lineTo(cx + rad * 1.5, cy - rad * 0.75);
  ctx.stroke();
  ctx.restore();
}

function drawInkPortal(r) {
  const cx = r.x + r.width / 2;
  const bottom = r.y + r.height;
  const w = r.width * 0.8;
  const h = r.height * 0.82;
  const x0 = cx - w / 2;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 문 아치 몸체
  ctx.beginPath();
  ctx.moveTo(x0, bottom);
  ctx.lineTo(x0, bottom - h * 0.55);
  ctx.quadraticCurveTo(x0, bottom - h, cx, bottom - h);
  ctx.quadraticCurveTo(x0 + w, bottom - h, x0 + w, bottom - h * 0.55);
  ctx.lineTo(x0 + w, bottom);
  ctx.fillStyle = INK.paper;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK.line;
  ctx.stroke();

  // 안쪽 개구부: 점선 아치 (여정의 경로 느낌)
  const iw = w * 0.56;
  const ih = h * 0.66;
  const ix0 = cx - iw / 2;
  ctx.beginPath();
  ctx.moveTo(ix0, bottom);
  ctx.lineTo(ix0, bottom - ih * 0.5);
  ctx.quadraticCurveTo(ix0, bottom - ih, cx, bottom - ih);
  ctx.quadraticCurveTo(ix0 + iw, bottom - ih, ix0 + iw, bottom - ih * 0.5);
  ctx.lineTo(ix0 + iw, bottom);
  ctx.lineWidth = 3;
  ctx.setLineDash([7, 7]);
  ctx.stroke();
  ctx.setLineDash([]);

  // 개구부 안 오렌지 점 3개
  ctx.fillStyle = INK.orange;
  for (const [dx, dy] of [[0, -ih * 0.42], [-iw * 0.2, -ih * 0.2], [iw * 0.2, -ih * 0.16]]) {
    ctx.beginPath();
    ctx.arc(cx + dx, bottom + dy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 꼭대기 깃발
  ctx.strokeStyle = INK.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, bottom - h);
  ctx.lineTo(cx, bottom - h - 26);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, bottom - h - 26);
  ctx.lineTo(cx + 24, bottom - h - 19);
  ctx.lineTo(cx, bottom - h - 12);
  ctx.closePath();
  ctx.fillStyle = INK.paper;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK.orange;
  ctx.beginPath();
  ctx.arc(cx + 10, bottom - h - 19, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawInkSpikes(r) {
  const n = Math.max(3, Math.round(r.width / 36));
  const w = r.width / n;
  const bridgeTopY = r.y + Math.min(10, r.height * 0.18);
  const spikeTipY = bridgeTopY - r.height * 0.88;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK.line;
  ctx.fillStyle = INK.paper;
  for (let i = 0; i < n; i += 1) {
    const x = r.x + i * w;
    ctx.beginPath();
    ctx.moveTo(x + 2, bridgeTopY);
    ctx.lineTo(x + w / 2, spikeTipY);
    ctx.lineTo(x + w - 2, bridgeTopY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // 끝점 오렌지 (위험 표시)
  ctx.fillStyle = INK.orange;
  for (let i = 0; i < n; i += 1) {
    ctx.beginPath();
    ctx.arc(r.x + i * w + w / 2, spikeTipY + 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawInkBush(r) {
  const cx = r.x + r.width / 2;
  const bottom = r.y + r.height;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK.line;
  ctx.fillStyle = INK.paper;
  const lobes = [
    [cx - r.width * 0.26, bottom - r.height * 0.3, r.width * 0.22, r.height * 0.3],
    [cx + r.width * 0.26, bottom - r.height * 0.28, r.width * 0.2, r.height * 0.28],
    [cx, bottom - r.height * 0.42, r.width * 0.28, r.height * 0.42]
  ];
  for (const [lx, ly, lrx, lry] of lobes) {
    ctx.beginPath();
    ctx.ellipse(lx, ly, lrx, lry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // 잎맥 두 줄 + 오렌지 점
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK.soft;
  ctx.beginPath();
  ctx.moveTo(cx - r.width * 0.12, bottom - r.height * 0.5);
  ctx.quadraticCurveTo(cx - r.width * 0.1, bottom - r.height * 0.3, cx - r.width * 0.14, bottom - r.height * 0.16);
  ctx.moveTo(cx + r.width * 0.1, bottom - r.height * 0.46);
  ctx.quadraticCurveTo(cx + r.width * 0.12, bottom - r.height * 0.28, cx + r.width * 0.08, bottom - r.height * 0.14);
  ctx.stroke();
  ctx.fillStyle = INK.orange;
  ctx.beginPath();
  ctx.arc(cx + r.width * 0.3, bottom - r.height * 0.52, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawInkDoodle(fn, r, baseW, baseH) {
  // 배경 점경용 낙서 함수를 소품 크기에 맞춰 확대해 재사용
  const s = Math.min(r.width / baseW, r.height / baseH);
  ctx.save();
  ctx.translate(r.x + r.width / 2, r.y + r.height);
  ctx.scale(s, s);
  ctx.lineWidth = 2.8 / s;
  fn(0, 0);
  ctx.restore();
}

function currentHeroAction() {
  const player = state.player;
  if (player.health <= 0) return "death";
  if (player.invincible > 0.45) return "hurt";
  if (player.attack > 0) return "punch";
  if (!player.grounded) return "jump";
  if (Math.abs(player.vx) > WALK_SPEED * 0.75) return "run";
  if (Math.abs(player.vx) > 1) return "walk";
  return "idle";
}

function drawPlayer() {
  const player = state.player;
  const action = currentHeroAction();
  drawBottari(action, player.x - state.cameraX, player.y, HERO_SCALE, player.facing, player.animTime, player.invincible > 0);
}

// --- 보따리(여행 배낭) 캐릭터 절차적 렌더러 ---
// 스프라이트시트 대신 매 프레임 canvas로 직접 그린다. 원점은 발밑(0,0), 위쪽이 -y.
const BOTTARI = {
  ink: "#3a352e",     // 손그림 잉크 선 (얇은 펜 선)
  body: "#ffffff",    // 종이처럼 밝은 몸통
  orange: "#ef8f3a",  // 점무늬 · 홍조 포인트
  lw: 3.4
};

function bottariCapsule(ax, ay, bx, by, width, fill = BOTTARI.body) {
  // 검은 외곽선 아래 + 밝은 채움 위로 그려 손그림 팔다리 표현
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineWidth = width + BOTTARI.lw;
  ctx.strokeStyle = BOTTARI.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineWidth = width;
  ctx.strokeStyle = fill;
  ctx.stroke();
}

function bottariBlob(cx, cy, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = BOTTARI.lw;
  ctx.lineJoin = "round";
  ctx.strokeStyle = BOTTARI.ink;
  ctx.stroke();
}

function bottariRoundRect(x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = BOTTARI.lw;
  ctx.lineJoin = "round";
  ctx.strokeStyle = BOTTARI.ink;
  ctx.stroke();
}

function drawBottari(action, x, y, scale, facing, time, blink) {
  let lean = 0;
  let footFront = 0, footBack = 0, footLift = 0;
  let armSwing = 0, punchExt = 0, armRaise = 0;
  let shake = 0, rot = 0;
  let blush = 0, eyes = "open";

  if (action === "walk") {
    const p = time * 8;
    footFront = Math.sin(p) * 12;
    footBack = -Math.sin(p) * 12;
    armSwing = Math.sin(p) * 5;
  } else if (action === "run") {
    const p = time * 12;
    footFront = Math.sin(p) * 18;
    footBack = -Math.sin(p) * 18;
    armSwing = Math.sin(p) * 8;
    lean = 0.08;
  } else if (action === "jump") {
    footLift = 8;
    armRaise = 1;
  } else if (action === "punch") {
    punchExt = Math.sin(Math.min(1, time / 0.22) * Math.PI);
    lean = 0.04 * punchExt;
  } else if (action === "hurt") {
    const pr = Math.min(1, time / 0.4);
    lean = -0.13 * (1 - pr);
    shake = Math.sin(time * 40) * 2.5 * (1 - pr);
    blush = 1;
  } else if (action === "death") {
    const pr = Math.min(1, time / 0.5);
    rot = 0.72 * pr;
    eyes = "x";
    footFront = 8;
    footBack = -8;
  }

  ctx.save();
  if (blink) ctx.globalAlpha = Math.floor(time * 18) % 2 ? 0.45 : 1;
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  ctx.scale(scale, scale);

  const P = BOTTARI;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  function strokeSketch(width = 3.4, alpha = 0.35) {
    ctx.lineWidth = width;
    ctx.strokeStyle = P.ink;
    ctx.stroke();
    ctx.save();
    ctx.translate(1.1, -0.7);
    ctx.globalAlpha *= alpha;
    ctx.lineWidth = Math.max(1, width * 0.45);
    ctx.strokeStyle = P.ink;
    ctx.stroke();
    ctx.restore();
  }

  function hatch(lines, width = 1.5) {
    ctx.strokeStyle = "rgba(58, 53, 46, 0.78)";
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const [ax, ay, bx, by] of lines) {
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }

  function fillStrokePath(fill, width = 3.8) {
    ctx.fillStyle = fill;
    ctx.fill();
    strokeSketch(width);
  }

  function drawBigBundle() {
    ctx.save();
    ctx.translate(-88, -83);
    ctx.rotate(-0.14);
    ctx.beginPath();
    ctx.ellipse(0, 0, 38, 44, 0, 0, Math.PI * 2);
    fillStrokePath(P.orange, 4.1);
    hatch([
      [-31, -18, -15, -33],
      [-35, -4, -11, -29],
      [-34, 11, -4, -21],
      [-27, 25, 6, -10],
      [-4, 37, 25, 6]
    ], 1.15);
    ctx.fillStyle = "#ffffff";
    for (const [dx, dy, r] of [[-25, -18, 7], [-8, -25, 5.5], [15, -20, 6.5], [-23, 2, 6], [0, 1, 7], [24, 6, 5.8], [-11, 24, 6.5], [14, 28, 5.5]]) {
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(2, -38);
    ctx.quadraticCurveTo(-18, -57, -33, -41);
    ctx.quadraticCurveTo(-26, -22, -2, -31);
    ctx.moveTo(7, -37);
    ctx.quadraticCurveTo(31, -58, 39, -33);
    ctx.quadraticCurveTo(25, -20, 8, -28);
    fillStrokePath(P.orange, 3);
    ctx.beginPath();
    ctx.arc(3, -35, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = P.ink;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3, -35, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = P.orange;
    ctx.fill();
    ctx.restore();
  }

  function drawBody() {
    ctx.beginPath();
    ctx.moveTo(-58, -22);
    ctx.bezierCurveTo(-75, -62, -74, -148, -35, -180);
    ctx.bezierCurveTo(-10, -199, 45, -184, 61, -142);
    ctx.bezierCurveTo(81, -89, 64, -23, 31, -8);
    ctx.bezierCurveTo(8, 2, -40, -2, -58, -22);
    ctx.closePath();
    fillStrokePath(P.body, 4.4);

    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.45;
    ctx.beginPath();
    ctx.moveTo(-52, -27);
    ctx.bezierCurveTo(-66, -72, -66, -143, -28, -174);
    ctx.stroke();
    ctx.strokeStyle = "rgba(58, 53, 46, 0.58)";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-42, -32);
    ctx.bezierCurveTo(-56, -83, -51, -145, -18, -174);
    ctx.moveTo(-22, -181);
    ctx.bezierCurveTo(-35, -125, -34, -45, -21, -18);
    ctx.moveTo(-4, -184);
    ctx.bezierCurveTo(-7, -125, -2, -47, 7, -17);
    ctx.stroke();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(53, -136);
    ctx.bezierCurveTo(69, -89, 57, -42, 31, -14);
    ctx.stroke();

    hatch([
      [-64, -45, -50, -52],
      [-67, -57, -52, -64],
      [-68, -70, -54, -78],
      [-63, -151, -48, -159],
      [-55, -164, -39, -171],
      [-35, -9, -10, -14],
      [-11, -7, 22, -12]
    ], 1.25);

    ctx.fillStyle = P.body;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.roundRect(-61, -128, 12, 23, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-55, -105);
    ctx.lineTo(-53, -82);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(-61, -88, 11, 17, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-55, -71);
    ctx.lineTo(-55, -56);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-55, -48, 10, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawPocketAndFace() {
    ctx.beginPath();
    ctx.roundRect(-6, -82, 76, 52, 16);
    fillStrokePath(P.body, 3.3);
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, -60);
    ctx.quadraticCurveTo(31, -54, 64, -62);
    ctx.stroke();
    ctx.strokeStyle = "rgba(58, 53, 46, 0.48)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(4, -76);
    ctx.lineTo(5, -34);
    for (const sx of [-1, 1, 3, 5, 7]) {
      ctx.moveTo(sx * 8 + 18, -31);
      ctx.lineTo(sx * 8 + 21, -31);
    }
    ctx.stroke();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(20, -58);
    ctx.lineTo(17, -44);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(16, -40, 2.8, 5, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (eyes === "x") {
      ctx.lineWidth = 3;
      for (const ex of [3, 40]) {
        ctx.beginPath();
        ctx.moveTo(ex - 5, -131); ctx.lineTo(ex + 5, -121);
        ctx.moveTo(ex + 5, -131); ctx.lineTo(ex - 5, -121);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = P.ink;
      for (const ex of [3, 40]) {
        ctx.beginPath();
        ctx.ellipse(ex, -126, 4.0, 7.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.moveTo(15, -105);
    ctx.quadraticCurveTo(23, -99, 31, -106);
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = P.ink;
    ctx.stroke();
    if (blush) {
      ctx.strokeStyle = P.orange;
      ctx.lineWidth = 2;
      for (const [bx, by] of [[55, -118], [59, -113]]) {
        ctx.beginPath();
        ctx.moveTo(bx - 3, by + 4);
        ctx.lineTo(bx + 4, by - 3);
        ctx.stroke();
      }
    }
  }

  ctx.strokeStyle = "rgba(58, 53, 46, 0.25)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-112, 2); ctx.lineTo(-79, -7);
  ctx.moveTo(-36, -3); ctx.lineTo(12, -8);
  ctx.moveTo(26, -3); ctx.lineTo(64, -1);
  ctx.stroke();

  if (shake) ctx.translate(shake, 0);
  if (rot) { ctx.translate(-6, -10); ctx.rotate(rot); ctx.translate(6, 10); }
  ctx.rotate(lean);

  bottariCapsule(-40, -160, -70, -112, 11);
  drawBigBundle();
  bottariBlob(-24 + footBack, -8 - footLift - Math.max(0, footBack) * 0.2, 13, 9, P.body);
  bottariBlob(24 + footFront, -8 - footLift - Math.max(0, footFront) * 0.2, 13, 9, P.body);

  ctx.fillStyle = P.body;
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = P.lw;
  ctx.beginPath();
  ctx.roundRect(-15, -214, 30, 38, 13);
  ctx.fill();
  strokeSketch(3.5, 0.28);
  ctx.beginPath();
  ctx.roundRect(-7, -206, 14, 24, 7);
  strokeSketch(2.1, 0.2);

  drawBody();
  drawPocketAndFace();

  if (punchExt > 0) {
    const hx = 67 + punchExt * 54;
    const hy = -88 + punchExt * 4;
    bottariCapsule(58, -91, hx, hy, 12);
    bottariBlob(hx, hy, 8.5, 8.5, P.body);
  } else if (armRaise) {
    bottariCapsule(62, -96, 74, -126, 11);
    bottariBlob(74, -126, 8, 8, P.body);
  } else {
    bottariCapsule(63, -94, 73 + armSwing, -74, 11);
    bottariBlob(73 + armSwing, -74, 8, 8, P.body);
  }

  ctx.restore();
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    drawInkImp(enemy.x - state.cameraX, enemy.y, enemy.facing, enemy.animTime, enemy.attack > 0);
  }
}

function drawProjectiles() {
  for (const projectile of state.projectiles) {
    const x = projectile.x - state.cameraX;
    if (x < -40 || x > WIDTH + 40) continue;
    drawInkStone(x, projectile.y, projectile.radius, projectile.time * projectile.spin);
  }
}

function drawInkStone(x, y, radius, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = "#b8aa91";
  ctx.strokeStyle = INK.line;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-radius * 0.9, -radius * 0.25);
  ctx.quadraticCurveTo(-radius * 0.62, -radius * 1.02, radius * 0.15, -radius * 0.84);
  ctx.quadraticCurveTo(radius * 0.95, -radius * 0.6, radius * 0.82, radius * 0.18);
  ctx.quadraticCurveTo(radius * 0.48, radius * 0.98, -radius * 0.38, radius * 0.82);
  ctx.quadraticCurveTo(-radius * 1.05, radius * 0.46, -radius * 0.9, -radius * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(58, 53, 46, 0.28)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-radius * 0.2, -radius * 0.42);
  ctx.lineTo(radius * 0.42, -radius * 0.18);
  ctx.moveTo(-radius * 0.34, radius * 0.22);
  ctx.lineTo(radius * 0.2, radius * 0.46);
  ctx.stroke();
  ctx.restore();
}

// 보따리 화풍 적: 뿔 달린 심술 보퉁이(잉크 도깨비)
function drawInkImp(x, y, facing, time, attacking) {
  const step = Math.sin(time * 7) * 8;
  const fill = "#ece5d4"; // 주인공(흰색)과 구분되는 어두운 종이 톤
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);

  // 발밑 그림자
  ctx.beginPath();
  ctx.ellipse(0, -3, 38, 7, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(70, 60, 45, 0.10)";
  ctx.fill();

  ctx.rotate(attacking ? 0.16 : 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 두 발
  bottariBlob(-13 - step, -7, 12, 8, fill);
  bottariBlob(13 + step, -7, 12, 8, fill);

  // 뿔 두 개 (몸통이 아랫부분을 덮음)
  ctx.fillStyle = fill;
  ctx.strokeStyle = INK.line;
  ctx.lineWidth = 3.5;
  for (const hx of [-20, 20]) {
    ctx.beginPath();
    ctx.moveTo(hx - 8, -100);
    ctx.lineTo(hx, -122);
    ctx.lineTo(hx + 8, -100);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 몸통: 둥근 보퉁이
  bottariRoundRect(-40, -110, 80, 96, 32, fill);

  // 이마 주름(꿰맨 자국) — 심술 표시
  ctx.strokeStyle = INK.soft;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-10, -102); ctx.lineTo(10, -102);
  ctx.moveTo(-6, -107); ctx.lineTo(-2, -98);
  ctx.moveTo(6, -107); ctx.lineTo(2, -98);
  ctx.stroke();

  // 얼굴: 성난 눈썹 + 점 눈 + 삐죽 입
  ctx.strokeStyle = INK.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-19, -84); ctx.lineTo(-7, -78);
  ctx.moveTo(19, -84); ctx.lineTo(7, -78);
  ctx.stroke();
  ctx.fillStyle = INK.line;
  for (const ex of [-12, 12]) {
    ctx.beginPath();
    ctx.arc(ex, -71, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-9, -58);
  ctx.lineTo(-3, -63);
  ctx.lineTo(3, -58);
  ctx.lineTo(9, -63);
  ctx.stroke();

  // 팔: 공격 시 앞으로 뻗음, 평소엔 짧은 팔
  if (attacking) {
    bottariCapsule(30, -62, 58, -56, 10, fill);
    bottariBlob(58, -56, 8, 8, fill);
  } else {
    bottariBlob(40, -60, 8, 12, fill);
  }

  ctx.restore();
}

function drawVignette() {
  // 밝은 종이 배경에 맞춘 아주 옅은 웜톤 비네트
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, "rgba(214, 192, 152, 0.10)");
  gradient.addColorStop(0.5, "rgba(214, 192, 152, 0)");
  gradient.addColorStop(1, "rgba(150, 118, 74, 0.08)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

boot().catch((error) => {
  console.error(error);
  ui.overlayKicker.textContent = "불러오기 오류";
  ui.overlayTitle.textContent = "에셋을 불러올 수 없습니다.";
  ui.overlay.classList.add("is-visible");
});
