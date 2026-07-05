import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetDir = resolve(rootDir, "games/hero-quest/assets");
const playerWidth = 54;
const playerHeight = 118;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readGameConstant(name) {
  const source = readFileSync(resolve(rootDir, "games/hero-quest/game.js"), "utf8");
  const match = source.match(new RegExp(`const ${name} = (\\d+);`));
  assert.ok(match, `${name} should be declared as a numeric constant`);
  return Number(match[1]);
}

function objectRect(object, frame, collision = frame.collision ?? frame.trigger ?? frame.bounds) {
  const scale = object.scale ?? 1;
  const anchor = frame.anchor ?? { x: 0.5, y: 1 };
  const drawX = object.x - frame.bounds.width * scale * anchor.x;
  const drawY = object.y - frame.bounds.height * scale * anchor.y;
  const source = frame.collision ?? frame.trigger
    ? collision
    : { x: 0, y: 0, width: frame.bounds.width, height: frame.bounds.height };

  return {
    x: drawX + source.x * scale,
    y: drawY + source.y * scale,
    width: source.width * scale,
    height: source.height * scale
  };
}

function horizontalGap(a, b) {
  if (a.x + a.width < b.x) return b.x - (a.x + a.width);
  if (b.x + b.width < a.x) return a.x - (b.x + b.width);
  return 0;
}

function jumpRangeForClimb(climb, constants) {
  if (climb <= 0) {
    return constants.walkSpeed * (2 * constants.jumpSpeed / constants.gravity) - 30;
  }

  const discriminant = constants.jumpSpeed ** 2 - 2 * constants.gravity * climb;
  if (discriminant < 0) return -Infinity;
  return constants.walkSpeed * ((constants.jumpSpeed + Math.sqrt(discriminant)) / constants.gravity) - 30;
}

function collectReachablePlatforms(level, frames, constants) {
  const platforms = level.objects.flatMap((object) => {
    const frame = frames.get(object.frameName);
    if (!frame || (frame.kind !== "whole-platform" && frame.kind !== "repeatable-tile")) {
      return [];
    }

    return [{ id: object.id, rect: objectRect(object, frame) }];
  });

  const reachable = new Set();
  for (const platform of platforms) {
    const horizontal =
      level.playerStart.x >= platform.rect.x - playerWidth / 2 &&
      level.playerStart.x <= platform.rect.x + platform.rect.width + playerWidth / 2;
    const belowStart = platform.rect.y >= level.playerStart.y - playerHeight;

    if (horizontal && belowStart) reachable.add(platform.id);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const from of platforms) {
      if (!reachable.has(from.id)) continue;
      for (const to of platforms) {
        if (reachable.has(to.id)) continue;

        const climb = from.rect.y - to.rect.y;
        if (horizontalGap(from.rect, to.rect) <= jumpRangeForClimb(climb, constants)) {
          reachable.add(to.id);
          changed = true;
        }
      }
    }
  }

  return { platforms, reachable };
}

function coinIsReachable(coin, platforms, reachable, frames) {
  const rect = objectRect(coin, frames.get(coin.frameName));

  return platforms.some((platform) => {
    if (!reachable.has(platform.id)) return false;
    const horizontal =
      rect.x < platform.rect.x + platform.rect.width + playerWidth / 2 &&
      rect.x + rect.width > platform.rect.x - playerWidth / 2;
    const vertical =
      rect.y + rect.height > platform.rect.y - playerHeight - 12 &&
      rect.y < platform.rect.y + 24;

    return horizontal && vertical;
  });
}

function portalIsReachable(portal, platforms, reachable) {
  return platforms.some((platform) => (
    reachable.has(platform.id) &&
    portal.x >= platform.rect.x - 30 &&
    portal.x <= platform.rect.x + platform.rect.width + 30
  ));
}

test("hero quest levels remain jumpable with the current player physics", () => {
  const constants = {
    gravity: readGameConstant("GRAVITY"),
    walkSpeed: readGameConstant("WALK_SPEED"),
    jumpSpeed: readGameConstant("JUMP_SPEED")
  };
  const index = readJson(resolve(assetDir, "levels/index.json"));
  const manifest = readJson(resolve(assetDir, "tiles/quest/atlas-transparent.manifest.json"));
  const frames = new Map(manifest.frames.map((frame) => [frame.name, frame]));
  const signatures = new Map();

  assert.equal(index.levels.length, 10);

  for (const entry of index.levels) {
    const payload = readJson(resolve(assetDir, `levels/${entry.id}.json`));
    const level = payload.level ?? payload;
    const signature = createHash("sha1")
      .update(JSON.stringify(level.objects.map((object) => [object.frameName, object.x, object.y])))
      .digest("hex");

    assert.equal(level.id, entry.id);
    assert.ok(!signatures.has(signature), `${entry.id} should not duplicate ${signatures.get(signature)}`);
    signatures.set(signature, entry.id);

    for (const object of level.objects) {
      assert.ok(
        frames.has(object.frameName) || object.frameName === "enemy-v3-purple-orc",
        `${entry.id} references unknown frame ${object.frameName}`
      );
    }

    const { platforms, reachable } = collectReachablePlatforms(level, frames, constants);
    assert.equal(reachable.size, platforms.length, `${entry.id} should have no unreachable platforms`);

    const unreachableCoins = level.objects
      .filter((object) => object.frameName === "collectible-coin")
      .filter((coin) => !coinIsReachable(coin, platforms, reachable, frames))
      .map((coin) => coin.id);
    assert.deepEqual(unreachableCoins, [], `${entry.id} should have reachable required coins`);

    const unreachablePortals = level.objects
      .filter((object) => object.frameName === "portal-exit-complete")
      .filter((portal) => !portalIsReachable(portal, platforms, reachable))
      .map((portal) => portal.id);
    assert.deepEqual(unreachablePortals, [], `${entry.id} should have a reachable exit portal`);
  }
});
