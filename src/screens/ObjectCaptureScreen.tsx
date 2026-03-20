import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function ObjectCaptureScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Object Capture is only supported on iOS devices.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  text: { color: '#fff', fontSize: 16 }
});
