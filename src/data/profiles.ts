import { create } from 'zustand';

import { createProfile, deleteProfile, listProfiles, updateProfile } from './db';
import type { NewProfile, Profile } from './types';

/** Jersey colours offered when creating a profile; picked to stay distinct from each other and the bots. */
export const PROFILE_COLORS = ['#ff5a1f', '#e63946', '#f4a261', '#ffd23f', '#2a9d8f', '#4cc9f0', '#7b61ff', '#f15bb5'];

type ProfilesStore = {
  profiles: Profile[];
  /** Who's riding; null shows the "Who's riding?" picker. */
  activeId: number | null;
  select: (id: number) => void;
  /** Back to the picker, e.g. to hand the bike to someone else. */
  switchRider: () => void;
  add: (profile: NewProfile) => number;
  edit: (id: number, profile: NewProfile) => void;
  remove: (id: number) => void;
};

export const useProfiles = create<ProfilesStore>((set) => ({
  profiles: listProfiles(),
  activeId: null,
  select: (id) => set({ activeId: id }),
  switchRider: () => set({ activeId: null }),
  add: (profile) => {
    const id = createProfile(profile);
    set({ profiles: listProfiles() });
    return id;
  },
  edit: (id, profile) => {
    updateProfile(id, profile);
    set({ profiles: listProfiles() });
  },
  remove: (id) => {
    deleteProfile(id);
    set((s) => ({ profiles: listProfiles(), activeId: s.activeId === id ? null : s.activeId }));
  }
}));

export const useActiveProfile = (): Profile | null =>
  useProfiles((s) => s.profiles.find((p) => p.id === s.activeId) ?? null);

export const activeProfile = (): Profile | null => {
  const { profiles, activeId } = useProfiles.getState();
  return profiles.find((p) => p.id === activeId) ?? null;
};
