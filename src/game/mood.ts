/**
 * How the rider looks to be feeling, from their power-to-weight: dozing off when barely turning the
 * pedals, on fire when going hard. Purely cosmetic; the renderer draws it, physics ignores it.
 *
 * W/kg is of rider + bike, so the same effort reads the same for light and heavy riders. Each mood
 * has a separate exit threshold (hysteresis) and needs holding for a moment before it switches, so a
 * single surge or a soft pedal stroke doesn't flicker the effects.
 */
export type Mood = 'normal' | 'sleepy' | 'fire';

export type MoodState = {
  mood: Mood;
  /** Seconds the effort has pointed at a different mood */
  moodPending: number;
};

/** ≈ 70 W for an 85 kg rider + bike. */
const SLEEPY_ENTER_W_PER_KG = 0.8;
const SLEEPY_EXIT_W_PER_KG = 1.1;
/** ≈ 255 W for an 85 kg rider + bike. */
const FIRE_ENTER_W_PER_KG = 3;
const FIRE_EXIT_W_PER_KG = 2.6;

/** How long the effort must hold before switching into each mood. */
const HOLD_S: Record<Mood, number> = { normal: 0.6, sleepy: 3, fire: 1.5 };

/** The mood this effort points at, given the current one. `canSleep` is false once the rider has finished. */
const moodFor = (current: Mood, wPerKg: number, canSleep: boolean): Mood => {
  if (current === 'fire' && wPerKg >= FIRE_EXIT_W_PER_KG) return 'fire';
  if (current === 'sleepy' && canSleep && wPerKg < SLEEPY_EXIT_W_PER_KG) return 'sleepy';
  if (wPerKg >= FIRE_ENTER_W_PER_KG) return 'fire';
  if (canSleep && wPerKg < SLEEPY_ENTER_W_PER_KG) return 'sleepy';
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
