// ============================================================
// AR Ruler Web Fallback
// ============================================================
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function ARRulerScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>AR Ruler is only available on native iOS/Android devices.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  text: { color: '#FFF' },
});
