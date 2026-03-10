import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { 
  ViroARSceneNavigator, ViroARScene, Viro3DObject, ViroAmbientLight, 
  ViroNode, ViroDirectionalLight, ViroSpotLight, ViroQuad, ViroMaterials 
} from '@reactvision/react-viro';
import * as FileSystem from 'expo-file-system/legacy';
import { colors, spacing, borderRadius, typography } from '../theme/theme';

interface ARViewerScreenProps {
  route: {
    params: {
      modelUrl: string;
      modelTitle: string;
      modelTransform?: {
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
        scale: { x: number; y: number; z: number };
      } | null;
    };
  };
  navigation: any;
}

// Removed ViroMaterials definition to debug hard crash

export default function ARViewerScreen({ route, navigation }: ARViewerScreenProps) {
  const { modelUrl, modelTitle, modelTransform } = route.params;
  const insets = useSafeAreaInsets();
  
  const [isLoading, setIsLoading] = useState(true);
  const [localModelPath, setLocalModelPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Initialize scale and rotation from database, or default to 1:1:1 and 0:0:0
  const initialScale: [number, number, number] = modelTransform?.scale 
    ? [modelTransform.scale.x, modelTransform.scale.y, modelTransform.scale.z] 
    : [1, 1, 1];
    
  const initialRotation: [number, number, number] = modelTransform?.rotation
    ? [modelTransform.rotation.x, modelTransform.rotation.y, modelTransform.rotation.z]
    : [0, 0, 0];

  // We only keep React state for positioning if we need it for UI, 
  // but for gestures (pinch, rotate), React state is too slow and drops frames in Viro.
  // We MUST use direct native prop manipulation via refs.
  const nodeRef = useRef<any>(null);
  
  // Mutable references for the gesture state (doesn't trigger re-render)
  const currentScale = useRef<[number, number, number]>(initialScale);
  const currentRotation = useRef<[number, number, number]>(initialRotation);

  // Variables specifically to hold the exact start state of the gesture
  const gestureBaseScale = useRef<[number, number, number]>(initialScale);
  const gestureBaseRotation = useRef<[number, number, number]>(initialRotation);
  
  const [isClayMode, setIsClayMode] = useState(false);

  // 1) Download the model from Supabase to local filesystem first
  useEffect(() => {
    let isMounted = true;
    const downloadModel = async () => {
      try {
        setIsLoading(true);
        setDownloadError(null);

        // Generate a valid local filename from the provided URL
        const fileName = modelUrl.split('?')[0].split('/').pop() || 'model.glb';
        const localUri = `${FileSystem.documentDirectory}${fileName}`;

        // Check if we already have it cached
        const FileInfo = await FileSystem.getInfoAsync(localUri);
        if (FileInfo.exists) {
           console.log("Model loaded from cache:", localUri);
           if (isMounted) {
             setLocalModelPath(`file://${localUri}`);
             setIsLoading(false);
           }
           return;
        }

        console.log("Downloading model from Supabase to:", localUri);
        const { uri } = await FileSystem.downloadAsync(modelUrl, localUri);
        
        console.log("Download finished:", uri);
        if (isMounted) {
          // ViroReact requires the 'file://' prefix for local absolute paths
          setLocalModelPath(`file://${uri}`);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("Failed to download model for AR:", err);
        if (isMounted) {
          setDownloadError("Failed to download 3D model.");
          setIsLoading(false);
        }
      }
    };

    downloadModel();
    return () => { isMounted = false; };
  }, [modelUrl]);

  // 2) Viro AR Scene Component (Only rendered when local path is ready)
  const ARScene = () => {
    
    const onPinch = (pinchState: number, scaleFactor: number, source: any) => {
      // pinchState === 1 means gesture JUST STARTED. Snap our baseline.
      if (pinchState === 1) {
        gestureBaseScale.current = [...currentScale.current];
      }
      
      // Calculate new scale based on the strictly saved base scale at the VERY START of this specific gesture
      const newScale: [number, number, number] = [
        gestureBaseScale.current[0] * scaleFactor,
        gestureBaseScale.current[1] * scaleFactor,
        gestureBaseScale.current[2] * scaleFactor
      ];

      // pinchState === 3 means gesture ended. Commit the new scale as the final resting scale.
      if (pinchState === 3) {
        currentScale.current = newScale;
      }
      
      // Update directly natively to bypass React's slow render loop
      if (nodeRef.current) {
        nodeRef.current.setNativeProps({ scale: newScale });
      }
    };

    const onRotate = (rotateState: number, rotationFactor: number, source: any) => {
      // rotateState === 1 means gesture JUST STARTED. Snap our baseline.
      if (rotateState === 1) {
        gestureBaseRotation.current = [...currentRotation.current];
      }

      // Calculate new rotation by ADDING the delta to the baseline (for natural mapping)
      const newRotation: [number, number, number] = [
        gestureBaseRotation.current[0], 
        gestureBaseRotation.current[1] + rotationFactor, 
        gestureBaseRotation.current[2]
      ];

      // rotateState === 3 means gesture ended. Commit the new rotation as the final resting rotation.
      if (rotateState === 3) {
         currentRotation.current = newRotation;
      }
      
      // Update directly natively
      if (nodeRef.current) {
        nodeRef.current.setNativeProps({ rotation: newRotation });
      }
    };

    return (
      <ViroARScene>
        {/* Ambient light for base visibility */}
        <ViroAmbientLight color={"#ffffff"} intensity={isClayMode ? 400 : 200} />
        
        {/* Simple directional light */}
        <ViroDirectionalLight color="#ffffff" direction={[0, -1, -0.2]} intensity={isClayMode ? 800 : 400} />
        
        {/* 
            We wrap the object in a ViroNode with a ref.
            All gesture callbacks will mathematically resolve and directly 
            "setNativeProps" on this node, bypassing React re-renders!
        */}
        <ViroNode
          ref={nodeRef}
          position={[0, -0.5, -1]} 
          scale={currentScale.current}
          rotation={currentRotation.current}
          dragType="FixedDistance"
          onDrag={() => {}} // Internal Viro drag is automatic when dragType is set
          onPinch={onPinch}
          onRotate={onRotate}
        >
          {localModelPath && (
            <Viro3DObject
              source={{ uri: localModelPath }}
              type="GLB"
              position={[0, 0, 0]}
              scale={[1, 1, 1]}
              // materials removed to debug hard crash on iOS
              onLoadStart={() => console.log("ViroObject Load Start")}
              onLoadEnd={() => console.log("ViroObject Load Completed")}
              onError={(e) => {
                const errorMessage = e && e.nativeEvent ? e.nativeEvent.error : String(e);
                console.error("ViroObject Render Error:", errorMessage);
              }}
            />
          )}
        </ViroNode>
      </ViroARScene>
    );
  };

  return (
    <View style={styles.container}>
      {/* Viro Navigator takes up full screen behind UI */}
      {localModelPath && !downloadError ? (
        <ViroARSceneNavigator
          autofocus={true}
          initialScene={{ scene: ARScene }}
          style={styles.viroContainer}
        />
      ) : (
        <View style={styles.viroContainer} /> // Empty background while loading/error
      )}

      {/* Crosshair for placement (placeholder for now) */}
      {!isLoading && !downloadError && (
        <View style={styles.crosshair} pointerEvents="none">
          <View style={styles.crosshairDot} />
        </View>
      )}

      {/* Top overlay UI */}
      <View style={[styles.headerOverlay, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {modelTitle} <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>[v1.5]</Text>
        </Text>
        
        <TouchableOpacity 
          style={[styles.clayButton, isClayMode && styles.clayButtonActive]} 
          onPress={() => setIsClayMode(!isClayMode)}
        >
          <Text style={styles.clayButtonText}>CLAY</Text>
        </TouchableOpacity>
      </View>

      {/* Loading overlay for downloading payload */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Fetching Model Data...</Text>
        </View>
      )}

      {/* Error overlay */}
      {downloadError && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingText}>❌ {downloadError}</Text>
          <TouchableOpacity 
             style={{ marginTop: 20, padding: 10, backgroundColor: colors.surface, borderRadius: 8 }}
             onPress={() => navigation.goBack()}>
             <Text style={{ color: 'white' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom overlay UI */}
      {!isLoading && !downloadError && (
        <View style={[styles.bottomOverlay, { paddingBottom: insets.bottom + spacing.lg }]}>
           <View style={styles.instructionCard}>
              <Text style={styles.instructionText}>
                Swipe center to drag. Twist to Rotate. Pinch to Scale.
              </Text>
           </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  viroContainer: { flex: 1 },
  
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 20, color: '#FFF' },
  headerTitle: {
    flex: 1,
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.lg,
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  clayButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  clayButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  clayButtonText: {
    color: '#FFF',
    fontFamily: typography.fontFamily.bold,
    fontSize: 12,
    letterSpacing: 1,
  },

  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 20,
    height: 20,
    marginLeft: -10,
    marginTop: -10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  crosshairDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },

  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  instructionCard: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
  },
  instructionText: {
    color: '#FFF',
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.fontSize.sm,
  },

  loadingOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -75 }, { translateY: -50 }],
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  loadingText: {
    color: '#FFF',
    marginTop: spacing.sm,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.fontSize.sm,
  }
});
