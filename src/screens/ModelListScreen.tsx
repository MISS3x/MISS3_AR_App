// ============================================================
// Model List Screen — White-label catalog for a specific company
// Loads models by COMPANY_ID from env (no auth required)
// ============================================================
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography, borderRadius } from '../theme/theme';
import { supabase } from '../lib/supabase';
import { companyConfig } from '../lib/company-config';
import type { Model3D, Category, UserProfile } from '../types/database';
import CategoryBar from '../components/CategoryBar';
import ModelCard from '../components/ModelCard';

interface ModelListScreenProps {
  navigation: any;
}

export default function ModelListScreen({ navigation }: ModelListScreenProps) {
  const insets = useSafeAreaInsets();
  const [models, setModels] = useState<Model3D[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyProfile, setCompanyProfile] = useState<UserProfile | null>(null);

  const companyId = companyConfig.companyId;

  // Fetch company profile (for branding: name, logo, etc.)
  const fetchCompanyProfile = useCallback(async () => {
    if (!companyId) return;

    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', companyId)
      .single();

    if (data) setCompanyProfile(data as UserProfile);
  }, [companyId]);

  // Fetch categories for the company
  const fetchCategories = useCallback(async () => {
    if (!companyId) return;

    const { data } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', companyId)
      .order('name');

    if (data) setCategories(data as Category[]);
  }, [companyId]);

  // Fetch models (optionally filtered by category)
  const fetchModels = useCallback(async (categoryId: string | null = null) => {
    if (!companyId) {
      setError('Company not configured. Contact support.');
      return;
    }

    let query = supabase
      .from('models_3d')
      .select('*')
      .eq('owner_id', companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    const { data, error: fetchError } = await query;

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setModels((data ?? []) as Model3D[]);
      setError(null);
    }
  }, [companyId]);

  // Initial load
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([fetchCompanyProfile(), fetchCategories(), fetchModels()]);
      setLoading(false);
    };
    loadAll();
  }, []);

  // Refetch when category changes
  useEffect(() => {
    if (!loading) {
      fetchModels(selectedCategory);
    }
  }, [selectedCategory]);

  // Pull-to-refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchCategories(), fetchModels(selectedCategory)]);
    setRefreshing(false);
  }, [selectedCategory]);

  // Render model card
  const renderModel = ({ item }: { item: Model3D }) => (
    <ModelCard
      model={item}
      onPress={() => navigation.navigate('ModelDetail', { model: item })}
    />
  );

  const companyName = companyProfile?.company_name || companyProfile?.display_name || 'AR Catalog';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.companyName}>{companyName}</Text>
          <Text style={styles.subtitle}>Product Catalog</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {models.length} {models.length === 1 ? 'model' : 'models'}
          </Text>
        </View>
      </View>

      {/* Category filter */}
      {categories.length > 0 && (
        <CategoryBar
          categories={categories}
          selectedId={selectedCategory}
          onSelect={setSelectedCategory}
        />
      )}

      {/* Content */}
      {loading ? (
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.stateText}>Loading catalog...</Text>
        </View>
      ) : error ? (
        <View style={styles.centeredState}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.stateText}>{error}</Text>
        </View>
      ) : models.length === 0 ? (
        <View style={styles.centeredState}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.stateTitle}>No products yet</Text>
          <Text style={styles.stateText}>
            Products will appear here once they are added to the catalog
          </Text>
        </View>
      ) : (
        <FlatList
          data={models}
          renderItem={renderModel}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  companyName: {
    fontFamily: typography.fontFamily.headingBold,
    fontSize: typography.fontSize.xxl,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
  },
  grid: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  row: {
    justifyContent: 'space-between',
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
});
