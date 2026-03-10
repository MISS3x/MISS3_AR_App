// ============================================================
// Model List Screen — Catalog for a selected company
// Receives companyId and companyName from navigation params
// ============================================================
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography, borderRadius } from '../theme/theme';
import { supabase } from '../lib/supabase';
import type { Model3D, Category } from '../types/database';
import CategoryBar from '../components/CategoryBar';
import ModelCard from '../components/ModelCard';

interface ModelListScreenProps {
  route: { params: { companyId: string; companyName: string } };
  navigation: any;
}

export default function ModelListScreen({ route, navigation }: ModelListScreenProps) {
  const { companyId, companyName } = route.params;
  const insets = useSafeAreaInsets();
  const [models, setModels] = useState<Model3D[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch categories for the company
  const fetchCategories = useCallback(async () => {
    const { data } = await supabase
      .from('model_categories')
      .select('*')
      .eq('owner_id', companyId)
      .order('name');

    if (data) setCategories(data as Category[]);
  }, [companyId]);

  // Fetch models (optionally filtered by category)
  const fetchModels = useCallback(async (categoryId: string | null = null) => {
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
      await Promise.all([fetchCategories(), fetchModels()]);
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.companyName} numberOfLines={1}>
            {companyName} <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 'normal' }}>[v1.4]</Text>
          </Text>
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
            Products will appear here once added via the web portal
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
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  backIcon: {
    fontSize: 18,
    color: colors.textPrimary,
  },
  headerText: {
    flex: 1,
  },
  companyName: {
    fontFamily: typography.fontFamily.headingBold,
    fontSize: typography.fontSize.xl,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: 1,
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
