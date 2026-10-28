import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBike } from '../bike/store';
import { playerForActiveProfile } from '../data/session';
import { useDevTools } from '../game/devTools';
import { useHud } from '../game/hudStore';
import { HOT_MOODS, type Mood, SLEEPY_ENTER_W_PER_KG } from '../game/mood';

const MOODS: { label: string; mood: Mood | null }[] = [
  { label: 'Auto', mood: null },
  { label: 'Sleepy', mood: 'sleepy' },
  { label: 'Normal', mood: 'normal' },
  { label: 'Warm', mood: 'warm' },
  { label: 'Fire', mood: 'fire' },
  { label: 'Inferno', mood: 'inferno' }
];

/**
 * Simulator targets in the middle of each mood's band, so the real switching (with its holds) can
 * be tried. The open-ended inferno band gets a target this far past its threshold.
 */
const INFERNO_MARGIN_W_PER_KG = 0.6;
const PRESETS: { mood: Mood; wPerKg: number }[] = [
  { mood: 'sleepy', wPerKg: SLEEPY_ENTER_W_PER_KG / 2 },
  { mood: 'normal', wPerKg: (SLEEPY_ENTER_W_PER_KG + HOT_MOODS[0].enter) / 2 },
  ...HOT_MOODS.map((level, i) => ({
    mood: level.mood,
    wPerKg: (level.enter + (HOT_MOODS[i + 1]?.enter ?? level.enter + 2 * INFERNO_MARGIN_W_PER_KG)) / 2
  }))
];

/**
 * In-ride controls for previewing visual states in the emulator. Only shown when the simulator is
 * driving (off the bike), in debug and release builds alike.
 */
export const DevToolbar = () => {
  const insets = useSafeAreaInsets();
  const source = useBike((s) => s.source);
  const simPower = useBike((s) => s.simPower);
  const { moodOverride, setMoodOverride } = useDevTools();
  const mood = useHud((s) => s.mood);
  // Watts depend on the rider's weight; the profile can't change mid-ride.
  const presets = React.useMemo(() => {
    const { massKg } = playerForActiveProfile();
    return PRESETS.map((p) => ({ ...p, watts: Math.round((p.wPerKg * massKg) / 5) * 5 }));
  }, []);

  if (source !== 'simulator') return null;

  return (
    <View pointerEvents='box-none' style={[styles.root, { top: insets.top + 200, left: insets.left + 16 }]}>
      <View style={styles.panel}>
        <Text style={styles.title}>DEV · mood: {mood}</Text>
        <View style={styles.row}>
          {MOODS.map(({ label, mood: option }) => (
            <Chip active={moodOverride === option} key={label} label={label} onPress={() => setMoodOverride(option)} />
          ))}
        </View>
        <Text style={styles.subtitle}>Ride at (real thresholds)</Text>
        <View style={styles.row}>
          {presets.map(({ mood: target, watts }) => (
            <Chip
              active={simPower === watts}
              key={target}
              label={`${watts} W`}
              onPress={() => useBike.setState({ simPower: watts })}
            />
          ))}
        </View>
      </View>
    </View>
  );
};

const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
  <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
    <Text style={styles.chipText}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  root: { position: 'absolute' },
  panel: { backgroundColor: 'rgba(10, 14, 20, 0.72)', borderRadius: 12, padding: 10, gap: 8 },
  title: { color: '#ffd23f', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  subtitle: { color: '#9aa4b2', fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  chipActive: { backgroundColor: '#ff5a1f', borderColor: '#ff5a1f' },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '700' }
});
