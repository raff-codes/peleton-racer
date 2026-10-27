import * as React from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSettings } from '../game/settings';

/**
 * In-ride menu: resume, restart, or end the ride. Ending asks for a second tap so a stray
 * touch mid-sprint doesn't throw a race away. The Android back button opens and closes it.
 */
export const PauseMenu = () => {
  const { paused, pause, resume, restartRide, endRide } = useSettings();
  const [confirmingEnd, setConfirmingEnd] = React.useState(false);

  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (useSettings.getState().paused) resume();
      else pause();
      return true;
    });
    return () => sub.remove();
  }, [pause, resume]);

  React.useEffect(() => {
    if (!paused) setConfirmingEnd(false);
  }, [paused]);

  if (!paused) return null;

  return (
    <View style={styles.backdrop}>
      <View style={styles.panel}>
        <Text style={styles.title}>{confirmingEnd ? 'End this ride?' : 'Paused'}</Text>
        {confirmingEnd ? (
          <>
            <Text style={styles.hint}>Your progress in this ride will be lost.</Text>
            <Pressable onPress={endRide} style={[styles.button, styles.danger]}>
              <Text style={styles.buttonText}>Yes, end ride</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmingEnd(false)} style={[styles.button, styles.secondary]}>
              <Text style={styles.buttonText}>Keep riding</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={resume} style={styles.button}>
              <Text style={styles.buttonText}>Resume</Text>
            </Pressable>
            <Pressable onPress={restartRide} style={[styles.button, styles.secondary]}>
              <Text style={styles.buttonText}>Restart</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmingEnd(true)} style={[styles.button, styles.secondary]}>
              <Text style={styles.buttonText}>End ride</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(5, 8, 12, 0.6)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  panel: { width: 380, backgroundColor: 'rgba(16, 21, 28, 0.96)', borderRadius: 18, padding: 26, gap: 12 },
  title: { color: '#fff', fontSize: 32, fontWeight: '900', textAlign: 'center', marginBottom: 6 },
  hint: { color: '#9aa4b2', fontSize: 15, textAlign: 'center', marginBottom: 4 },
  button: { backgroundColor: '#ff5a1f', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  secondary: { backgroundColor: '#2a3442' },
  danger: { backgroundColor: '#d7262e' },
  buttonText: { color: '#fff', fontSize: 20, fontWeight: '800' }
});
