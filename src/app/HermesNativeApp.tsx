import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

export function HermesNativeApp() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#170d02',
  },
});
