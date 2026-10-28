import { StyleSheet, Text, View } from 'react-native';

import { useBike } from '../bike/store';
import {
  CHALLENGE_STYLE,
  type ChallengeResult,
  DRILL_PASS,
  DRILL_S,
  DRILLS,
  type DrillKind,
  isGate,
  streakMultiplier
} from '../game/challenges';
import { type HudChallenge, useHud } from '../game/hudStore';

/** How long a gate or drill result stays up, race seconds. */
const RESULT_S = 2.5;

const formatWatts = (watts: { lo: number; hi: number }) =>
  Number.isFinite(watts.hi) ? `${watts.lo}–${watts.hi} W` : `${watts.lo}+ W`;

const drillTarget = (kind: DrillKind, watts: HudChallenge['watts']) => {
  const { minRpm, maxRpm } = DRILLS[kind];
  const rpm = Number.isFinite(maxRpm) ? `${minRpm}–${maxRpm} rpm` : `${minRpm}+ rpm`;
  return watts ? `${rpm} at ${formatWatts(watts)}` : rpm;
};

/** Live power against a gate's band, so the rider can settle into it on the approach. */
const GateApproach = ({ challenge }: { challenge: HudChallenge }) => {
  const power = useBike((s) => Math.round(s.sample.power));
  const { watts } = challenge;
  if (!watts) return null;
  const inBand = power >= watts.lo && power <= watts.hi;
  return (
    <>
      <Text style={styles.target}>{formatWatts(watts)}</Text>
      <Text style={styles.detail}>
        in {Math.ceil(challenge.inM)} m · now <Text style={inBand ? styles.onTarget : styles.offTarget}>{power} W</Text>
      </Text>
    </>
  );
};

const DrillProgress = ({ challenge, kind }: { challenge: HudChallenge; kind: DrillKind }) => {
  const cadence = useBike((s) => Math.round(s.sample.cadence));
  const color = CHALLENGE_STYLE[kind].color;
  if (challenge.secondsLeft === null) {
    return (
      <>
        <Text style={styles.target}>{drillTarget(kind, challenge.watts)}</Text>
        <Text style={styles.detail}>
          for {DRILL_S} s · starts in {Math.ceil(challenge.inM)} m
        </Text>
      </>
    );
  }
  const passing = challenge.onTarget >= DRILL_PASS;
  return (
    <>
      <Text style={styles.target}>{drillTarget(kind, challenge.watts)}</Text>
      <Text style={styles.detail}>
        {Math.ceil(challenge.secondsLeft)} s left · now {cadence} rpm ·{' '}
        <Text style={passing ? styles.onTarget : styles.offTarget}>{Math.round(challenge.onTarget * 100)}%</Text> on
        target
      </Text>
      <View style={styles.track}>
        <View
          style={[styles.fill, { backgroundColor: color, width: `${(1 - challenge.secondsLeft / DRILL_S) * 100}%` }]}
        />
      </View>
    </>
  );
};

const Upcoming = ({ challenge }: { challenge: HudChallenge }) => {
  const { label, color } = CHALLENGE_STYLE[challenge.kind];
  return (
    <View style={[styles.panel, { borderColor: color }]}>
      <Text style={[styles.title, { color }]}>{label}</Text>
      {isGate(challenge.kind) ? (
        <GateApproach challenge={challenge} />
      ) : (
        <DrillProgress challenge={challenge} kind={challenge.kind} />
      )}
    </View>
  );
};

const Result = ({ result }: { result: ChallengeResult }) => (
  <Text style={[styles.result, { color: result.success ? CHALLENGE_STYLE[result.kind].color : '#9aa4b2' }]}>
    {result.success ? `+${result.points}` : 'MISSED'}
  </Text>
);

/** Score, the next gate or drill as it comes up, and a flash of each result. */
export const ChallengeHud = () => {
  const challenges = useHud((s) => s.challenges);
  const elapsed = useHud((s) => s.elapsed);
  if (!challenges) return null;
  const { upcoming, last, score, streak } = challenges;
  return (
    <View pointerEvents='none' style={styles.root}>
      {last && elapsed - last.at < RESULT_S && <Result result={last} />}
      {upcoming && <Upcoming challenge={upcoming} />}
      <Text style={styles.score}>
        {score} pts{!!streak && `  ·  streak ×${streakMultiplier(streak)}`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  // Stacked above the elevation strip, bottom centre.
  root: { position: 'absolute', bottom: 112, alignSelf: 'center', alignItems: 'center', gap: 6 },
  panel: {
    backgroundColor: 'rgba(10, 14, 20, 0.78)',
    borderRadius: 12,
    borderWidth: 2,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: 'center',
    minWidth: 300
  },
  title: { fontSize: 15, fontWeight: '900', letterSpacing: 2 },
  target: { color: '#fff', fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  detail: { color: '#cfd6df', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  onTarget: { color: '#5be38f', fontWeight: '800' },
  offTarget: { color: '#ff8a5c', fontWeight: '800' },
  track: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginTop: 6
  },
  fill: { height: 8, borderRadius: 4 },
  result: {
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowRadius: 8
  },
  score: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    backgroundColor: 'rgba(10, 14, 20, 0.72)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    overflow: 'hidden'
  }
});
