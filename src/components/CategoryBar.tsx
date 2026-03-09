// ============================================================
// Category Filter Bar — Horizontal scrollable chips
// ============================================================
import React from 'react';
import {
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import { colors, spacing, borderRadius, typography } from '../theme/theme';
import type { Category } from '../types/database';

interface CategoryBarProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (categoryId: string | null) => void;
}

export default function CategoryBar({ categories, selectedId, onSelect }: CategoryBarProps) {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* "All" chip */}
        <TouchableOpacity
          onPress={() => onSelect(null)}
          style={[styles.chip, selectedId === null && styles.chipActive]}
          activeOpacity={0.7}
        >
          <Text style={[styles.chipText, selectedId === null && styles.chipTextActive]}>
            All
          </Text>
        </TouchableOpacity>

        {categories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            onPress={() => onSelect(cat.id)}
            style={[styles.chip, selectedId === cat.id && styles.chipActive]}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.chipText, selectedId === cat.id && styles.chipTextActive]}
            >
              {cat.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.textPrimary,
  },
});
