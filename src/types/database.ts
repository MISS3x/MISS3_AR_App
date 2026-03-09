// ============================================================
// MISS3 iOS App — Database Types (matching Supabase schema)
// ============================================================

export interface ArPlacement {
  floor: boolean;
  wall: boolean;
  qr_target: boolean;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface ModelTransform {
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
}

export interface Annotation {
  id: string;
  text: string;
  color: string;
  position: Vector3;
  fontSize?: number;
}

export interface ModelMetadata {
  mind_file_path?: string;
  file_size?: number;
  original_name?: string;
}

export interface Model3D {
  id: string;
  title: string;
  description: string | null;
  storage_path: string;
  thumbnail_path: string | null;
  uploaded_by: string;
  owner_id: string;
  ar_placement: ArPlacement | null;
  model_transform: ModelTransform | null;
  annotations: Annotation[] | null;
  metadata: ModelMetadata | null;
  is_active: boolean;
  category_id: string | null;
  info_url: string | null;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  owner_id: string;
  created_at?: string;
}

export type AccountType = 'individual' | 'company';
export type Tier = 'free' | 'pro' | 'premium';

export interface UserProfile {
  id: string;
  display_name: string | null;
  company_name: string | null;
  account_type: AccountType;
  contact_email: string | null;
  tier: Tier;
}
