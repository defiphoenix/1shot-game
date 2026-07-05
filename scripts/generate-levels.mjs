import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../games/hero-quest/assets/levels");

const TOTAL_LEVELS = 18;

// Simple Mulberry32 PRNG for deterministic generation
function mulberry32(a) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

function generateLevel(index) {
  // Use index as seed so each level is deterministically generated
  const random = mulberry32(12345 + index * 987);

  const block = Math.floor((index - 1) / 3);
  const stageType = (index - 1) % 3; // 0: Basic, 1: Obstacles, 2: Enemies
  
  const boundsWidth = 1600 + block * 800;
  const objects = [];
  
  // Starting platform
  objects.push({
    "id": "start-platform",
    "frameName": "platform-long-grass-stone",
    "x": 300,
    "y": 564,
    "scale": 0.727,
    "depth": 10
  });

  let lastRight = 300 + (510 * 0.727) / 2; // start platform right edge
  let lastY = 564;
  let objId = 1;
  let spikeCount = 0;
  let enemyCount = 0;
  const themedCandidates = []; // medium platforms that can host the stage's themed object

  const typeLabels = ["Basic Route", "Spike Path", "Orc Territory"];

  // Place platforms
  while (lastRight < boundsWidth - 800) {
    const gapX = 80 + block * 10 + random() * 50; // Gap 80-130 + block scaling
    const climb = (random() - 0.4) * 60; // Max climb 36
    const curY = Math.max(300, Math.min(650, lastY - climb));
    
    // Choose platform
    const isSmall = random() < 0.3;
    const frame = isSmall ? "platform-short-grass-stone" : "platform-medium-grass-stone";
    const rawWidth = isSmall ? 150 : 250;
    const scaledWidth = rawWidth * 0.727;
    
    const curX = lastRight + gapX + scaledWidth / 2;

    objects.push({
      "id": `plat-${objId}`,
      "frameName": frame,
      "x": Math.round(curX),
      "y": Math.round(curY),
      "scale": 0.727,
      "depth": 10
    });

    // Place Coin
    if (random() < 0.6 || objId % 2 === 0) {
      objects.push({
        "id": `coin-${objId}`,
        "frameName": "collectible-coin",
        "x": Math.round(curX),
        "y": Math.round(curY - 80),
        "scale": 0.727,
        "depth": 24
      });
    }

    // Place Hazards or Enemies
    if (stageType >= 1 && !isSmall) {
      themedCandidates.push({ objId, x: curX, y: curY });
      if (random() < 0.3 + block * 0.1) {
        if (stageType === 1 || (stageType === 2 && random() < 0.5)) {
          placeSpike(objId, curX, curY);
        } else if (stageType === 2) {
          placeOrc(objId, curX, curY);
        }
      }
    }

    lastRight = curX + scaledWidth / 2;
    lastY = curY;
    objId++;
  }

  // The themed placement above is probabilistic, so a stage can roll zero of
  // its namesake object. Guarantee at least one so the title matches the level.
  if (themedCandidates.length > 0) {
    const fallback = themedCandidates[Math.floor(themedCandidates.length / 2)];
    if (stageType === 1 && spikeCount === 0) {
      placeSpike(fallback.objId, fallback.x, fallback.y);
    }
    if (stageType === 2 && enemyCount === 0) {
      placeOrc(fallback.objId, fallback.x, fallback.y);
    }
  }

  function placeSpike(id, curX, curY) {
    spikeCount++;
    objects.push({
      "id": `hazard-${id}`,
      "frameName": "hazard-spike-strip",
      "x": Math.round(curX),
      "y": Math.round(curY - 10),
      "scale": 0.727,
      "depth": 15
    });

    // Add a floating ledge above to allow safe passage
    objects.push({
      "id": `safe-ledge-${id}`,
      "frameName": "platform-floating-ledge",
      "x": Math.round(curX),
      "y": Math.round(curY - 120 - random() * 20),
      "scale": 0.727,
      "depth": 10
    });
  }

  function placeOrc(id, curX, curY) {
    enemyCount++;
    objects.push({
      "id": `enemy-${id}`,
      "frameName": "enemy-v3-purple-orc",
      "x": Math.round(curX),
      "y": Math.round(curY - 56),
      "scale": 1,
      "depth": 20
    });
  }

  const endGapX = 100 + random() * 40;
  const endCurX = lastRight + endGapX + (510 * 0.727) / 2;
  
  // End platform
  objects.push({
    "id": "end-platform",
    "frameName": "platform-long-grass-stone",
    "x": Math.round(endCurX),
    "y": Math.round(lastY),
    "scale": 0.727,
    "depth": 10
  });

  objects.push({
    "id": "exit-portal",
    "frameName": "portal-exit-complete",
    "x": Math.round(endCurX + 100),
    "y": Math.round(lastY - 60),
    "scale": 0.727,
    "depth": 12
  });

  return {
    "version": 1,
    "savedAt": "2026-07-05T00:00:00.000Z",
    "level": {
      "version": 1,
      "id": `level-${index}`,
      "title": `Stage ${index}: ${typeLabels[stageType]}`,
      "width": boundsWidth,
      "height": 720,
      "bounds": {
        "x": 0,
        "y": 0,
        "width": boundsWidth,
        "height": 720
      },
      "playerStart": {
        "x": 142,
        "y": 368
      },
      "objects": objects
    }
  };
}

const indexData = {
  "version": 1,
  "levels": []
};

for (let i = 1; i <= TOTAL_LEVELS; i++) {
  const levelData = generateLevel(i);
  const filePath = path.join(OUT_DIR, `level-${i}.json`);
  fs.writeFileSync(filePath, JSON.stringify(levelData, null, 2), "utf8");
  
  indexData.levels.push({
    "id": `level-${i}`,
    "title": levelData.level.title,
    "url": `/assets/levels/level-${i}.json`
  });
}

fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(indexData, null, 2), "utf8");

console.log(`Successfully generated ${TOTAL_LEVELS} levels.`);
