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

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_GAP = spacing.sm;
const CARD_PADDING = spacing.md;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / 2;

interface ModelCardProps {
  model: Model3D;
  onPress: () => void;
}

// Build thumbnail URL from Supabase public bucket
function getThumbnailUrl(thumbnailPath: string | null): string | null {
  if (!thumbnailPath) return null;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/model_thumbnails/${thumbnailPath}`;
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

        {/* Title overlay */}
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={2}>
            {model.title}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
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
  title: {
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.sm,
    color: colors.textPrimary,
    lineHeight: typography.fontSize.sm * typography.lineHeight.tight,
  },
});
