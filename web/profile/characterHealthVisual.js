/**
 * Buddy health visuals.
 *
 * Cat Buddy (7 levels). Session starts at 100 (cat.png).
 * 100 → cat.png … 0 → cat7.png
 *
 * Moon Buddy (5 levels). Session starts at 100 → moon1.
 * 80–100 → moon1.png (stage 1 / yaybunny)
 * 60–79  → moon2.png (stage 2 / sleepbunny)
 * 40–59  → moon3.png
 * 20–39  → moon4.png
 * 0–19   → moon5.png (gravestone)
 *
 * Progression during lock-in:
 * - 1 minute on-task → next happier stage
 * - 1 minute distracted → next sadder stage
 */

export const CHARACTER_HEALTH_STAGES = 7;
export const MOON_HEALTH_STAGES = 5;

/** Highest → lowest health values for each cat stage. */
export const HEALTH_STAGE_VALUES = [100, 80, 65, 50, 35, 20, 0];

/** Even bands for Moon Buddy (stage 1 = highest). */
export const MOON_HEALTH_THRESHOLDS = [80, 60, 40, 20, 0];

const MOON_STAGE_FILES = [
  "/moon1.png",
  "/moon2.png",
  "/moon3.png",
  "/moon4.png",
  "/moon5.png",
];

/** Health at the start of every lock-in session. */
export const SESSION_START_HEALTH = 100;

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
 * Moon Buddy stage 1–5 (1 = healthiest).
 * @param {number} health 0–100
 * @returns {number}
 */
export function moonBuddyStage(health) {
  const h = Math.max(0, Math.min(100, Number(health) || 0));
  if (h >= 80) return 1;
  if (h >= 60) return 2;
  if (h >= 40) return 3;
  if (h >= 20) return 4;
  return 5;
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
 * Image path for Moon Buddy at the given health.
 * @param {number} health 0–100
 * @returns {string}
 */
export function moonBuddySrcForHealth(health) {
  return MOON_STAGE_FILES[moonBuddyStage(health) - 1];
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
    src: moonBuddySrcForHealth(health),
    alt: "",
    name: "Moon Buddy",
  };
}
