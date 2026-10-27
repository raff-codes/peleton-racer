import { useKeepAwake } from 'expo-keep-awake';
import * as NavigationBar from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useBikeConnection } from './src/bike/useBikeConnection';
import { useActiveProfile } from './src/data/profiles';
import { GameScene } from './src/game/Scene';
import { useCurrentRide, useSettings } from './src/game/settings';
import { DevToolbar } from './src/ui/DevToolbar';
import { History } from './src/ui/History';
import { Hud } from './src/ui/Hud';
import { Menu } from './src/ui/Menu';
import { ProfilePicker } from './src/ui/ProfilePicker';

export default function App() {
  useKeepAwake();
  useBikeConnection();
  // The Peloton tablet's navigation bar sits over the bottom of the HUD; hide it (swipe up to reveal).
  React.useEffect(() => {
    NavigationBar.setVisibilityAsync('hidden').catch(() => {});
  }, []);
  const ride = useCurrentRide();
  const profile = useActiveProfile();
  const view = useSettings((s) => s.view);

  const screen = () => {
    if (!profile) {
      return (
        <SafeAreaView style={styles.safe}>
          <ProfilePicker />
        </SafeAreaView>
      );
    }
    if (ride) {
      return (
        <>
          <GameScene map={ride.map} setup={ride.setup} />
          <Hud map={ride.map} setup={ride.setup} />
          <DevToolbar />
        </>
      );
    }
    return <SafeAreaView style={styles.safe}>{view === 'history' ? <History /> : <Menu />}</SafeAreaView>;
  };

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        {screen()}
        <StatusBar hidden />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  // Menus keep clear of system bars (the Peloton tablet's bottom bar can't always be hidden).
  safe: { flex: 1, backgroundColor: '#0d1117' }
});
