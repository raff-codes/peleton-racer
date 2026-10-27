import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { courseBests, listRides, profileTotals } from '../data/db';
import { useActiveProfile } from '../data/profiles';
import type { BestRide, RideRecord } from '../data/types';
import { MAPS, mapById } from '../game/maps';
import type { RideMode } from '../game/race';
import { useSettings } from '../game/settings';
import { Avatar } from './Avatar';

const MODE_LABEL: Record<RideMode, string> = { race: 'Race', timeTrial: 'Time trial', freeRide: 'Free ride' };
const LEADERBOARD_LAPS = [1, 2, 3, 5];
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds - h * 3600 - m * 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${s.toFixed(0).padStart(2, '0')}`
    : `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

/** Total time in the saddle: minutes until there's an hour of it. */
const formatRideTime = (seconds: number) =>
  seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`;

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const RideRow = ({ ride }: { ride: RideRecord }) => {
  const map = mapById(ride.mapId);
  return (
    <View style={styles.rideRow}>
      <View style={styles.rideMain}>
        <Text style={styles.rideTitle}>
          {map.name} · {MODE_LABEL[ride.mode]}
          {ride.laps > 0 ? ` · ${ride.laps} ${ride.laps === 1 ? 'lap' : 'laps'}` : ''}
        </Text>
        <Text style={styles.rideMeta}>
          {formatDate(ride.startedAt)} · {(ride.distanceM / 1000).toFixed(1)} km · {Math.round(ride.avgPower)} W avg ·{' '}
          {ride.avgSpeedKmh.toFixed(1)} km/h
        </Text>
      </View>
      <View style={styles.rideResult}>
        <Text style={styles.rideTime}>{formatDuration(ride.durationS)}</Text>
        <Text style={styles.ridePlace}>
          {!ride.finished
            ? 'not finished'
            : ride.place !== null
              ? (ORDINALS[ride.place - 1] ?? `${ride.place}th`)
              : 'finished'}
        </Text>
      </View>
    </View>
  );
};

const Leaderboard = ({ title, bests }: { title: string; bests: BestRide[] }) => (
  <View style={styles.board}>
    <Text style={styles.boardTitle}>{title}</Text>
    {bests.slice(0, 5).map((b, i) => (
      <View key={b.profileId} style={styles.boardRow}>
        <Text style={styles.boardPos}>{i + 1}</Text>
        <Avatar color={b.profileColor} name={b.profileName} size={24} />
        <Text style={styles.boardName}>{b.profileName}</Text>
        <Text style={styles.boardTime}>{formatDuration(b.durationS)}</Text>
      </View>
    ))}
  </View>
);

/** Who did what: the active rider's rides and totals, and the household's best time on every course. */
export const History = () => {
  const profile = useActiveProfile();
  const showMenu = useSettings((s) => s.showMenu);
  const { rides, totals, boards } = React.useMemo(() => {
    if (!profile) return { rides: [], totals: null, boards: [] };
    return {
      rides: listRides(profile.id),
      totals: profileTotals(profile.id),
      boards: MAPS.flatMap((m) =>
        LEADERBOARD_LAPS.map((laps) => ({
          title: `${m.name} · ${laps} ${laps === 1 ? 'lap' : 'laps'}`,
          bests: courseBests(m.id, laps)
        }))
      ).filter((b) => b.bests.length > 0)
    };
  }, [profile]);

  if (!profile || !totals) return null;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={showMenu} style={styles.back}>
          <Text style={styles.backText}>‹ Menu</Text>
        </Pressable>
        <Avatar color={profile.color} name={profile.name} size={56} />
        <Text style={styles.title}>{profile.name}</Text>
        <View style={styles.totals}>
          <Text style={styles.total}>
            {totals.rides} {totals.rides === 1 ? 'ride' : 'rides'}
          </Text>
          <Text style={styles.total}>{(totals.distanceM / 1000).toFixed(1)} km</Text>
          <Text style={styles.total}>{formatRideTime(totals.durationS)}</Text>
        </View>
      </View>

      <View style={styles.columns}>
        <View style={styles.column}>
          <Text style={styles.sectionTitle}>RIDES</Text>
          <ScrollView contentContainerStyle={styles.list}>
            {rides.length ? (
              rides.map((r) => <RideRow key={r.id} ride={r} />)
            ) : (
              <Text style={styles.empty}>No rides yet. Finished rides and anything over a minute show up here.</Text>
            )}
          </ScrollView>
        </View>
        <View style={styles.column}>
          <Text style={styles.sectionTitle}>HOUSEHOLD BESTS</Text>
          <ScrollView contentContainerStyle={styles.list}>
            {boards.length ? (
              boards.map((b) => <Leaderboard bests={b.bests} key={b.title} title={b.title} />)
            ) : (
              <Text style={styles.empty}>
                Finish a ride to set the first time on a course. Time trials race everyone's best as ghosts.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d1117', paddingHorizontal: 24, paddingTop: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 18 },
  back: { backgroundColor: '#1a212b', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  backText: { color: '#e6ebf1', fontSize: 18, fontWeight: '800' },
  title: { color: '#fff', fontSize: 32, fontWeight: '900' },
  totals: { flexDirection: 'row', gap: 22, marginLeft: 'auto' },
  total: { color: '#cfd6df', fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  columns: { flex: 1, flexDirection: 'row', gap: 24 },
  column: { flex: 1 },
  sectionTitle: { color: '#9aa4b2', fontSize: 13, fontWeight: '800', letterSpacing: 1.5, marginBottom: 10 },
  list: { gap: 10, paddingBottom: 24 },
  empty: { color: '#7d8796', fontSize: 16 },
  rideRow: { flexDirection: 'row', backgroundColor: '#1a212b', borderRadius: 12, padding: 14, alignItems: 'center' },
  rideMain: { flex: 1 },
  rideTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  rideMeta: { color: '#9aa4b2', fontSize: 13, marginTop: 4 },
  rideResult: { alignItems: 'flex-end' },
  rideTime: { color: '#fff', fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  ridePlace: { color: '#9aa4b2', fontSize: 13, marginTop: 2 },
  board: { backgroundColor: '#1a212b', borderRadius: 12, padding: 14, gap: 8 },
  boardTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 2 },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  boardPos: { color: '#9aa4b2', fontSize: 15, fontWeight: '800', width: 16 },
  boardName: { color: '#e6ebf1', fontSize: 15, fontWeight: '700', flex: 1 },
  boardTime: { color: '#fff', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }
});
