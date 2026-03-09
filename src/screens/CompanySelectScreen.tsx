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
  tier: string;
  model_count: number;
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
        .select('owner_id')
        .eq('is_active', true);

      if (modelsError) throw modelsError;

      // Get unique owner IDs and count models per owner
      const ownerCounts = new Map<string, number>();
      for (const m of modelsData || []) {
        ownerCounts.set(m.owner_id, (ownerCounts.get(m.owner_id) || 0) + 1);
      }

      if (ownerCounts.size === 0) {
        setCompanies([]);
        setError(null);
        return;
      }

      // Fetch user profiles for these owners
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, display_name, company_name, tier')
        .in('id', Array.from(ownerCounts.keys()));

      if (usersError) throw usersError;

      const companiesWithCount: Company[] = (usersData || []).map((u: any) => ({
        id: u.id,
        display_name: u.display_name,
        company_name: u.company_name,
        tier: u.tier,
        model_count: ownerCounts.get(u.id) || 0,
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
    // Generate a color based on company name for the avatar
    const hue = (item.company_name || item.display_name || '')
      .split('')
      .reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
    const avatarColor = `hsl(${hue}, 60%, 45%)`;
    const initials = (item.company_name || item.display_name || '?')
      .split(' ')
      .map((w) => w[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

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
          {/* Avatar */}
          <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>

          {/* Info */}
          <View style={styles.cardInfo}>
            <Text style={styles.companyName} numberOfLines={1}>
              {item.company_name || item.display_name || 'Unknown'}
            </Text>
            <Text style={styles.modelCount}>
              {item.model_count} {item.model_count === 1 ? 'model' : 'models'}
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
      </View>
      <View style={styles.headerDivider} />
      <Text style={styles.headerTitle}>Select a Company</Text>
      <Text style={styles.headerSubtitle}>
        Browse product catalogs in augmented reality
      </Text>

      {/* Content */}
      {loading ? (
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.stateText}>Loading companies...</Text>
        </View>
      ) : error ? (
        <View style={styles.centeredState}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity onPress={fetchCompanies}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : companies.length === 0 ? (
        <View style={styles.centeredState}>
          <Text style={styles.emptyIcon}>🏢</Text>
          <Text style={styles.stateTitle}>No companies yet</Text>
          <Text style={styles.stateText}>
            Companies will appear here once they upload their first 3D models
          </Text>
        </View>
      ) : (
        <FlatList
          data={companies}
          renderItem={renderCompany}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
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
    gap: spacing.sm,
  },
  companyCard: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadows.md,
  },
  cardGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: typography.fontFamily.bold,
    fontSize: typography.fontSize.lg,
    color: '#FFFFFF',
  },
  cardInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  companyName: {
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.lg,
    color: colors.textPrimary,
  },
  modelCount: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  arrow: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.fontSize.xl,
    color: colors.textTertiary,
    marginLeft: spacing.sm,
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
});
