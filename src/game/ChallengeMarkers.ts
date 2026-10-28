import * as THREE from 'three';

import { CHALLENGE_STYLE, challengeDistance, challengeKind, nextInSlot, SLOTS } from './challenges';
import { PLAYER_ID, type Race } from './race';
import { poseAt } from './track';

/**
 * The challenges on the road: an arch over each power gate, a painted line and two pylons at the
 * start of each drill. One marker per slot on the lap, recoloured as the kinds rotate from lap
 * to lap, and hidden once the next one in its slot would be past the finish.
 */

const ARCH_HEIGHT_M = 4.5;
const BEAM_M = 0.6;
const POST_M = 0.4;
const PYLON_HEIGHT_M = 1.6;
const LINE_DEPTH_M = 1.2;

type Marker = { group: THREE.Group; material: THREE.MeshLambertMaterial; slot: number; shown: number };

export class ChallengeMarkers {
  readonly root = new THREE.Group();

  private readonly markers: Marker[];
  private readonly geometries: THREE.BufferGeometry[];

  constructor(race: Race, roadWidth: number) {
    const post = new THREE.BoxGeometry(POST_M, ARCH_HEIGHT_M, POST_M);
    const beam = new THREE.BoxGeometry(roadWidth + POST_M * 3, BEAM_M, POST_M);
    const pylon = new THREE.ConeGeometry(0.3, PYLON_HEIGHT_M, 8);
    const line = new THREE.PlaneGeometry(roadWidth, LINE_DEPTH_M);
    this.geometries = [post, beam, pylon, line];

    this.markers = SLOTS.map((slot, i) => {
      const material = new THREE.MeshLambertMaterial();
      const group = new THREE.Group();
      const edge = roadWidth / 2 + POST_M;
      if (slot.type === 'gate') {
        for (const side of [-1, 1]) {
          const mesh = new THREE.Mesh(post, material);
          mesh.position.set(side * edge, ARCH_HEIGHT_M / 2, 0);
          group.add(mesh);
        }
        const top = new THREE.Mesh(beam, material);
        top.position.y = ARCH_HEIGHT_M - BEAM_M / 2;
        group.add(top);
      } else {
        for (const side of [-1, 1]) {
          const mesh = new THREE.Mesh(pylon, material);
          mesh.position.set(side * edge, PYLON_HEIGHT_M / 2, 0);
          group.add(mesh);
        }
        const paint = new THREE.Mesh(line, material);
        paint.rotation.x = -Math.PI / 2;
        paint.position.y = 0.03;
        group.add(paint);
      }

      const pose = poseAt(race.track, slot.fraction * race.track.length);
      group.position.set(pose.x, pose.y, pose.z);
      group.rotation.set(-Math.atan(pose.grade), Math.atan2(pose.dirX, pose.dirZ), 0, 'YXZ');
      this.root.add(group);
      return { group, material, slot: i, shown: -1 };
    });
  }

  update(race: Race) {
    const player = race.riders.find((rider) => rider.id === PLAYER_ID);
    if (!player) return;
    const end = race.track.length * race.laps;
    for (const marker of this.markers) {
      const index = nextInSlot(race.track, marker.slot, player.distance);
      if (index === marker.shown) continue;
      marker.shown = index;
      marker.group.visible = challengeDistance(race.track, index) < end;
      marker.material.color.set(CHALLENGE_STYLE[challengeKind(index)].color);
    }
  }

  dispose() {
    for (const geometry of this.geometries) geometry.dispose();
    for (const marker of this.markers) marker.material.dispose();
  }
}
