import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBike } from '../bike/store';
import { useHud } from '../game/hudStore';
import type { GameMap } from '../game/maps';
import type { RideMode, RideSetup } from '../game/race';
import { PLAYER_ID } from '../game/race';
import { useSettings } from '../game/settings';
import { ElevationProfile } from './ElevationProfile';
import { PauseMenu } from './PauseMenu';
import { Results } from './Results';

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const Stat = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
  <View style={styles.stat}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>
      {value}
      {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
    </Text>
  </View>
);

const MetricsBar = () => {
  const sample = useBike((s) => s.sample);
  const { speedKmh, gradePct, lap, laps, elapsed, distanceM } = useHud();
  return (
    <View style={styles.metrics}>
      <Stat label='POWER' unit='W' value={Math.round(sample.power).toString()} />
      <Stat label='CADENCE' unit='rpm' value={Math.round(sample.cadence).toString()} />
      <Stat label='RESISTANCE' value={Math.round(sample.resistance).toString()} />
      <Stat label='SPEED' unit='km/h' value={speedKmh.toFixed(1)} />
      <Stat label='GRADE' unit='%' value={gradePct.toFixed(1)} />
      <Stat label='LAP' value={Number.isFinite(laps) ? `${lap}/${laps}` : `${lap}`} />
      <Stat label='DIST' unit='km' value={(distanceM / 1000).toFixed(2)} />
      <Stat label='TIME' value={formatTime(elapsed)} />
    </View>
  );
};

const Standings = () => {
  const standings = useHud((s) => s.standings);
  return (
    <View style={styles.standings}>
      {standings.map((r, i) => (
        <View key={r.id} style={styles.standingRow}>
          <Text style={styles.standingPos}>{i + 1}</Text>
          <View style={[styles.swatch, { backgroundColor: r.color }]} />
          <Text style={[styles.standingName, r.id === PLAYER_ID && styles.standingYou]}>{r.name}</Text>
          <Text style={styles.standingGap}>
            {r.finishedAt !== null
              ? formatTime(r.finishedAt)
              : r.id === PLAYER_ID
                ? ''
                : `${r.gapM >= 0 ? '+' : ''}${Math.round(r.gapM)} m`}
          </Text>
        </View>
      ))}
    </View>
  );
};

/** Shows only while sitting in someone's slipstream. */
const DraftChip = () => {
  const draftPct = useHud((s) => s.draftPct);
  if (draftPct < 5) return null;
  return (
    <View style={styles.draft}>
      <Text style={styles.draftTitle}>IN THE DRAFT</Text>
      <Text style={styles.draftText}>−{Math.round(draftPct)}% drag</Text>
    </View>
  );
};

const ConnectionBadge = () => {
  const { source, state, detail, simPower, nudgeSimPower } = useBike();
  const fps = useHud((s) => s.fps);
  const { quality, toggleQuality, pause } = useSettings();
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>
        {source === 'peloton' ? `Peloton: ${state}` : 'Simulator'}
        {detail && source === 'peloton' && state !== 'connected' ? ` (${detail})` : ''} · {fps} fps
      </Text>
      <View style={styles.badgeRow}>
        <Pressable onPress={toggleQuality} style={styles.qualityButton}>
          <Text style={styles.qualityText}>Graphics: {quality === 'high' ? 'High' : 'Low'}</Text>
        </Pressable>
        <Pressable onPress={pause} style={styles.qualityButton}>
          <Text style={styles.qualityText}>Menu</Text>
        </Pressable>
      </View>
      {source === 'simulator' ? (
        <View style={styles.simRow}>
          <Pressable onPress={() => nudgeSimPower(-25)} style={styles.simButton}>
            <Text style={styles.simButtonText}>−25 W</Text>
          </Pressable>
          <Text style={styles.badgeText}>{simPower} W</Text>
          <Pressable onPress={() => nudgeSimPower(25)} style={styles.simButton}>
            <Text style={styles.simButtonText}>+25 W</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

/** How long "GO!" stays up after the countdown. */
const GO_DISPLAY_S = 1;

const START_PROMPT: Record<RideMode, string> = {
  race: 'Start pedalling to race',
  timeTrial: 'Start pedalling to start the clock',
  freeRide: 'Start pedalling to ride'
};

const Banner = ({ mode }: { mode: RideMode }) => {
  const { phase, countdown, elapsed } = useHud();

  if (phase === 'waiting') {
    return (
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>{START_PROMPT[mode]}</Text>
      </View>
    );
  }
  if (phase === 'countdown' || elapsed < GO_DISPLAY_S) {
    return (
      <View pointerEvents='none' style={styles.countdown}>
        <Text style={styles.countdownText}>{phase === 'countdown' ? Math.ceil(countdown) : 'GO!'}</Text>
      </View>
    );
  }
  return null;
};

const LAP_CALLOUT_MS = 3000;

/** Flashes "LAP n" / "FINAL LAP" as the player starts each new lap. */
const LapCallout = () => {
  const lap = useHud((s) => s.lap);
  const laps = useHud((s) => s.laps);
  const [shownLap, setShownLap] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (lap <= 1) return;
    setShownLap(lap);
    const id = setTimeout(() => setShownLap(null), LAP_CALLOUT_MS);
    return () => clearTimeout(id);
  }, [lap]);

  if (shownLap === null) return null;
  return (
    <View pointerEvents='none' style={styles.callout}>
      <Text style={styles.calloutText}>{shownLap === laps ? 'FINAL LAP' : `LAP ${shownLap}`}</Text>
    </View>
  );
};

const SPRINT_M = 300;

/** Count-down to the line for the last few hundred metres. */
const SprintChip = () => {
  const remainingM = useHud((s) => s.remainingM);
  const racing = useHud((s) => s.phase === 'racing' && s.finishedAt === null);
  if (!racing || remainingM > SPRINT_M) return null;
  return (
    <View pointerEvents='none' style={styles.sprint}>
      <Text style={styles.sprintTitle}>SPRINT</Text>
      <Text style={styles.sprintDistance}>{Math.ceil(remainingM)} m</Text>
      <View style={styles.sprintTrack}>
        <View style={[styles.sprintFill, { width: `${(1 - remainingM / SPRINT_M) * 100}%` }]} />
      </View>
    </View>
  );
};

/** The elevation strip takes the map's meadow colour so it matches the scenery. */
const profileColor = (map: GameMap) =>
  map.theme.terrain.bands[Math.floor(map.theme.terrain.bands.length / 2)]?.color ?? '#9fd27f';

export const Hud = ({ map, setup }: { map: GameMap; setup: RideSetup }) => {
  const insets = useSafeAreaInsets();
  const finished = useHud((s) => s.finishedAt !== null);
  // Bots in a race, or household ghosts in a time trial.
  const hasRivals = useHud((s) => s.standings.length > 1);
  return (
    // The 3D scene stays full-bleed; the overlay sits inside the safe area so system bars never cover it.
    <View
      pointerEvents='box-none'
      style={[
        StyleSheet.absoluteFill,
        { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right }
      ]}
    >
      <MetricsBar />
      {finished ? null : (
        <>
          {hasRivals ? <Standings /> : null}
          <DraftChip />
          <ElevationProfile color={profileColor(map)} track={map.track} />
          <LapCallout />
          <SprintChip />
        </>
      )}
      <ConnectionBadge />
      <Banner mode={setup.mode} />
      <Results mode={setup.mode} />
      <PauseMenu />
    </View>
  );
};

const panel = { backgroundColor: 'rgba(10, 14, 20, 0.72)', borderRadius: 12 } as const;

const styles = StyleSheet.create({
  metrics: {
    ...panel,
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10
  },
  stat: { alignItems: 'center', minWidth: 90 },
  statLabel: { color: '#9aa4b2', fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  statValue: { color: '#fff', fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statUnit: { color: '#9aa4b2', fontSize: 15, fontWeight: '500' },
  standings: {
    ...panel,
    position: 'absolute',
    top: 110,
    right: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 250
  },
  // Compact rows: a full field of ten has to fit above the elevation strip.
  standingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  standingPos: { color: '#9aa4b2', width: 24, fontSize: 15, fontWeight: '700' },
  swatch: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  standingName: { color: '#fff', fontSize: 15, flex: 1 },
  standingYou: { fontWeight: '800', color: '#ff8a5c' },
  standingGap: { color: '#cfd6df', fontSize: 14, fontVariant: ['tabular-nums'], marginLeft: 12 },
  badge: { ...panel, position: 'absolute', bottom: 16, left: 16, padding: 10 },
  badgeText: { color: '#cfd6df', fontSize: 14 },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  qualityButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  qualityText: { color: '#cfd6df', fontSize: 13, fontWeight: '600' },
  simRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  simButton: { backgroundColor: '#ff5a1f', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  simButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  banner: { ...panel, position: 'absolute', alignSelf: 'center', top: '40%', padding: 24, alignItems: 'center' },
  bannerTitle: { color: '#fff', fontSize: 34, fontWeight: '800' },
  countdown: { position: 'absolute', alignSelf: 'center', top: '30%' },
  countdownText: {
    color: '#fff',
    fontSize: 140,
    fontWeight: '900',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowRadius: 12
  },
  draft: { ...panel, position: 'absolute', top: 110, left: 16, paddingHorizontal: 14, paddingVertical: 10 },
  draftTitle: { color: '#7fd1ff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  draftText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  callout: { position: 'absolute', alignSelf: 'center', top: '24%' },
  calloutText: {
    color: '#ffd23f',
    fontSize: 72,
    fontWeight: '900',
    letterSpacing: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowRadius: 10
  },
  sprint: {
    ...panel,
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    alignItems: 'center',
    padding: 12,
    width: 260
  },
  sprintTitle: { color: '#ff8a5c', fontSize: 16, fontWeight: '900', letterSpacing: 3 },
  sprintDistance: { color: '#fff', fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sprintTrack: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginTop: 6
  },
  sprintFill: { height: 8, borderRadius: 4, backgroundColor: '#ff5a1f' }
});
