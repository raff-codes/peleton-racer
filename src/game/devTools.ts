import { create } from 'zustand';

import type { Mood } from './mood';

/** Development-only knobs, set from the DevToolbar and read by the frame loop. */
type DevToolsStore = {
  /** Forces the player's mood regardless of effort; null lets their watts decide */
  moodOverride: Mood | null;
  setMoodOverride: (mood: Mood | null) => void;
};

export const useDevTools = create<DevToolsStore>((set) => ({
  moodOverride: null,
  setMoodOverride: (moodOverride) => set({ moodOverride })
}));
