// AR Sketch — Coming soon placeholder (web)
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function ARSketchScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>✏️ AR Sketch is only available on iOS devices with LiDAR.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a1a', padding: 24 },
  text: { color: '#aaa', fontSize: 16, textAlign: 'center' },
});
