// ============================================================
// App Navigator — Universal app flow
// CompanySelect → ModelList → ModelDetail
// ============================================================
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/theme';

// Screens
import CompanySelectScreen from '../screens/CompanySelectScreen';
import ModelListScreen from '../screens/ModelListScreen';
import ModelDetailScreen from '../screens/ModelDetailScreen';
import ARViewerScreen from '../screens/ARViewerScreenWrapper';
import ObjectPlanScreen from '../screens/ObjectPlanScreenWrapper';
import ARRulerScreen from '../screens/ARRulerScreenWrapper';

export type RootStackParamList = {
  CompanySelect: undefined;
  ModelList: { companyId: string; companyName: string };
  ModelDetail: { model: any };
  ARViewer: { modelUrl: string; modelTitle: string; iosSrc?: string };
  ObjectPlan: undefined;
  ARRuler: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer
      theme={{
        dark: true,
        colors: {
          primary: colors.primary,
          background: colors.background,
          card: colors.surface,
          text: colors.textPrimary,
          border: colors.border,
          notification: colors.accent,
        },
        fonts: {
          regular: { fontFamily: 'Inter_400Regular', fontWeight: 'normal' as const },
          medium: { fontFamily: 'Inter_500Medium', fontWeight: '500' as const },
          bold: { fontFamily: 'Inter_700Bold', fontWeight: 'bold' as const },
          heavy: { fontFamily: 'Inter_700Bold', fontWeight: '900' as const },
        },
      }}
    >
      <Stack.Navigator
        initialRouteName="CompanySelect"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="CompanySelect" component={CompanySelectScreen} />
        <Stack.Screen name="ModelList" component={ModelListScreen} />
        <Stack.Screen name="ModelDetail" component={ModelDetailScreen} />
        <Stack.Screen name="ARViewer" component={ARViewerScreen} />
        <Stack.Screen name="ObjectPlan" component={ObjectPlanScreen} />
        <Stack.Screen name="ARRuler" component={ARRulerScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
