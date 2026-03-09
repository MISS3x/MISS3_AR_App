// ============================================================
// Model Detail Screen — Full model info with metadata
// ============================================================
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/theme';
import type { Model3D } from '../types/database';

interface ModelDetailScreenProps {
  route: { params: { model: Model3D } };
  navigation: any;
}

function getThumbnailUrl(thumbnailPath: string | null): string | null {
  if (!thumbnailPath) return null;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/model_thumbnails/${thumbnailPath}`;
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function ModelDetailScreen({ route, navigation }: ModelDetailScreenProps) {
  const { model } = route.params;
  const insets = useSafeAreaInsets();
  const thumbnailUrl = getThumbnailUrl(model.thumbnail_path);

  const handleOpenUrl = useCallback(async () => {
    if (model.info_url) {
      await Linking.openURL(model.info_url);
    }
  }, [model.info_url]);

  // AR placement info
  const placements = [];
  if (model.ar_placement?.floor) placements.push('Floor');
  if (model.ar_placement?.wall) placements.push('Wall');
  if (model.ar_placement?.qr_target) placements.push('QR Target');

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Hero image */}
        <View style={styles.heroContainer}>
          {thumbnailUrl ? (
            <Image
              source={{ uri: thumbnailUrl }}
              style={styles.heroImage}
              contentFit="cover"
              transition={400}
            />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Text style={styles.heroPlaceholderIcon}>📦</Text>
            </View>
          )}
          <LinearGradient
            colors={['transparent', colors.background]}
            style={styles.heroGradient}
          />

          {/* Back button */}
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={[styles.backButton, { top: insets.top + spacing.sm }]}
          >
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <Text style={styles.title}>{model.title}</Text>

          {model.description && (
            <Text style={styles.description}>{model.description}</Text>
          )}

          {/* Metadata cards */}
          <View style={styles.metaGrid}>
            <View style={styles.metaCard}>
              <Text style={styles.metaLabel}>File Size</Text>
              <Text style={styles.metaValue}>
                {formatFileSize(model.metadata?.file_size)}
              </Text>
            </View>
            <View style={styles.metaCard}>
              <Text style={styles.metaLabel}>Uploaded</Text>
              <Text style={styles.metaValue}>{formatDate(model.created_at)}</Text>
            </View>
          </View>

          {model.metadata?.original_name && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Original File</Text>
              <Text style={styles.infoValue} numberOfLines={1}>
                {model.metadata.original_name}
              </Text>
            </View>
          )}

          {/* AR Placement tags */}
          {placements.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>AR Placement</Text>
              <View style={styles.tagRow}>
                {placements.map((p) => (
                  <View key={p} style={styles.tag}>
                    <Text style={styles.tagText}>{p}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Annotations count */}
          {model.annotations && model.annotations.length > 0 && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Annotations</Text>
              <Text style={styles.infoValue}>
                {model.annotations.length} annotation{model.annotations.length !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom action buttons */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom || spacing.md }]}>
        {model.info_url && (
          <TouchableOpacity onPress={handleOpenUrl} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>View in E-shop</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity activeOpacity={0.8} style={styles.arButtonWrapper}>
          <LinearGradient
            colors={colors.gradientPrimary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.arButton}
          >
            <Text style={styles.arButtonText}>View in AR</Text>
            <Text style={styles.arButtonSub}>Coming soon</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  // Hero
  heroContainer: {
    width: '100%',
    height: 320,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surfaceBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholderIcon: {
    fontSize: 64,
    opacity: 0.4,
  },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  backButton: {
    position: 'absolute',
    left: spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 20,
    color: colors.textPrimary,
  },
  // Content
  content: {
    paddingHorizontal: spacing.lg,
    marginTop: -spacing.lg,
  },
  title: {
    fontFamily: typography.fontFamily.headingBold,
    fontSize: typography.fontSize.xxl,
    color: colors.textPrimary,
    lineHeight: typography.fontSize.xxl * typography.lineHeight.tight,
  },
  description: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
    marginTop: spacing.md,
    lineHeight: typography.fontSize.md * typography.lineHeight.relaxed,
  },
  // Metadata grid
  metaGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  metaCard: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaLabel: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.fontSize.xs,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  metaValue: {
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.lg,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  // Info rows
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
  },
  infoValue: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.fontSize.sm,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'right',
    marginLeft: spacing.md,
  },
  // Section
  section: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  tagRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceBright,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  tagText: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
  },
  // Bottom bar
  bottomBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.md,
    color: colors.textPrimary,
  },
  arButtonWrapper: {
    flex: 1,
  },
  arButton: {
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
  },
  arButtonText: {
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.md,
    color: colors.textPrimary,
  },
  arButtonSub: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.fontSize.xs,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
});
