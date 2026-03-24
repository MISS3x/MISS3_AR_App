import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function ARTapeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>📏 AR Tape is only available on iOS devices with LiDAR.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  text: { color: '#888', fontSize: 16, textAlign: 'center', padding: 32 },
});
