import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, TextInput, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography, borderRadius, shadows } from '../theme/theme';
import { 
  startScanning, processModel, cancelProcessing,
  addProcessingProgressListener, addProcessingStateListener 
} from '../../modules/object-capture-native';
import { supabase } from '../lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';

type FlowState = 'idle' | 'scanning' | 'processing' | 'uploading' | 'done' | 'error';

export default function ObjectCaptureScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [processingState, setProcessingState] = useState('');
  const [objectName, setObjectName] = useState('');
  
  // Results
  const [imageCount, setImageCount] = useState(0);
  const [modelPath, setModelPath] = useState<string | null>(null);
  const [modelSize, setModelSize] = useState(0);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUserId(session.user.id);
    });
    
    const progressSub = addProcessingProgressListener((event) => {
      setProgress(event.progress);
    });
    
    const stateSub = addProcessingStateListener((event) => {
      setProcessingState(event.state);
      if (event.state === 'starting') {
        setStatusText(`Processing ${event.imageCount || 0} images...`);
      } else if (event.state === 'processing') {
        setStatusText('Generating 3D model...');
      } else if (event.state === 'completed') {
        setStatusText('Model ready!');
      } else if (event.state === 'error') {
        setStatusText(`Error: ${event.message || 'Unknown'}`);
      }
    });
    
    return () => {
      progressSub.remove();
      stateSub.remove();
    };
  }, []);

  // ── Step 1: Start Scanning ──
  const handleStartScan = async () => {
    try {
      setFlowState('scanning');
      setStatusText('Opening scanner...');
      setProgress(0);
      
      const result = await startScanning();
      
      if (result.imageDirectory) {
        setImageCount(result.imageCount);
        setStatusText(`Captured ${result.imageCount} images`);
        
        // Automatically start processing
        await handleProcessModel(result.imageDirectory);
      }
    } catch (e: any) {
      if (e.code === 'CANCELLED') {
        setFlowState('idle');
        setStatusText('');
      } else {
        setFlowState('error');
        setErrorMessage(e.message || 'Scanning failed');
        setStatusText('Scan failed');
      }
    }
  };

  // ── Step 2: Process Model ──
  const handleProcessModel = async (imageDir: string) => {
    try {
      setFlowState('processing');
      setProgress(0);
      
      const result = await processModel(imageDir);
      
      if (result.modelPath) {
        setModelPath(result.modelPath);
        setModelSize(result.fileSize);
        setFlowState('done');
        setStatusText('3D model created!');
        
        // Auto-name if empty
        if (!objectName) {
          setObjectName(`Scan ${new Date().toLocaleDateString('cs-CZ')} ${new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`);
        }
      }
    } catch (e: any) {
      setFlowState('error');
      setErrorMessage(e.message || 'Processing failed');
      setStatusText('Processing failed');
    }
  };

  // ── Step 3: Upload to Supabase ──
  const handleUpload = async () => {
    if (!modelPath || !userId) return;
    
    try {
      setFlowState('uploading');
      setStatusText('Uploading to cloud...');
      setProgress(0);
      
      const fileName = `${objectName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.usdz`;
      
      // Read file for upload
      const fileBase64 = await FileSystem.readAsStringAsync(modelPath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      const byteArray = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0));
      
      const { data, error } = await supabase.storage
        .from('mesh-scans')
        .upload(`objects/${userId}/${fileName}`, byteArray, {
          contentType: 'model/vnd.usdz+zip',
          cacheControl: '3600',
          upsert: false,
        });

      if (error) throw error;
      
      setProgress(0.7);
      setStatusText('Saving metadata...');
      
      // Save to ar_objects table
      const { error: dbError } = await supabase.from('ar_objects').insert({
        id: `scan_${Date.now()}`,
        user_id: userId,
        name: objectName || 'Untitled Scan',
        storage_path: data.path,
        file_size: modelSize,
        format: 'usdz',
        status: 'completed',
        metadata: {
          imageCount,
          capturedAt: new Date().toISOString(),
          device: 'ios',
        },
      });

      if (dbError) {
        console.warn('[ObjectCapture] DB insert error (non-fatal):', dbError.message);
      }
      
      setUploadedPath(data.path);
      setProgress(1);
      setFlowState('done');
      setStatusText('Upload complete! ✅');
      
    } catch (e: any) {
      setFlowState('error');
      setErrorMessage(e.message || 'Upload failed');
      setStatusText('Upload failed');
    }
  };

  // ── Share ──
  const handleShare = async () => {
    if (!uploadedPath) return;
    
    const { data } = supabase.storage
      .from('mesh-scans')
      .getPublicUrl(uploadedPath);
    
    if (data?.publicUrl) {
      await Share.share({
        title: objectName,
        message: `Check out this 3D scan: ${data.publicUrl}`,
        url: data.publicUrl,
      });
    }
  };

  // ── Reset ──
  const handleReset = () => {
    setFlowState('idle');
    setProgress(0);
    setStatusText('');
    setProcessingState('');
    setObjectName('');
    setModelPath(null);
    setModelSize(0);
    setUploadedPath(null);
    setErrorMessage('');
    setImageCount(0);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Object Scanner</Text>
        <View style={{ width: 60 }} />
      </View>
      
      <View style={styles.content}>
        
        {/* ── IDLE STATE ── */}
        {flowState === 'idle' && (
          <View style={styles.idleContainer}>
            <View style={styles.heroBox}>
              <Text style={styles.heroEmoji}>📱</Text>
              <Text style={styles.heroTitle}>3D Object Scanner</Text>
              <Text style={styles.heroText}>
                Point your camera at an object, walk around it, and create a photorealistic 3D model.
              </Text>
            </View>
            
            <View style={styles.stepsContainer}>
              <View style={styles.stepRow}>
                <Text style={styles.stepNumber}>1</Text>
                <Text style={styles.stepText}>Position object — camera detects & shows bounding box</Text>
              </View>
              <View style={styles.stepRow}>
                <Text style={styles.stepNumber}>2</Text>
                <Text style={styles.stepText}>Walk around slowly — follow the guide to capture all angles</Text>
              </View>
              <View style={styles.stepRow}>
                <Text style={styles.stepNumber}>3</Text>
                <Text style={styles.stepText}>Tap Finish — model is processed into USDZ and uploaded</Text>
              </View>
            </View>

            {/* Name input before scanning */}
            <TextInput
              style={styles.nameInput}
              placeholder="Object name (optional)"
              placeholderTextColor={colors.textTertiary}
              value={objectName}
              onChangeText={setObjectName}
              returnKeyType="done"
            />
            
            <TouchableOpacity style={styles.scanButton} onPress={handleStartScan}>
              <Text style={styles.scanButtonIcon}>◉</Text>
              <Text style={styles.scanButtonText}>START SCANNING</Text>
            </TouchableOpacity>
          </View>
        )}
        
        {/* ── SCANNING STATE ── */}
        {flowState === 'scanning' && (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.processingTitle}>Scanning...</Text>
            <Text style={styles.processingSubtext}>The native scanner is open. Walk around your object slowly.</Text>
          </View>
        )}
        
        {/* ── PROCESSING STATE ── */}
        {flowState === 'processing' && (
          <View style={styles.processingContainer}>
            <View style={styles.progressCircle}>
              <Text style={styles.progressPercent}>{Math.round(progress * 100)}%</Text>
            </View>
            <Text style={styles.processingTitle}>{statusText || 'Processing...'}</Text>
            <Text style={styles.processingSubtext}>
              {imageCount > 0 ? `${imageCount} images captured` : 'Generating 3D model from photos'}
            </Text>
            
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${Math.max(progress * 100, 2)}%` }]} />
            </View>
            
            <TouchableOpacity 
              style={styles.cancelButton}
              onPress={() => {
                cancelProcessing();
                handleReset();
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
        
        {/* ── UPLOADING STATE ── */}
        {flowState === 'uploading' && (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color={colors.success} />
            <Text style={styles.processingTitle}>{statusText}</Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${Math.max(progress * 100, 5)}%`, backgroundColor: colors.success }]} />
            </View>
          </View>
        )}
        
        {/* ── DONE STATE ── */}
        {flowState === 'done' && (
          <View style={styles.doneContainer}>
            <Text style={styles.doneEmoji}>{uploadedPath ? '☁️' : '🎉'}</Text>
            <Text style={styles.doneTitle}>
              {uploadedPath ? 'Uploaded Successfully!' : 'Model Ready!'}
            </Text>
            
            {/* Model info card */}
            <View style={styles.modelInfoCard}>
              <TextInput
                style={styles.nameInputDone}
                value={objectName}
                onChangeText={setObjectName}
                placeholder="Object name"
                placeholderTextColor={colors.textTertiary}
              />
              <View style={styles.modelInfoRow}>
                <Text style={styles.modelInfoLabel}>Format</Text>
                <Text style={styles.modelInfoValue}>USDZ</Text>
              </View>
              <View style={styles.modelInfoRow}>
                <Text style={styles.modelInfoLabel}>Size</Text>
                <Text style={styles.modelInfoValue}>{formatBytes(modelSize)}</Text>
              </View>
              <View style={styles.modelInfoRow}>
                <Text style={styles.modelInfoLabel}>Images</Text>
                <Text style={styles.modelInfoValue}>{imageCount}</Text>
              </View>
              {uploadedPath && (
                <View style={styles.modelInfoRow}>
                  <Text style={styles.modelInfoLabel}>Cloud</Text>
                  <Text style={[styles.modelInfoValue, { color: colors.success }]}>✅ Synced</Text>
                </View>
              )}
            </View>
            
            {/* Action buttons */}
            <View style={styles.actionButtons}>
              {!uploadedPath && modelPath && (
                <TouchableOpacity style={styles.uploadButton} onPress={handleUpload}>
                  <Text style={styles.uploadButtonText}>☁️ UPLOAD TO CLOUD</Text>
                </TouchableOpacity>
              )}
              
              {uploadedPath && (
                <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
                  <Text style={styles.shareButtonText}>🔗 SHARE</Text>
                </TouchableOpacity>
              )}
              
              <TouchableOpacity style={styles.newScanButton} onPress={handleReset}>
                <Text style={styles.newScanButtonText}>NEW SCAN</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        
        {/* ── ERROR STATE ── */}
        {flowState === 'error' && (
          <View style={styles.processingContainer}>
            <Text style={styles.errorEmoji}>⚠️</Text>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            
            <TouchableOpacity style={styles.retryButton} onPress={handleReset}>
              <Text style={styles.retryButtonText}>TRY AGAIN</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: typography.fontFamily.headingBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontFamily: typography.fontFamily.semiBold,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  
  // ── Idle ──
  idleContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  heroBox: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroEmoji: {
    fontSize: 56,
    marginBottom: spacing.md,
  },
  heroTitle: {
    fontFamily: typography.fontFamily.headingBold,
    fontSize: typography.fontSize.xl,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  heroText: {
    color: colors.textSecondary,
    fontFamily: typography.fontFamily.regular,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  stepsContainer: {
    width: '100%',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    color: '#FFF',
    fontFamily: typography.fontFamily.bold,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 28,
    marginRight: spacing.md,
    overflow: 'hidden',
  },
  stepText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: typography.fontFamily.medium,
    fontSize: 13,
  },
  nameInput: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.textPrimary,
    fontFamily: typography.fontFamily.medium,
    fontSize: 15,
    marginBottom: spacing.lg,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: borderRadius.full,
    ...shadows.glow,
  },
  scanButtonIcon: {
    color: '#FFF',
    fontSize: 20,
    marginRight: spacing.sm,
  },
  scanButtonText: {
    color: '#FFF',
    fontFamily: typography.fontFamily.headingBold,
    fontSize: 16,
    letterSpacing: 1,
  },
  
  // ── Processing ──
  processingContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  processingTitle: {
    color: colors.textPrimary,
    fontFamily: typography.fontFamily.headingBold,
    fontSize: typography.fontSize.xl,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  processingSubtext: {
    color: colors.textSecondary,
    fontFamily: typography.fontFamily.regular,
    fontSize: 14,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  progressCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  progressPercent: {
    color: colors.primary,
    fontFamily: typography.fontFamily.headingBold,
    fontSize: 24,
  },
  progressBarBg: {
    width: '100%',
    height: 8,
    backgroundColor: colors.surface,
    borderRadius: 4,
    marginTop: spacing.xl,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  cancelButton: {
    marginTop: spacing.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  cancelButtonText: {
    color: colors.textTertiary,
    fontFamily: typography.fontFamily.medium,
    fontSize: 14,
  },
  
  // ── Done ──
  doneContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  doneEmoji: {
    fontSize: 56,
    marginBottom: spacing.md,
  },
  doneTitle: {
    fontFamily: typography.fontFamily.headingBold,
    fontSize: typography.fontSize.xxl,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  modelInfoCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  nameInputDone: {
    color: colors.textPrimary,
    fontFamily: typography.fontFamily.headingBold,
    fontSize: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: spacing.md,
  },
  modelInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  modelInfoLabel: {
    color: colors.textTertiary,
    fontFamily: typography.fontFamily.medium,
    fontSize: 14,
  },
  modelInfoValue: {
    color: colors.textPrimary,
    fontFamily: typography.fontFamily.semiBold,
    fontSize: 14,
  },
  actionButtons: {
    width: '100%',
    gap: spacing.sm,
  },
  uploadButton: {
    width: '100%',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    ...shadows.glow,
  },
  uploadButtonText: {
    color: '#FFF',
    fontFamily: typography.fontFamily.headingBold,
    fontSize: 16,
    letterSpacing: 1,
  },
  shareButton: {
    width: '100%',
    backgroundColor: colors.surfaceElevated,
    paddingVertical: 16,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  shareButtonText: {
    color: colors.primary,
    fontFamily: typography.fontFamily.headingBold,
    fontSize: 16,
    letterSpacing: 1,
  },
  newScanButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: borderRadius.full,
    alignItems: 'center',
  },
  newScanButtonText: {
    color: colors.textTertiary,
    fontFamily: typography.fontFamily.semiBold,
    fontSize: 14,
    letterSpacing: 1,
  },
  
  // ── Error ──
  errorEmoji: {
    fontSize: 56,
    marginBottom: spacing.md,
  },
  errorTitle: {
    fontFamily: typography.fontFamily.headingBold,
    fontSize: typography.fontSize.xl,
    color: colors.error,
    marginBottom: spacing.sm,
  },
  errorMessage: {
    color: colors.textSecondary,
    fontFamily: typography.fontFamily.regular,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  retryButton: {
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryButtonText: {
    color: colors.textPrimary,
    fontFamily: typography.fontFamily.semiBold,
    fontSize: 15,
    letterSpacing: 1,
  },
});
