// ============================================================
// App Navigator — Direct to model catalog (no auth required)
// White-label viewer: company is configured via env variable
// ============================================================
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/theme';

// Screens
import ModelListScreen from '../screens/ModelListScreen';
import ModelDetailScreen from '../screens/ModelDetailScreen';

export type RootStackParamList = {
  ModelList: undefined;
  ModelDetail: { model: any };
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
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="ModelList" component={ModelListScreen} />
        <Stack.Screen name="ModelDetail" component={ModelDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
