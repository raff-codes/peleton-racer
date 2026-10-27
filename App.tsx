import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { useBikeConnection } from './src/bike/useBikeConnection';
import { useActiveProfile } from './src/data/profiles';
import { GameScene } from './src/game/Scene';
import { useCurrentRide, useSettings } from './src/game/settings';
import { History } from './src/ui/History';
import { Hud } from './src/ui/Hud';
import { Menu } from './src/ui/Menu';
import { ProfilePicker } from './src/ui/ProfilePicker';

export default function App() {
  useKeepAwake();
  useBikeConnection();
  const ride = useCurrentRide();
  const profile = useActiveProfile();
  const view = useSettings((s) => s.view);

  const screen = () => {
    if (!profile) return <ProfilePicker />;
    if (ride) {
      return (
        <>
          <GameScene map={ride.map} setup={ride.setup} />
          <Hud map={ride.map} setup={ride.setup} />
        </>
      );
    }
    return view === 'history' ? <History /> : <Menu />;
  };

  return (
    <View style={styles.container}>
      {screen()}
      <StatusBar hidden />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' }
});
