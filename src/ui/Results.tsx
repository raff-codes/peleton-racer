import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PersonalBest } from '../data/session';
import { useHud } from '../game/hudStore';
import { PLAYER_ID, type RideMode } from '../game/race';
import { useSettings } from '../game/settings';

/** Race seconds after crossing before results appear, so the slow-motion finish plays out first. */
const RESULTS_DELAY_S = 2.5;

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

const formatRaceTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

/** "New personal best" with the margin, or how far off the existing best this ride was. */
const PersonalBestLine = ({ pb, finishedAt }: { pb: PersonalBest | null; finishedAt: number }) => {
  if (!pb) return null;
  if (pb.isPb) {
    return (
      <Text style={styles.pb}>
        New personal best{pb.previousS !== null ? `  −${formatRaceTime(pb.previousS - finishedAt)}` : ''}
      </Text>
    );
  }
  return (
    <Text style={styles.pbMissed}>
      Best {formatRaceTime(pb.previousS ?? finishedAt)} (+{formatRaceTime(finishedAt - (pb.previousS ?? finishedAt))})
    </Text>
  );
};

/** Final classification and the player's numbers, shown once they've crossed the line. */
export const Results = ({ mode }: { mode: RideMode }) => {
  const { finishedAt, elapsed, position, standings, stats, restart, personalBest } = useHud();
  const endRide = useSettings((s) => s.endRide);
  if (finishedAt === null || elapsed < finishedAt + RESULTS_DELAY_S) return null;

  const winnerTime = standings[0]?.finishedAt ?? null;

  return (
    <View style={styles.panel}>
      <Text style={styles.place}>
        {standings.length > 1 ? `${ORDINALS[position - 1] ?? `${position}th`} place` : 'Time trial complete'}
      </Text>
      <Text style={styles.time}>{formatRaceTime(finishedAt)}</Text>

      <PersonalBestLine finishedAt={finishedAt} pb={personalBest} />
      {standings.length > 1 ? (
        <View style={styles.table}>
          {standings.map((r, i) => {
            const you = r.id === PLAYER_ID;
            let result: string;
            if (r.finishedAt === null) result = `${(Math.max(0, -r.gapM) / 1000).toFixed(2)} km to go`;
            else if (i === 0 || winnerTime === null) result = formatRaceTime(r.finishedAt);
            else result = `+${formatRaceTime(r.finishedAt - winnerTime)}`;
            return (
              <View key={r.id} style={[styles.row, you && styles.rowYou]}>
                <Text style={styles.pos}>{i + 1}</Text>
                <View style={[styles.swatch, { backgroundColor: r.color }]} />
                <Text style={[styles.name, you && styles.nameYou]}>{r.name}</Text>
                <Text style={styles.result}>{result}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.stats}>
        <Stat label='AVG POWER' value={`${Math.round(stats.avgPower)} W`} />
        <Stat label='MAX POWER' value={`${Math.round(stats.maxPower)} W`} />
        <Stat label='AVG SPEED' value={`${stats.avgSpeedKmh.toFixed(1)} km/h`} />
        <Stat label='MAX SPEED' value={`${stats.maxSpeedKmh.toFixed(1)} km/h`} />
        <Stat label='IN THE DRAFT' value={`${Math.round(stats.draftSeconds)} s`} />
      </View>

      <View style={styles.buttons}>
        <Pressable onPress={restart} style={styles.button}>
          <Text style={styles.buttonText}>{mode === 'race' ? 'Race again' : 'Ride again'}</Text>
        </Pressable>
        <Pressable onPress={endRide} style={[styles.button, styles.buttonSecondary]}>
          <Text style={styles.buttonText}>Main menu</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 120,
    left: 24,
    width: 600,
    backgroundColor: 'rgba(10, 14, 20, 0.86)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center'
  },
  place: { color: '#ff8a5c', fontSize: 40, fontWeight: '900' },
  time: { color: '#fff', fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 },
  pb: { color: '#ffd23f', fontSize: 18, fontWeight: '800', marginTop: 6 },
  pbMissed: { color: '#9aa4b2', fontSize: 16, fontWeight: '600', marginTop: 6 },
  table: { alignSelf: 'stretch', marginTop: 18 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8 },
  rowYou: { backgroundColor: 'rgba(255, 90, 31, 0.18)' },
  pos: { color: '#9aa4b2', width: 26, fontSize: 18, fontWeight: '700' },
  swatch: { width: 12, height: 12, borderRadius: 6, marginRight: 10 },
  name: { color: '#fff', fontSize: 18, flex: 1 },
  nameYou: { fontWeight: '800' },
  result: { color: '#cfd6df', fontSize: 17, fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 18 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: '#fff', fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { color: '#9aa4b2', fontSize: 11, fontWeight: '600', letterSpacing: 1, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 22 },
  buttonSecondary: { backgroundColor: '#334155' },
  button: { backgroundColor: '#ff5a1f', borderRadius: 10, paddingHorizontal: 28, paddingVertical: 14 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '800' }
});
