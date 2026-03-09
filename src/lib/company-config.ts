// ============================================================
// Company configuration — White-label setup
// Each company build uses a different COMPANY_ID in .env
// ============================================================

export interface CompanyConfig {
  companyId: string;
}

// The owner_id of the company whose models this app displays.
// Set in .env as EXPO_PUBLIC_COMPANY_ID.
// Each branded app build has its own value.
const COMPANY_ID = process.env.EXPO_PUBLIC_COMPANY_ID || '';

if (!COMPANY_ID) {
  console.warn(
    '[MISS3] EXPO_PUBLIC_COMPANY_ID is not set! The app will not load any models.'
  );
}

export const companyConfig: CompanyConfig = {
  companyId: COMPANY_ID,
};
