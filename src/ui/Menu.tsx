import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

import { courseBests } from '../data/db';
import { useActiveProfile, useProfiles } from '../data/profiles';
import { type GameMap, lapStats, MAPS } from '../game/maps';
import { botWattRange, type Difficulty, type RideMode } from '../game/race';
import { useSettings } from '../game/settings';
import type { Track } from '../game/track';
import { createRandom } from '../game/world/noise';
import type { Theme } from '../game/world/theme';
import { Avatar } from './Avatar';

const CARD_WIDTH = 284;
const ART_HEIGHT = 150;
const PROFILE_HEIGHT = 46;

const midBand = (theme: Theme) =>
  theme.terrain.bands[Math.floor(theme.terrain.bands.length / 2)]?.color ?? theme.light.hemiGround;

/**
 * A postcard of the map drawn from its theme: sky gradient, a seeded mountain range with snow
 * caps, the meadow colour and a few trees. Cheap SVG, so the picker doesn't need a 3D render.
 */
const Postcard = ({ theme }: { theme: Theme }) => {
  const { peaks, trees } = React.useMemo(() => {
    const random = createRandom(theme.seed);
    const ridge: { x: number; y: number }[] = [{ x: 0, y: ART_HEIGHT * 0.62 }];
    for (let x = 18; x < CARD_WIDTH; x += 22 + random() * 26) {
      ridge.push({ x, y: ART_HEIGHT * (0.18 + random() * 0.32) });
      ridge.push({ x: x + 12 + random() * 10, y: ART_HEIGHT * (0.45 + random() * 0.15) });
    }
    ridge.push({ x: CARD_WIDTH, y: ART_HEIGHT * 0.5 });
    const scatter = Array.from({ length: 9 }, (_, i) => ({
      x: 10 + random() * (CARD_WIDTH - 20),
      y: ART_HEIGHT * (0.74 + random() * 0.2),
      size: 6 + random() * 8,
      pine: i % 3 !== 0
    }));
    return { peaks: ridge, trees: scatter };
  }, [theme.seed]);

  const ridgePoints = `0,${ART_HEIGHT * 0.72} ${peaks.map((p) => `${p.x},${p.y}`).join(' ')} ${CARD_WIDTH},${ART_HEIGHT * 0.72}`;
  const snowy = theme.mountains.snowLine < 0.75;
  const pine = theme.vegetation.pine[0] ?? '#2c6e44';
  const leafy = theme.vegetation.leafy[0] ?? '#5c9c40';

  return (
    <Svg height={ART_HEIGHT} width={CARD_WIDTH}>
      <Defs>
        <LinearGradient id={`sky-${theme.seed}`} x1='0' x2='0' y1='0' y2='1'>
          <Stop offset='0' stopColor={theme.sky.zenith} />
          <Stop offset='1' stopColor={theme.sky.horizon} />
        </LinearGradient>
      </Defs>
      <Rect fill={`url(#sky-${theme.seed})`} height={ART_HEIGHT} width={CARD_WIDTH} />
      <Circle
        cx={CARD_WIDTH * (0.5 + theme.sky.sunDirection[0] * 0.5)}
        cy={ART_HEIGHT * (0.45 - theme.sky.sunDirection[1] * 0.4)}
        fill={theme.sky.sunColor}
        opacity={0.9}
        r={14}
      />
      <Polygon fill={theme.mountains.base} points={ridgePoints} />
      {snowy
        ? peaks
            .filter((p) => p.y < ART_HEIGHT * 0.36)
            .map((p) => (
              <Polygon
                fill={theme.mountains.snow}
                key={`${p.x}`}
                points={`${p.x - 9},${p.y + 12} ${p.x},${p.y} ${p.x + 9},${p.y + 12}`}
              />
            ))
        : null}
      <Rect fill={midBand(theme)} height={ART_HEIGHT * 0.32} width={CARD_WIDTH} y={ART_HEIGHT * 0.68} />
      {trees.map((t) =>
        t.pine ? (
          <Polygon
            fill={pine}
            key={`${t.x}`}
            points={`${t.x - t.size / 2},${t.y} ${t.x},${t.y - t.size * 1.6} ${t.x + t.size / 2},${t.y}`}
          />
        ) : (
          <Circle cx={t.x} cy={t.y - t.size / 2} fill={leafy} key={`${t.x}`} r={t.size / 2} />
        )
      )}
    </Svg>
  );
};

/** One lap's elevation, so riders can see what kind of course it is. */
const Profile = ({ track, color }: { track: Track; color: string }) => {
  const d = React.useMemo(() => {
    const ys = track.points.map((p) => p.y);
    const min = Math.min(...ys);
    const range = Math.max(1, Math.max(...ys) - min);
    return track.points
      .map((p, i) => {
        const x = (p.distance / track.length) * CARD_WIDTH;
        const y = PROFILE_HEIGHT - 4 - ((p.y - min) / range) * (PROFILE_HEIGHT - 10);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [track]);
  return (
    <Svg height={PROFILE_HEIGHT} width={CARD_WIDTH}>
      <Path d={`${d} L${CARD_WIDTH},${PROFILE_HEIGHT} L0,${PROFILE_HEIGHT} Z`} fill={color} opacity={0.35} />
      <Path d={d} fill='none' stroke={color} strokeWidth={2} />
    </Svg>
  );
};

const MapCard = ({ map, selected, onPress }: { map: GameMap; selected: boolean; onPress: () => void }) => {
  const stats = lapStats(map);
  return (
    <Pressable onPress={onPress} style={[styles.card, selected && styles.cardSelected]}>
      <Postcard theme={map.theme} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{map.name}</Text>
        <Text style={styles.cardTagline}>{map.tagline}</Text>
        <View style={styles.statRow}>
          <Text style={styles.stat}>{stats.lapKm.toFixed(1)} km lap</Text>
          <Text style={styles.stat}>{Math.round(stats.climbM)} m up</Text>
          <Text style={styles.stat}>max {stats.maxGradePct.toFixed(1)}%</Text>
        </View>
      </View>
      <Profile color={midBand(map.theme)} track={map.track} />
    </Pressable>
  );
};

/** A row of mutually exclusive options, sized for a finger on a moving bike. */
const Chips = <T extends string | number | boolean>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string; detail?: string }[];
  value: T;
  onChange: (value: T) => void;
}) => (
  <View style={styles.chips}>
    {options.map((o) => {
      const active = o.value === value;
      return (
        <Pressable
          key={String(o.value)}
          onPress={() => onChange(o.value)}
          style={[styles.chip, active && styles.chipActive]}
        >
          <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{o.label}</Text>
          {o.detail ? <Text style={[styles.chipDetail, active && styles.chipDetailActive]}>{o.detail}</Text> : null}
        </Pressable>
      );
    })}
  </View>
);

const MODES: { value: RideMode; label: string; detail: string }[] = [
  { value: 'race', label: 'Race', detail: 'Beat nine rivals to the line' },
  { value: 'timeTrial', label: 'Time trial', detail: 'Solo, against the clock' },
  { value: 'freeRide', label: 'Free ride', detail: 'No finish line, ride as long as you like' }
];

const LAP_OPTIONS = [1, 2, 3, 5];

const wattDetail = (difficulty: Difficulty) => {
  const { min, max } = botWattRange(difficulty);
  return `${min}–${max} W`;
};

const DIFFICULTIES: { value: Difficulty; label: string; detail: string }[] = [
  { value: 'easy', label: 'Easy', detail: wattDetail('easy') },
  { value: 'normal', label: 'Normal', detail: wattDetail('normal') },
  { value: 'hard', label: 'Hard', detail: wattDetail('hard') }
];

const CHALLENGE_OPTIONS: { value: boolean; label: string; detail: string }[] = [
  { value: false, label: 'Off', detail: 'Just ride' },
  { value: true, label: 'On', detail: 'Power gates, cadence drills' }
];

/** Start screen: pick what to ride, where, and how far. */
const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(1).padStart(4, '0')}`;
};

/** The household ghosts a time trial will race: everyone's best over this course and distance. */
const Ghosts = ({ map, laps }: { map: GameMap; laps: number }) => {
  const bests = React.useMemo(() => courseBests(map.id, laps), [map, laps]);
  return (
    <View style={styles.option}>
      <Text style={styles.optionLabel}>GHOSTS</Text>
      {bests.length ? (
        <View style={styles.ghosts}>
          {bests.slice(0, 4).map((b) => (
            <View key={b.profileId} style={styles.ghost}>
              <Avatar color={b.profileColor} name={b.profileName} size={30} />
              <View>
                <Text style={styles.ghostName}>{b.profileName}</Text>
                <Text style={styles.ghostTime}>{formatTime(b.durationS)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.optionHint}>No times on this course yet. Yours will be the first ghost.</Text>
      )}
    </View>
  );
};

export const Menu = () => {
  const { draft, updateDraft, startRide, showHistory } = useSettings();
  const profile = useActiveProfile();
  const switchRider = useProfiles((s) => s.switchRider);
  const map = MAPS.find((m) => m.id === draft.mapId) ?? (MAPS[0] as GameMap);
  const lapKm = map.track.length / 1000;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.identity}>
          <Pressable onPress={switchRider} style={styles.rider}>
            {profile ? <Avatar color={profile.color} name={profile.name} size={44} /> : null}
            <View>
              <Text style={styles.riderName}>{profile?.name ?? 'Rider'}</Text>
              <Text style={styles.riderSwitch}>Switch rider</Text>
            </View>
          </Pressable>
          <Pressable onPress={showHistory} style={styles.historyButton}>
            <Text style={styles.historyText}>History</Text>
          </Pressable>
        </View>
        <Chips onChange={(mode) => updateDraft({ mode })} options={MODES} value={draft.mode} />
      </View>

      <View style={styles.grid}>
        {MAPS.map((m) => (
          <MapCard key={m.id} map={m} onPress={() => updateDraft({ mapId: m.id })} selected={m.id === draft.mapId} />
        ))}
      </View>

      <View style={styles.footer}>
        {draft.mode === 'freeRide' ? (
          <View style={styles.option}>
            <Text style={styles.optionLabel}>DISTANCE</Text>
            <Text style={styles.optionHint}>Open-ended: end the ride from the menu button whenever you like.</Text>
          </View>
        ) : (
          <View style={styles.option}>
            <Text style={styles.optionLabel}>DISTANCE</Text>
            <Chips
              onChange={(laps) => updateDraft({ laps })}
              options={LAP_OPTIONS.map((laps) => ({
                value: laps,
                label: `${laps} ${laps === 1 ? 'lap' : 'laps'}`,
                detail: `${(lapKm * laps).toFixed(1)} km`
              }))}
              value={draft.laps}
            />
          </View>
        )}
        {draft.mode === 'timeTrial' ? <Ghosts laps={draft.laps} map={map} /> : null}
        {draft.mode === 'race' ? (
          <View style={styles.option}>
            <Text style={styles.optionLabel}>RIVALS</Text>
            <Chips
              onChange={(difficulty) => updateDraft({ difficulty })}
              options={DIFFICULTIES}
              value={draft.difficulty}
            />
          </View>
        ) : null}
        <View style={styles.option}>
          <Text style={styles.optionLabel}>CHALLENGES</Text>
          <Chips
            onChange={(challenges) => updateDraft({ challenges })}
            options={CHALLENGE_OPTIONS}
            value={draft.challenges}
          />
        </View>
        <Pressable onPress={startRide} style={({ pressed }) => [styles.start, pressed && styles.startPressed]}>
          <Text style={styles.startText}>Start</Text>
          <Text style={styles.startDetail}>{map.name}</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0d1117',
    paddingHorizontal: 24,
    paddingVertical: 20,
    justifyContent: 'space-between'
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  rider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  riderName: { color: '#fff', fontSize: 24, fontWeight: '900' },
  riderSwitch: { color: '#9aa4b2', fontSize: 13, fontWeight: '600' },
  historyButton: {
    borderWidth: 2,
    borderColor: '#3a4554',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  historyText: { color: '#cfd6df', fontSize: 16, fontWeight: '800' },
  ghosts: { flexDirection: 'row', gap: 16 },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ghostName: { color: '#e6ebf1', fontSize: 15, fontWeight: '800' },
  ghostTime: { color: '#9aa4b2', fontSize: 13, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', gap: 16, justifyContent: 'center' },
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#1a212b',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'transparent'
  },
  cardSelected: { borderColor: '#ff5a1f' },
  cardBody: { padding: 12 },
  cardTitle: { color: '#fff', fontSize: 21, fontWeight: '800' },
  cardTagline: { color: '#9aa4b2', fontSize: 13, marginTop: 3, minHeight: 34 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  stat: { color: '#e6ebf1', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  footer: { flexDirection: 'row', alignItems: 'flex-end', gap: 28 },
  option: { gap: 8, flexShrink: 1 },
  optionLabel: { color: '#9aa4b2', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  optionHint: { color: '#cfd6df', fontSize: 15, maxWidth: 360 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { backgroundColor: '#1a212b', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, minWidth: 92 },
  chipActive: { backgroundColor: '#ff5a1f' },
  chipLabel: { color: '#e6ebf1', fontSize: 17, fontWeight: '800' },
  chipLabelActive: { color: '#fff' },
  chipDetail: { color: '#9aa4b2', fontSize: 12, marginTop: 2 },
  chipDetailActive: { color: '#ffe3d6' },
  start: {
    marginLeft: 'auto',
    backgroundColor: '#ff5a1f',
    borderRadius: 16,
    paddingHorizontal: 44,
    paddingVertical: 16,
    alignItems: 'center'
  },
  startPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  startText: { color: '#fff', fontSize: 28, fontWeight: '900' },
  startDetail: { color: '#ffe3d6', fontSize: 13, fontWeight: '600' }
});
