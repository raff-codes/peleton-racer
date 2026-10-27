import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { profileTotals } from '../data/db';
import { useProfiles } from '../data/profiles';
import type { Profile } from '../data/types';
import { Avatar } from './Avatar';
import { ProfileEditor } from './ProfileEditor';

const AVATAR_SIZE = 132;

const ProfileTile = ({ profile, managing, onPress }: { profile: Profile; managing: boolean; onPress: () => void }) => {
  const totals = profileTotals(profile.id);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}>
      <View>
        <Avatar color={profile.color} name={profile.name} size={AVATAR_SIZE} />
        {managing ? (
          <View style={styles.editBadge}>
            <Text style={styles.editBadgeText}>Edit</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.name}>{profile.name}</Text>
      <Text style={styles.meta}>
        {totals.rides} {totals.rides === 1 ? 'ride' : 'rides'} · {(totals.distanceM / 1000).toFixed(0)} km
      </Text>
    </Pressable>
  );
};

/** "Who's riding?": pick a household member, add one, or manage them. */
export const ProfilePicker = () => {
  const { profiles, select } = useProfiles();
  const [managing, setManaging] = React.useState(false);
  const [editing, setEditing] = React.useState<Profile | 'new' | null>(null);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{profiles.length ? "Who's riding?" : 'Welcome! Add the first rider'}</Text>
      <View style={styles.row}>
        {profiles.map((p) => (
          <ProfileTile
            key={p.id}
            managing={managing}
            onPress={() => (managing ? setEditing(p) : select(p.id))}
            profile={p}
          />
        ))}
        <Pressable
          onPress={() => setEditing('new')}
          style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
        >
          <View style={styles.addCircle}>
            <Text style={styles.addPlus}>+</Text>
          </View>
          <Text style={styles.name}>Add rider</Text>
          <Text style={styles.meta}> </Text>
        </Pressable>
      </View>
      {profiles.length ? (
        <Pressable onPress={() => setManaging((m) => !m)} style={styles.manage}>
          <Text style={styles.manageText}>{managing ? 'Done' : 'Manage riders'}</Text>
        </Pressable>
      ) : null}
      {editing ? <ProfileEditor onClose={() => setEditing(null)} profile={editing === 'new' ? null : editing} /> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 44, fontWeight: '900', marginBottom: 44 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 36, maxWidth: 1100 },
  tile: { alignItems: 'center', width: 170 },
  tilePressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  name: { color: '#e6ebf1', fontSize: 22, fontWeight: '800', marginTop: 14 },
  meta: { color: '#7d8796', fontSize: 14, marginTop: 4 },
  addCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 3,
    borderColor: '#3a4554',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center'
  },
  addPlus: { color: '#7d8796', fontSize: 60, fontWeight: '300' },
  editBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: '#0d1117',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#e6ebf1',
    paddingHorizontal: 12,
    paddingVertical: 4
  },
  editBadgeText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  manage: {
    marginTop: 48,
    borderWidth: 2,
    borderColor: '#3a4554',
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 10
  },
  manageText: { color: '#cfd6df', fontSize: 17, fontWeight: '700' }
});
