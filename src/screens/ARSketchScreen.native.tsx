// AR Sketch — SketchUp-style 3D drawing in AR (Coming Soon placeholder)
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ARSketchScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        <Text style={styles.icon}>✏️</Text>
        <Text style={styles.title}>AR Sketch</Text>
        <Text style={styles.subtitle}>SketchUp-style 3D Drawing in AR</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>COMING SOON</Text>
        </View>
        <Text style={styles.desc}>
          Kreslete polygony přímo v AR prostoru, extrudujte je do 3D objektů, řezejte a upravujte — vše v reálném čase s LiDAR přesností.
        </Text>
        <View style={styles.featureList}>
          <Text style={styles.feature}>📐 Linka, obdélník, polygon, volné kreslení</Text>
          <Text style={styles.feature}>⬆️ Push/Pull extrude</Text>
          <Text style={styles.feature}>✂️ Cut — řez čárou do polygonu</Text>
          <Text style={styles.feature}>📏 Snap na hrany a rohy</Text>
          <Text style={styles.feature}>🎨 Materiály a textury</Text>
          <Text style={styles.feature}>💾 Export USDZ / GLB</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => navigation.goBack()}
        activeOpacity={0.8}
      >
        <Text style={styles.backText}>← Zpět</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  icon: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  subtitle: { fontSize: 14, color: '#888', marginTop: 4 },
  badge: {
    marginTop: 16, backgroundColor: '#9C27B0', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  desc: { color: '#666', fontSize: 13, textAlign: 'center', marginTop: 20, lineHeight: 20 },
  featureList: { marginTop: 24, alignItems: 'flex-start' },
  feature: { color: '#888', fontSize: 13, marginBottom: 8 },
  backBtn: {
    position: 'absolute', bottom: 40, left: 24,
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  backText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
