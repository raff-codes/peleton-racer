import { StyleSheet, Text, View } from 'react-native';

/** A rider's badge: their jersey colour with the first letter of their name. */
export const Avatar = ({ name, color, size }: { name: string; color: string; size: number }) => (
  <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
    <Text style={[styles.letter, { fontSize: size * 0.45 }]}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
  </View>
);

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: '#fff', fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 4 }
});
