import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useHud } from '../game/hudStore';
import { PLAYER_ID } from '../game/race';
import { poseAt, type Track } from '../game/track';

const WIDTH = 560;
const HEIGHT = 84;
const PAD = 8;

/** One lap's elevation with every rider's position on it, so climbs are visible before they arrive. */
export const ElevationProfile = ({ track, color }: { track: Track; color: string }) => {
  const standings = useHud((s) => s.standings);

  const { fill, line, toPoint } = React.useMemo(() => {
    const ys = track.points.map((p) => p.y);
    const minY = Math.min(...ys);
    const range = Math.max(1, Math.max(...ys) - minY);
    const toXY = (distance: number, y: number) => ({
      x: PAD + (distance / track.length) * (WIDTH - PAD * 2),
      y: HEIGHT - PAD - ((y - minY) / range) * (HEIGHT - PAD * 2)
    });
    const outline = track.points.map((p) => toXY(p.distance, p.y));
    const end = toXY(track.length, (track.points[0] as Track['points'][number]).y);
    const d = [...outline, end].map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return {
      line: d,
      fill: `${d} L${end.x.toFixed(1)},${HEIGHT} L${PAD},${HEIGHT} Z`,
      toPoint: (fraction: number) => toXY(fraction * track.length, poseAt(track, fraction * track.length).y)
    };
  }, [track]);

  // Draw the player last so their dot sits on top.
  const ordered = [...standings].sort((a, b) => Number(a.id === PLAYER_ID) - Number(b.id === PLAYER_ID));

  return (
    <View pointerEvents='none' style={styles.panel}>
      <Svg height={HEIGHT} width={WIDTH}>
        <Path d={fill} fill={color} opacity={0.35} />
        <Path d={line} fill='none' stroke={color} strokeWidth={2} />
        {ordered.map((r) => {
          const p = toPoint(r.lapFraction);
          return (
            <Circle
              cx={p.x}
              cy={p.y}
              fill={r.color}
              key={r.id}
              r={r.id === PLAYER_ID ? 7 : 5}
              stroke='#fff'
              strokeWidth={r.id === PLAYER_ID ? 2 : 1}
            />
          );
        })}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(10, 14, 20, 0.72)',
    borderRadius: 12,
    overflow: 'hidden'
  }
});
