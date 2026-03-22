// ============================================================
// AR Collaboration Web Fallback
// ============================================================
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function ARCollaborationScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>AR Collaboration is only available on native iOS devices.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  text: { color: '#FFF' },
});
