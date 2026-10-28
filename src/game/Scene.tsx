import { Canvas, useFrame } from '@react-three/fiber/native';
import * as React from 'react';
import * as THREE from 'three';

import { useBike } from '../bike/store';
import { beginSession, ghostsFor, playerForActiveProfile, saveFinishedRide } from '../data/session';
import { ChallengeMarkers } from './ChallengeMarkers';
import { challengeAt, challengeWatts, DRILL_S } from './challenges';
import { useDevTools } from './devTools';
import { Confetti, FinishLine } from './FinishLine';
import { type HudChallenges, useHud } from './hudStore';
import { MoodEffects } from './MoodEffects';
import type { GameMap } from './maps';
import { RiderPack } from './RiderPack';
import { createRace, PLAYER_ID, type Race, type Rider, type RideSetup, standings, stepRace } from './race';
import { useSettings } from './settings';
import { poseAt, type TrackPose } from './track';
import { createWorld } from './world/createWorld';
import { HIGH, LOW } from './world/quality';
import { ROAD_WIDTH } from './world/types';

const HUD_INTERVAL_S = 0.25;
/** Large frame gaps (app backgrounded, GC pause) would teleport riders; cap the step. */
const MAX_DT = 0.1;

const BASE_FOV = 60;
/** Extra field of view at speed, for a sense of pace. */
const MAX_FOV_BOOST = 14;
const BOT_CADENCE_RPM = 88;

/** Slow motion as the player crosses the line, easing back to real time. */
const SLOWMO_SCALE = 0.3;
const SLOWMO_HOLD_S = 2;
const SLOWMO_EASE_S = 1;
/** Sideways aim offset for the post-race orbit, so the rider isn't behind the results panel. */
const RESULTS_FRAMING_OFFSET_M = 2.6;
const ORBIT_SWEEP_S = 3;

// Scratch vectors for the frame loop, so we don't allocate every frame.
const cameraGoal = new THREE.Vector3();
const lookGoal = new THREE.Vector3();

/**
 * Where the camera wants to be for the race phase:
 * - before the start: in front of the grid, looking back at the riders
 * - racing: chasing from behind, looking down the road
 * - after the finish: orbiting the player
 */
const cameraGoals = (race: Race, p: TrackPose, sinceFinish: number | null) => {
  const rightX = -p.dirZ;
  const rightZ = p.dirX;
  if (sinceFinish !== null && sinceFinish < SLOWMO_HOLD_S + SLOWMO_EASE_S) {
    // Finish-line camera: just past the line, off to one side, watching the rider cross.
    const line = poseAt(race.track, 0);
    cameraGoal.set(line.x + line.dirX * 9 + line.dirZ * 3, line.y + 1.8, line.z + line.dirZ * 9 - line.dirX * 3);
    lookGoal.set(p.x, p.y + 1.1, p.z);
  } else if (sinceFinish !== null) {
    const orbit = sinceFinish - SLOWMO_HOLD_S - SLOWMO_EASE_S;
    // A short sweep that settles, so the framing beside the results panel holds.
    const angle = Math.atan2(p.dirX, p.dirZ) + 0.9 + Math.min(orbit, ORBIT_SWEEP_S) * 0.15;
    const offX = Math.sin(angle);
    const offZ = Math.cos(angle);
    cameraGoal.set(p.x + offX * 6, p.y + 2.4, p.z + offZ * 6);
    // Aim left of the rider so they sit in the right half, clear of the results panel.
    // Camera looks along -off; its screen-left is (-offZ, offX) in the xz plane.
    lookGoal.set(p.x - offZ * RESULTS_FRAMING_OFFSET_M, p.y + 1.1, p.z + offX * RESULTS_FRAMING_OFFSET_M);
  } else if (race.phase !== 'racing') {
    cameraGoal.set(p.x + p.dirX * 9 + rightX * 3, p.y + 2.4, p.z + p.dirZ * 9 + rightZ * 3);
    lookGoal.set(p.x, p.y + 1, p.z);
  } else {
    cameraGoal.set(p.x - p.dirX * 6, p.y + 2.8, p.z - p.dirZ * 6);
    lookGoal.set(p.x + p.dirX * 10, p.y + 1.2, p.z + p.dirZ * 10);
  }
};

const timeScaleAfterFinish = (sinceFinish: number | null) => {
  if (sinceFinish === null || sinceFinish > SLOWMO_HOLD_S + SLOWMO_EASE_S) return 1;
  if (sinceFinish < SLOWMO_HOLD_S) return SLOWMO_SCALE;
  return SLOWMO_SCALE + ((sinceFinish - SLOWMO_HOLD_S) / SLOWMO_EASE_S) * (1 - SLOWMO_SCALE);
};

/**
 * The landscape: terrain, sky, mountains, trees, roadside. Built once per quality level (slow on
 * the tablet), independently of the race so "Race again" doesn't rebuild the world.
 */
const Scenery = ({ map }: { map: GameMap }) => {
  const quality = useSettings((s) => s.quality);
  const preset = quality === 'high' ? HIGH : LOW;
  const world = React.useMemo(() => createWorld(map.track, map.theme, preset), [map, preset]);
  const { fog } = map.theme;
  const elapsed = React.useRef(0);

  React.useEffect(
    () => () => {
      for (const layer of world.layers) layer.dispose();
    },
    [world]
  );

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, MAX_DT);
    elapsed.current += dt;
    for (const layer of world.layers) layer.update?.(dt, elapsed.current, camera);
    const perspective = camera as THREE.PerspectiveCamera;
    if (perspective.far !== preset.drawDistance) {
      perspective.far = preset.drawDistance;
      perspective.updateProjectionMatrix();
    }
  });

  return (
    <>
      <color args={[fog.color]} attach='background' />
      <fog args={[fog.color, fog.near, fog.far]} attach='fog' />
      {world.layers.map((layer, i) => (
        <primitive key={i} object={layer.object} />
      ))}
    </>
  );
};

const World = ({ map, setup }: { map: GameMap; setup: RideSetup }) => {
  const race = React.useMemo<Race>(
    () => createRace(map.track, setup, playerForActiveProfile(), ghostsFor(map, setup)),
    [map, setup]
  );
  const pack = React.useMemo(() => new RiderPack(race.riders), [race]);
  const moods = React.useMemo(() => new MoodEffects(race.riders.length), [race]);
  const confetti = React.useMemo(() => new Confetti(), []);
  const markers = React.useMemo(() => (race.challenges ? new ChallengeMarkers(race, ROAD_WIDTH) : null), [race]);
  const lookTarget = React.useRef(new THREE.Vector3());
  /** Real (unscaled) seconds since the player crossed the line. */
  const sinceFinish = React.useRef<number | null>(null);
  const hudClock = React.useRef({ sinceHud: 0, frames: 0, sinceFps: 0, fps: 0 });

  React.useEffect(() => beginSession(race, map, setup), [race, map, setup]);

  React.useEffect(
    () => () => {
      pack.dispose();
      moods.dispose();
      confetti.dispose();
      markers?.dispose();
    },
    [pack, moods, confetti, markers]
  );

  useFrame(({ camera }, rawDt) => {
    // Paused: the world freezes (riders, clock, finish effects) but the frame still renders.
    const realDt = useSettings.getState().paused ? 0 : Math.min(rawDt, MAX_DT);
    const dt = realDt * timeScaleAfterFinish(sinceFinish.current);
    const { sample } = useBike.getState();
    stepRace(race, sample, dt);

    const player = race.riders.find((r) => r.id === PLAYER_ID) as Rider;
    const { moodOverride } = useDevTools.getState();
    if (moodOverride) player.mood = moodOverride;
    if (player.finishedAt !== null) {
      if (sinceFinish.current === null) {
        sinceFinish.current = 0;
        confetti.burst(race.track, ROAD_WIDTH);
        useHud.getState().setPersonalBest(saveFinishedRide());
      } else {
        sinceFinish.current += realDt;
      }
    }

    pack.update(race, dt, (rider) =>
      rider.id === PLAYER_ID ? sample.cadence : rider.speed > 0.3 ? BOT_CADENCE_RPM : 0
    );
    moods.update(race, pack, dt, camera);
    confetti.update(dt);
    markers?.update(race);

    // Lerp towards the goal to hide corner snapping and blend between camera modes.
    cameraGoals(race, poseAt(race.track, player.distance), sinceFinish.current);
    camera.position.lerp(cameraGoal, Math.min(1, realDt * 3));
    lookTarget.current.lerp(lookGoal, Math.min(1, realDt * 5));
    camera.lookAt(lookTarget.current);
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = BASE_FOV + Math.min(MAX_FOV_BOOST, Math.max(0, (player.speed - 5) * 0.6));
    if (Math.abs(perspective.fov - fov) > 0.05) {
      perspective.fov += (fov - perspective.fov) * Math.min(1, realDt * 2);
      perspective.updateProjectionMatrix();
    }

    const clock = hudClock.current;
    clock.frames++;
    clock.sinceFps += rawDt;
    if (clock.sinceFps >= 1) {
      clock.fps = Math.round(clock.frames / clock.sinceFps);
      clock.frames = 0;
      clock.sinceFps = 0;
    }
    clock.sinceHud += rawDt;
    if (clock.sinceHud >= HUD_INTERVAL_S) {
      clock.sinceHud = 0;
      publishHud(race, clock.fps);
    }
  });

  return (
    <>
      <FinishLine roadWidth={ROAD_WIDTH} track={map.track} />
      <primitive object={pack.root} />
      <primitive object={moods.root} />
      <primitive object={confetti.points} />
      {markers && <primitive object={markers.root} />}
    </>
  );
};

const publishHud = (race: Race, fps: number) => {
  const player = race.riders.find((r) => r.id === PLAYER_ID);
  if (!player) return;
  const order = standings(race);
  useHud.getState().publish({
    speedKmh: player.speed * 3.6,
    distanceM: player.distance,
    lap: Math.min(race.laps, Math.floor(player.distance / race.track.length) + 1),
    laps: race.laps,
    gradePct: poseAt(race.track, player.distance).grade * 100,
    elapsed: race.elapsed,
    phase: race.phase,
    countdown: race.countdown,
    draftPct: player.draft * 100,
    mood: player.mood,
    position: order.findIndex((r) => r.id === PLAYER_ID) + 1,
    standings: order.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      gapM: r.distance - player.distance,
      lapFraction: (r.distance % race.track.length) / race.track.length,
      finishedAt: r.finishedAt
    })),
    finishedAt: player.finishedAt,
    remainingM: Math.max(0, race.track.length * race.laps - player.distance),
    stats: {
      avgPower: race.elapsed > 0 ? race.stats.energyJ / (player.finishedAt ?? race.elapsed) : 0,
      maxPower: race.stats.maxPower,
      avgSpeedKmh: race.elapsed > 0 ? (race.stats.distanceM / (player.finishedAt ?? race.elapsed)) * 3.6 : 0,
      maxSpeedKmh: race.stats.maxSpeed * 3.6,
      draftSeconds: race.stats.draftSeconds
    },
    challenges: hudChallenges(race, player),
    fps
  });
};

/** How far ahead a gate or drill shows in the HUD: long enough to settle into the effort. */
const CHALLENGE_PREVIEW_M = 250;

const hudChallenges = (race: Race, player: Rider): HudChallenges | null => {
  const state = race.challenges;
  if (!state) return null;
  const next = challengeAt(race.track, state.next);
  const inM = next.distance - player.distance;
  const upcoming = () => {
    if (state.drill) {
      const { kind, elapsed, onTarget } = state.drill;
      const watts = challengeWatts(kind, player.massKg);
      return { kind, inM: 0, watts, secondsLeft: DRILL_S - elapsed, onTarget: elapsed > 0 ? onTarget / elapsed : 0 };
    }
    if (inM > CHALLENGE_PREVIEW_M || next.distance >= race.track.length * race.laps) return null;
    return { kind: next.kind, inM, watts: challengeWatts(next.kind, player.massKg), secondsLeft: null, onTarget: 0 };
  };
  return {
    upcoming: upcoming(),
    score: state.score,
    streak: state.streak,
    passed: state.passed,
    attempted: state.attempted,
    last: state.last && { ...state.last }
  };
};

export const GameScene = ({ map, setup }: { map: GameMap; setup: RideSetup }) => {
  const raceId = useHud((s) => s.raceId);
  return (
    <Canvas camera={{ fov: BASE_FOV, near: 1, far: HIGH.drawDistance, position: [0, 10, -20] }}>
      <Scenery map={map} />
      <World key={raceId} map={map} setup={setup} />
    </Canvas>
  );
};
