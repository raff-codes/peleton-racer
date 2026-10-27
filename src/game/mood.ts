/**
 * How the rider looks to be feeling, from their power-to-weight: dozing off when barely turning the
 * pedals, then warming up, on fire, and finally an inferno the harder they go. Purely cosmetic; the
 * renderer draws it, physics ignores it.
 *
 * W/kg is of rider + bike, so the same effort reads the same for light and heavy riders. Each mood
 * has a separate exit threshold (hysteresis) and needs holding for a moment before it switches, so a
 * single surge or a soft pedal stroke doesn't flicker the effects.
 */
export type Mood = 'sleepy' | 'normal' | 'warm' | 'fire' | 'inferno';

export type MoodState = {
  mood: Mood;
  /** Seconds the effort has pointed at a different mood */
  moodPending: number;
};

/**
 * The hot moods, coolest first. Reaching one takes `enter` W/kg; once there (or hotter), it holds
 * down to `exit`. For an 85 kg rider + bike: warm ≈ 190 W, fire ≈ 255 W, inferno ≈ 340 W.
 */
export const HOT_MOODS = [
  { mood: 'warm', enter: 2.2, exit: 1.9 },
  { mood: 'fire', enter: 3, exit: 2.6 },
  { mood: 'inferno', enter: 4, exit: 3.5 }
] as const satisfies readonly { mood: Mood; enter: number; exit: number }[];

/** ≈ 70 W for an 85 kg rider + bike. */
export const SLEEPY_ENTER_W_PER_KG = 0.8;
const SLEEPY_EXIT_W_PER_KG = 1.1;

/** How long the effort must hold before switching into each mood. */
const HOLD_S: Record<Mood, number> = { sleepy: 3, normal: 0.6, warm: 1.5, fire: 1.2, inferno: 1.2 };

const heat = (mood: Mood) => HOT_MOODS.findIndex((level) => level.mood === mood);

/** The mood this effort points at, given the current one. `canSleep` is false once the rider has finished. */
const moodFor = (current: Mood, wPerKg: number, canSleep: boolean): Mood => {
  const currentHeat = heat(current);
  for (let i = HOT_MOODS.length - 1; i >= 0; i--) {
    const level = HOT_MOODS[i] as (typeof HOT_MOODS)[number];
    if (wPerKg >= (currentHeat >= i ? level.exit : level.enter)) return level.mood;
  }
  if (canSleep && wPerKg < (current === 'sleepy' ? SLEEPY_EXIT_W_PER_KG : SLEEPY_ENTER_W_PER_KG)) return 'sleepy';
  return 'normal';
};

export const stepMood = (state: MoodState, power: number, massKg: number, dt: number, canSleep: boolean) => {
  const target = moodFor(state.mood, power / massKg, canSleep);
  if (target === state.mood) {
    state.moodPending = 0;
    return;
  }
  state.moodPending += dt;
  if (state.moodPending >= HOLD_S[target]) {
    state.mood = target;
    state.moodPending = 0;
  }
};
