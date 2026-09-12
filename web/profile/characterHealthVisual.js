/**
 * Cat Buddy health stages (7 levels). Session starts at 95 (cat.png).
 *
 * 95 → cat.png   (session start / healthiest)
 * 80 → cat2.png
 * 65 → cat3.png
 * 50 → cat4.png
 * 35 → cat5.png
 * 20 → cat6.png
 * 0  → cat7.png
 *
 * Progression (after 10s on the same tab; no stage changes in the first 20s of lock-in):
 * - 2 min on-task → one stage healthier (cap at 95)
 * - 1 min distracted → one stage lower (floor at 0)
 */

export const CHARACTER_HEALTH_STAGES = 7;

/** Highest → lowest health values for each cat stage. */
export const HEALTH_STAGE_VALUES = [95, 80, 65, 50, 35, 20, 0];

/** Health at the start of every lock-in session. */
export const SESSION_START_HEALTH = 95;

/**
 * @param {number} health 0–100
 * @returns {number} 0–6 (0 = healthiest)
 */
export function characterHealthStage(health) {
  const h = Math.max(0, Math.min(100, Number(health) || 0));
  let best = 0;
  let bestDist = Math.abs(HEALTH_STAGE_VALUES[0] - h);
  for (let i = 1; i < HEALTH_STAGE_VALUES.length; i += 1) {
    const dist = Math.abs(HEALTH_STAGE_VALUES[i] - h);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * @param {number} stage 0–6
 * @returns {number}
 */
export function healthForStage(stage) {
  const i = Math.max(0, Math.min(HEALTH_STAGE_VALUES.length - 1, Math.floor(stage)));
  return HEALTH_STAGE_VALUES[i];
}

/**
 * Image path for Cat Buddy at the given health.
 * @param {number} health 0–100
 * @returns {string}
 */
export function catBuddySrcForHealth(health) {
  const stage = characterHealthStage(health);
  if (stage <= 0) return "/cat.png";
  return `/cat${stage + 1}.png`;
}

/**
 * @param {string} [characterId]
 * @param {number} [health]
 * @returns {{ src: string, alt: string, name: string }}
 */
export function buddyVisualForHealth(characterId, health = SESSION_START_HEALTH) {
  if (characterId === "cat") {
    return {
      src: catBuddySrcForHealth(health),
      alt: "",
      name: "Cat Buddy",
    };
  }
  return {
    src: "/sleepbunny.png",
    alt: "",
    name: "Moon Buddy",
  };
}
