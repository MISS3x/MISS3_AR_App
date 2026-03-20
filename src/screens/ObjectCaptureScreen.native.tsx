import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography, borderRadius } from '../theme/theme';
import { startScanning, processModel, addProcessingProgressListener } from '../../modules/object-capture-native';
import { supabase } from '../lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';

export default function ObjectCaptureScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  
  const [userId, setUserId] = useState<string | null>(route.params?.userId || null);

  useEffect(() => {
    if (!userId) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) setUserId(session.user.id);
      });
    }
    
    const sub = addProcessingProgressListener((event) => {
      setProgress(event.progress);
    });
    return () => sub.remove();
  }, [userId]);

  const handleStartScan = async () => {
    try {
      setIsScanning(true);
      setStatusText('Opening Object Capture UI...');
      const result = await startScanning();
      
      if (result.imageDirectory) {
        setIsScanning(false);
        setIsProcessing(true);
        setStatusText('Processing 3D Model...');
        setProgress(0);
        
        const processResult = await processModel(result.imageDirectory);
        
        if (processResult.objPath) {
          setStatusText('Uploading to Supabase...');
          await uploadToSupabase(processResult.objPath);
        }
      }
    } catch (e: any) {
      if (e.code !== 'CANCELLED') {
        Alert.alert('Scan Failed', e.message || 'An error occurred during scanning.');
      }
      setIsScanning(false);
      setIsProcessing(false);
      setStatusText('');
    }
  };

  const uploadToSupabase = async (fileUri: string) => {
    try {
      const fileName = `object_scan_${Date.now()}.usdz`;
      
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) throw new Error("Generated USDZ file not found.");
      
      const formData = new FormData();
      formData.append('file', {
        uri: fileUri,
        name: fileName,
        type: 'model/usd',
      } as any);

      const { data, error } = await supabase.storage
        .from('mesh-scans')
        .upload(`objects/${fileName}`, formData, {
          cacheControl: '3600',
          upsert: false,
        });

      if (error) throw error;
      
      // Save metadata to DB
      if (userId) {
        await supabase.from('ar_objects').insert({
          id: fileName.replace('.usdz', ''),
          user_id: userId,
          storage_path: data.path,
          file_size: fileInfo.size || 0,
          format: 'usdz',
          created_at: new Date().toISOString(),
          status: 'uploaded',
        });
      }

      setStatusText('Upload Complete!');
      Alert.alert('Success', '3D Model successfully processed and uploaded.');
      
      setTimeout(() => {
        setIsProcessing(false);
        setStatusText('');
        navigation.goBack();
      }, 2000);
      
    } catch (e: any) {
      Alert.alert('Upload Error', e.message);
      setIsProcessing(false);
      setStatusText('');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>𐌑 Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>AR Object Scanner</Text>
        <View style={{ width: 60 }} />
      </View>
      
      <View style={styles.content}>
        <View style={styles.heroBox}>
          <Text style={styles.heroEmoji}>🗿</Text>
          <Text style={styles.heroText}>Scan a real-world object and automatically turn it into a high-fidelity 3D model.</Text>
        </View>

        {(isScanning || isProcessing) ? (
          <View style={styles.progressContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.statusText}>{statusText}</Text>
            {isProcessing && (
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
              </View>
            )}
            {isProcessing && (
              <Text style={styles.progressValue}>{Math.round(progress * 100)}%</Text>
            )}
          </View>
        ) : (
          <TouchableOpacity style={styles.scanButton} onPress={handleStartScan}>
            <Text style={styles.scanButtonText}>START SCANNING</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    fontFamily: typography.fontFamily.headingBold,
    fontSize: 18,
    color: '#fff',
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  heroBox: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
    padding: spacing.xl,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: borderRadius.lg,
  },
  heroEmoji: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  heroText: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: typography.fontFamily.regular,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  scanButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: borderRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#000',
    fontFamily: typography.fontFamily.headingBold,
    fontSize: 16,
    letterSpacing: 1,
  },
  progressContainer: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: spacing.xl,
  },
  statusText: {
    color: '#fff',
    marginTop: spacing.md,
    fontFamily: typography.fontFamily.medium,
    fontSize: 16,
  },
  progressBarBg: {
    width: '100%',
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 6,
    marginTop: spacing.lg,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  progressValue: {
    color: 'rgba(255,255,255,0.5)',
    marginTop: 8,
    fontFamily: typography.fontFamily.regular,
    fontSize: 14,
  },
});
