import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius } from '../theme/theme';

export default function ObjectPlanScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>ObjectPlan Room Builder (Web Fallback)</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.text}>
          The AR Sandbox room builder is only supported on native mobile devices iOS/Android.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  backButton: {
    width: 40, height: 40, borderRadius: 20, 
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  backIcon: { fontSize: 20, color: colors.textPrimary },
  title: {
    fontSize: 16, color: colors.textPrimary,
  },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  text: {
    fontSize: 16, color: colors.textSecondary, textAlign: 'center',
  }
});
