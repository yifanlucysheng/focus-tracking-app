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
 * Progression during lock-in:
 * - 1s distracted → −1 health (floor at 0)
 * - 2s on-task → +1 health (cap at 95)
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
  if (h >= 95) return 0;
  if (h >= 80) return 1;
  if (h >= 65) return 2;
  if (h >= 50) return 3;
  if (h >= 35) return 4;
  if (h >= 20) return 5;
  return 6;
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
