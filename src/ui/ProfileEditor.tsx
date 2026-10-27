import * as React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PROFILE_COLORS, useProfiles } from '../data/profiles';
import type { Profile } from '../data/types';
import { Avatar } from './Avatar';

const DEFAULT_WEIGHT_KG = 75;
const MIN_WEIGHT_KG = 30;
const MAX_WEIGHT_KG = 160;

/** Create or edit a rider. Deleting asks twice because it also deletes their ride history. */
export const ProfileEditor = ({ profile, onClose }: { profile: Profile | null; onClose: () => void }) => {
  const { profiles, add, edit, remove, select } = useProfiles();
  const unusedColor =
    PROFILE_COLORS.find((c) => !profiles.some((p) => p.color === c)) ?? PROFILE_COLORS[0] ?? '#ff5a1f';
  const [name, setName] = React.useState(profile?.name ?? '');
  const [color, setColor] = React.useState(profile?.color ?? unusedColor);
  const [weightKg, setWeightKg] = React.useState(profile?.weightKg ?? DEFAULT_WEIGHT_KG);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const trimmed = name.trim();
  const nudgeWeight = (delta: number) =>
    setWeightKg((w) => Math.min(MAX_WEIGHT_KG, Math.max(MIN_WEIGHT_KG, Math.round(w + delta))));

  const deleteProfile = (id: number) => {
    remove(id);
    onClose();
  };

  const save = () => {
    if (!trimmed) return;
    if (profile) {
      edit(profile.id, { name: trimmed, color, weightKg });
    } else {
      select(add({ name: trimmed, color, weightKg }));
    }
    onClose();
  };

  return (
    <View style={styles.backdrop}>
      <View style={styles.panel}>
        <View style={styles.headerRow}>
          <Avatar color={color} name={trimmed || '?'} size={72} />
          <Text style={styles.title}>{profile ? 'Edit rider' : 'New rider'}</Text>
        </View>

        <Text style={styles.label}>NAME</Text>
        <TextInput
          autoFocus={!profile}
          maxLength={20}
          onChangeText={setName}
          onSubmitEditing={save}
          placeholder='Who is this?'
          placeholderTextColor='#5b6573'
          returnKeyType='done'
          style={styles.input}
          value={name}
        />

        <Text style={styles.label}>COLOUR</Text>
        <View style={styles.swatches}>
          {PROFILE_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              style={[styles.swatch, { backgroundColor: c }, c === color && styles.swatchActive]}
            />
          ))}
        </View>

        <Text style={styles.label}>WEIGHT</Text>
        <View style={styles.weightRow}>
          <Pressable onPress={() => nudgeWeight(-1)} style={styles.stepper}>
            <Text style={styles.stepperText}>−</Text>
          </Pressable>
          <Text style={styles.weight}>{weightKg} kg</Text>
          <Pressable onPress={() => nudgeWeight(1)} style={styles.stepper}>
            <Text style={styles.stepperText}>+</Text>
          </Pressable>
          <Text style={styles.hint}>
            Used for climbing physics: lighter riders go uphill faster for the same watts.
          </Text>
        </View>

        <View style={styles.actions}>
          {profile ? (
            <Pressable
              onPress={() => (confirmingDelete ? deleteProfile(profile.id) : setConfirmingDelete(true))}
              style={[styles.button, styles.danger]}
            >
              <Text style={styles.buttonText}>
                {confirmingDelete ? `Delete ${profile.name} and their rides` : 'Delete'}
              </Text>
            </Pressable>
          ) : null}
          <View style={styles.spacer} />
          <Pressable onPress={onClose} style={[styles.button, styles.secondary]}>
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
          <Pressable disabled={!trimmed} onPress={save} style={[styles.button, !trimmed && styles.disabled]}>
            <Text style={styles.buttonText}>{profile ? 'Save' : 'Create'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(5, 8, 12, 0.75)',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 40
  },
  panel: { width: 640, backgroundColor: '#161c25', borderRadius: 20, padding: 26 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 10 },
  title: { color: '#fff', fontSize: 30, fontWeight: '900' },
  label: { color: '#9aa4b2', fontSize: 13, fontWeight: '800', letterSpacing: 1.5, marginTop: 16, marginBottom: 8 },
  input: {
    backgroundColor: '#0d1117',
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  swatches: { flexDirection: 'row', gap: 12 },
  swatch: { width: 46, height: 46, borderRadius: 23, borderWidth: 3, borderColor: 'transparent' },
  swatchActive: { borderColor: '#fff' },
  weightRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepper: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2a3442',
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepperText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  weight: { color: '#fff', fontSize: 26, fontWeight: '800', minWidth: 90, textAlign: 'center' },
  hint: { color: '#9aa4b2', fontSize: 13, flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 26 },
  spacer: { flex: 1 },
  button: { backgroundColor: '#ff5a1f', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 14 },
  secondary: { backgroundColor: '#2a3442' },
  danger: { backgroundColor: '#7a1d22' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' }
});
