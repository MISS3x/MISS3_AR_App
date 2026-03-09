// ============================================================
// MISS3 Design System — Premium Dark Theme
// ============================================================

export const colors = {
  // Core palette
  background: '#0A0A0F',
  surface: '#12121A',
  surfaceElevated: '#1A1A26',
  surfaceBright: '#222233',

  // Primary accent — vibrant purple-blue gradient endpoints
  primary: '#6C5CE7',
  primaryLight: '#A29BFE',
  primaryDark: '#4834D4',

  // Secondary accent — warm coral
  accent: '#FF6B6B',
  accentLight: '#FF8E8E',

  // Text
  textPrimary: '#F0F0F5',
  textSecondary: '#9090A8',
  textTertiary: '#606078',
  textInverse: '#0A0A0F',

  // Semantic
  success: '#00D2B4',
  error: '#FF4757',
  warning: '#FECA57',
  info: '#54A0FF',

  // Borders & dividers
  border: '#2A2A3C',
  borderLight: '#3A3A50',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.6)',

  // Gradients (as arrays for LinearGradient)
  gradientPrimary: ['#6C5CE7', '#A29BFE'] as const,
  gradientAccent: ['#FF6B6B', '#FF8E8E'] as const,
  gradientDark: ['#0A0A0F', '#12121A'] as const,
  gradientCard: ['#1A1A26', '#12121A'] as const,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const typography = {
  // Font families (loaded via expo-font)
  fontFamily: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semiBold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
    heading: 'Outfit_600SemiBold',
    headingBold: 'Outfit_700Bold',
  },
  // Font sizes
  fontSize: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 28,
    xxxl: 36,
    hero: 48,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.7,
  },
} as const;

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  glow: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;
