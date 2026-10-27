import * as THREE from 'three';

import { poseAt, type TrackPoint } from '../track';
import { ROAD_WIDTH, type WorldContext, type WorldLayer } from './types';

/**
 * The road surface: a flat ribbon at the track height, one cross-section per track sample.
 * Roadside markings and verges are built to match this exact triangulation.
 */
export const createRoadLayer = ({ track, theme }: WorldContext): WorldLayer => {
  const n = track.points.length;
  const positions: number[] = [];
  const half = ROAD_WIDTH / 2;
  for (let i = 0; i < n; i++) {
    const pose = poseAt(track, (track.points[i] as TrackPoint).distance);
    // Right-hand normal of the heading in the xz plane.
    const nx = -pose.dirZ;
    const nz = pose.dirX;
    positions.push(pose.x - nx * half, pose.y, pose.z - nz * half, pose.x + nx * half, pose.y, pose.z + nz * half);
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const c = ((i + 1) % n) * 2;
    index.push(a, a + 1, c, a + 1, c + 1, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const material = new THREE.MeshLambertMaterial({ color: theme.roadside.road });

  return {
    object: new THREE.Mesh(geometry, material),
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };
};
