// ============================================================
// Model Card — Grid thumbnail with title overlay
// ============================================================
import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/theme';
import type { Model3D } from '../types/database';

const CARD_GAP = spacing.sm;

interface ModelCardProps {
  model: Model3D;
  onPress: () => void;
}

function formatFileSize(bytes: number | undefined): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Build thumbnail URL from Supabase public bucket
function getThumbnailUrl(thumbnailPath: string | null): string | null {
  if (!thumbnailPath) return null;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/model_thumbnails/${thumbnailPath}`;
}

function formatModelTitle(title: string): string {
  // Remove file extensions
  let cleanTitle = title.replace(/\.[^/.]+$/, '');
  // Replace underscores and dashes with spaces
  cleanTitle = cleanTitle.replace(/[_-]/g, ' ');
  // Optional: Capitalize first letters
  cleanTitle = cleanTitle.replace(/\b\w/g, (char) => char.toUpperCase());
  return cleanTitle;
}

export default function ModelCard({ model, onPress }: ModelCardProps) {
  const thumbnailUrl = getThumbnailUrl(model.thumbnail_path);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.container}
    >
      <View style={styles.imageContainer}>
        {thumbnailUrl ? (
          <Image
            source={{ uri: thumbnailUrl }}
            style={styles.image}
            contentFit="cover"
            transition={300}
            placeholder={{ blurhash: 'L6Pj0^jE0gi_.AyEICR*00oL_3t7' }}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>📦</Text>
          </View>
        )}

        {/* Bottom gradient overlay for text readability */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={styles.gradient}
        />

        {/* File Size Badge */}
        {model.metadata?.file_size && (
          <View style={styles.sizeBadge}>
            <Text style={styles.sizeBadgeText}>{formatFileSize(model.metadata.file_size)}</Text>
          </View>
        )}

        {/* Title overlay */}
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={2}>
            {formatModelTitle(model.title)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginHorizontal: CARD_GAP / 2,
    marginBottom: CARD_GAP,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
    ...shadows.md,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surfaceBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: {
    fontSize: 36,
    opacity: 0.5,
  },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  titleContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.sm,
  },
  sizeBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  sizeBadgeText: {
    fontFamily: typography.fontFamily.medium,
    fontSize: 10,
    color: '#FFF',
  },
  title: {
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.sm,
    color: colors.textPrimary,
    lineHeight: typography.fontSize.sm * typography.lineHeight.tight,
  },
});
