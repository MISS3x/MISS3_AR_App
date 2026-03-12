// ============================================================
// Company Select Screen — Browse available companies
// Universal app: user picks which company's catalog to view
// ============================================================
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/theme';
import { supabase } from '../lib/supabase';

interface Company {
  id: string;
  display_name: string | null;
  company_name: string | null;
  model_count: number;
  thumbnail_path: string | null;
}

function getThumbnailUrl(thumbnailPath: string | null): string | null {
  if (!thumbnailPath) return null;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/model_thumbnails/${thumbnailPath}`;
}

interface CompanySelectScreenProps {
  navigation: any;
}

export default function CompanySelectScreen({ navigation }: CompanySelectScreenProps) {
  const insets = useSafeAreaInsets();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCompanies = useCallback(async () => {
    try {
      // Fetch all users who have at least one active model
      const { data: modelsData, error: modelsError } = await supabase
        .from('models_3d')
        .select('owner_id, thumbnail_path')
        .eq('is_active', true);

      if (modelsError) throw modelsError;

      // Get unique owner IDs, count models per owner, and save the first thumbnail
      const ownerCounts = new Map<string, number>();
      const ownerThumbnails = new Map<string, string | null>();
      
      for (const m of modelsData || []) {
        ownerCounts.set(m.owner_id, (ownerCounts.get(m.owner_id) || 0) + 1);
        if (m.thumbnail_path && !ownerThumbnails.has(m.owner_id)) {
          ownerThumbnails.set(m.owner_id, m.thumbnail_path);
        }
      }

      if (ownerCounts.size === 0) {
        setCompanies([]);
        setError(null);
        return;
      }

      // Fetch user profiles for these owners
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, display_name, company_name')
        .in('id', Array.from(ownerCounts.keys()));

      if (usersError) throw usersError;

      const companiesWithCount: Company[] = (usersData || []).map((u: any) => ({
        id: u.id,
        display_name: u.display_name,
        company_name: u.company_name,
        model_count: ownerCounts.get(u.id) || 0,
        thumbnail_path: ownerThumbnails.get(u.id) || null,
      }));

      // Sort by model count descending
      companiesWithCount.sort((a, b) => b.model_count - a.model_count);

      setCompanies(companiesWithCount);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load companies');
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchCompanies();
      setLoading(false);
    };
    load();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchCompanies();
    setRefreshing(false);
  }, []);

  const handleSelectCompany = (company: Company) => {
    navigation.navigate('ModelList', {
      companyId: company.id,
      companyName: company.company_name || company.display_name || 'Catalog',
    });
  };

  const renderCompany = ({ item, index }: { item: Company; index: number }) => {
    const thumbnailUrl = getThumbnailUrl(item.thumbnail_path);

    return (
      <TouchableOpacity
        onPress={() => handleSelectCompany(item)}
        activeOpacity={0.85}
        style={styles.companyCard}
      >
        <LinearGradient
          colors={[colors.surfaceElevated, colors.surface]}
          style={styles.cardGradient}
        >
          {/* Thumbnail */}
          <View style={styles.thumbnailContainer}>
            {thumbnailUrl ? (
               <Image
                 source={{ uri: thumbnailUrl }}
                 style={styles.thumbnailImage}
                 contentFit="cover"
                 transition={200}
               />
            ) : (
               <View style={styles.thumbnailPlaceholder}>
                  <Text style={styles.thumbnailPlaceholderIcon}>📦</Text>
               </View>
            )}
          </View>

          {/* Info */}
          <View style={styles.cardInfo}>
            <Text style={styles.companyName} numberOfLines={1}>
              {item.company_name || item.display_name || 'Unknown'}
            </Text>
            <Text style={styles.modelCount}>
              {item.model_count} {item.model_count === 1 ? 'MODEL' : 'MODELS'}
            </Text>
          </View>

          {/* Arrow */}
          <Text style={styles.arrow}>→</Text>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>MISS3</Text>
        <Text style={styles.logoSub}>AR</Text>
        <Text style={{ fontFamily: typography.fontFamily.medium, fontSize: 12, color: 'rgba(255,255,255,0.4)', marginLeft: 8 }}>[v1.6]</Text>
      </View>
      <View style={styles.headerDivider} />
      <Text style={styles.headerTitle}>Select a Company</Text>
      <Text style={styles.headerSubtitle}>
        Browse product catalogs in augmented reality
      </Text>

      {/* Tools Section */}
      <View style={styles.toolsSection}>
        <Text style={styles.toolsSectionTitle}>TOOLS</Text>
        <TouchableOpacity 
          onPress={() => navigation.navigate('RoomSandbox')}
          activeOpacity={0.85}
          style={styles.toolCard}
        >
          <LinearGradient
            colors={['#1a1a3e', '#0d1b2a']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.toolCardGradient}
          >
            <View style={styles.toolCardLeft}>
              <Text style={styles.toolIcon}>📐</Text>
              <View>
                <Text style={styles.toolTitle}>Floor Generator</Text>
                <Text style={styles.toolSubtitle}>Scan rooms & place objects in AR</Text>
              </View>
            </View>
            <View style={styles.proBadge}>
              <Text style={styles.proBadgeText}>PRO</Text>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionDivider} />
      <Text style={styles.sectionTitle}>Companies</Text>

      {/* Content */}
      {loading ? (
        <ScrollView
          contentContainerStyle={styles.centeredState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.stateText}>Loading companies...</Text>
        </ScrollView>
      ) : error ? (
        <ScrollView
          contentContainerStyle={styles.centeredState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity onPress={fetchCompanies}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : companies.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.centeredState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          <Text style={styles.emptyIcon}>🏢</Text>
          <Text style={styles.stateTitle}>No companies yet</Text>
          <Text style={styles.stateText}>
            Companies will appear here once they upload their first 3D models
          </Text>
          <TouchableOpacity onPress={fetchCompanies} style={{ marginTop: 20 }}>
            <Text style={styles.retryText}>Tap to refresh</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={companies}
          renderItem={renderCompany}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.row}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  logo: {
    fontFamily: typography.fontFamily.headingBold,
    fontSize: typography.fontSize.xxxl,
    color: colors.textPrimary,
    letterSpacing: 4,
  },
  logoSub: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    color: colors.primaryLight,
    letterSpacing: 2,
  },
  headerDivider: {
    width: 48,
    height: 2,
    backgroundColor: colors.primary,
    marginLeft: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: 1,
  },
  headerTitle: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  headerSubtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  // List
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  row: {
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  companyCard: {
    flex: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadows.md,
    marginBottom: spacing.md,
  },
  cardGradient: {
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    minHeight: 140,
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  thumbnailContainer: {
    width: '100%',
    aspectRatio: 1, // 1:1 square
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailPlaceholderIcon: {
    fontSize: 24,
    opacity: 0.5,
  },
  cardInfo: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.2)', // Slight darkening for the text area
  },
  companyName: {
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.sm,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  modelCount: {
    fontFamily: typography.fontFamily.bold,
    fontSize: 9,
    color: colors.textTertiary,
    textAlign: 'center',
    letterSpacing: 1,
  },
  arrow: {
    display: 'none',
  },
  // States
  centeredState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  stateTitle: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  stateText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.fontSize.md,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  errorIcon: {
    fontSize: 36,
  },
  emptyIcon: {
    fontSize: 48,
    opacity: 0.6,
  },
  retryText: {
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.md,
    color: colors.primary,
    marginTop: spacing.md,
  },
  // Tools Section
  toolsSection: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  toolsSectionTitle: {
    fontFamily: typography.fontFamily.bold,
    fontSize: 10,
    color: colors.textTertiary,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  toolCard: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadows.md,
  },
  toolCardGradient: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(100, 100, 255, 0.2)',
  },
  toolCardLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
  },
  toolIcon: {
    fontSize: 28,
  },
  toolTitle: {
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.md,
    color: colors.textPrimary,
  },
  toolSubtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  proBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  proBadgeText: {
    fontFamily: typography.fontFamily.bold,
    fontSize: 10,
    color: '#000',
    letterSpacing: 1,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.md,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
});
