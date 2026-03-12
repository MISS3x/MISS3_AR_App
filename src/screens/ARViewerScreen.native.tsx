import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { 
  ViroARSceneNavigator, ViroARScene, Viro3DObject, ViroAmbientLight, 
  ViroNode, ViroDirectionalLight, ViroSpotLight, ViroQuad, ViroMaterials,
  ViroARPlaneSelector, ViroARPlane, ViroBox, ViroAnimations, ViroText
} from '@reactvision/react-viro';
import * as FileSystem from 'expo-file-system/legacy';
import { colors, spacing, borderRadius, typography } from '../theme/theme';

ViroMaterials.createMaterials({
  clayMaterial: {
    lightingModel: "Blinn",
    diffuseColor: "#A0A0A0",
    roughness: 0.8,
    metalness: 0.1,
  },
  trackingMaterial: {
    lightingModel: "Constant",
    blendMode: "Add",
    diffuseColor: "rgba(0, 255, 255, 0.15)",
  },
  ringMaterial: {
    lightingModel: "Constant",
    blendMode: "Add",
    diffuseColor: "rgba(0, 150, 255, 1.0)"
  },
  testCubeMaterial: {
    lightingModel: "Blinn",
    diffuseColor: "#FF0000",
  }
});

ViroAnimations.registerAnimations({
  ringPulse: {
    properties: { scaleX: 3, scaleY: 3, scaleZ: 3, opacity: 0 },
    duration: 1000,
    easing: "EaseOut"
  }
});

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

// We define ViroMaterials outside safely so it only loads on native build.

// 2) Viro AR Scene Component - Defined OUTSIDE main screen to prevent ARKit native context crashes
const ARScene = (props: any) => {
  const {
    localModelPath, initialScale, initialRotation, 
    showMesh, isTestCube, 
    objectPosition, setObjectPosition,
    isPlaced, setIsPlaced
  } = props.sceneNavigator.viroAppProps;

  // We MUST use direct native prop manipulation via refs for gestures to keep 60fps
  const nodeRef = useRef<any>(null);
  
  // Mutable references for the gesture state (doesn't trigger re-render)
  const currentScale = useRef<[number, number, number]>(initialScale);
  const currentRotation = useRef<[number, number, number]>(initialRotation);

  // Variables specifically to hold the exact start state of the gesture
  const gestureBaseScale = useRef<[number, number, number]>(initialScale);
  const gestureBaseRotation = useRef<[number, number, number]>(initialRotation);
  
  const arSceneRef = useRef<any>(null);
  const lastHitTest = useRef<number>(0);
  
  const [yOffset, setYOffset] = useState(0);

  // Store detected AR room planes mapping
  const [planes, setPlanes] = useState<{[key: string]: any}>({});
  const [rings, setRings] = useState<{ id: number; position: [number, number, number] }[]>([]);

  const handleSceneClick = (position: number[], source: any) => {
    // Only process tap if on empty space
    if (position && position.length === 3) {
       // If the model hasn't been placed yet, drop it gracefully where the user tapped
       if (!isPlaced) {
          setObjectPosition([position[0], position[1], position[2]]);
          setIsPlaced(true);
       }
       
       // Visual ring confirmation
       const id = Date.now();
       setRings(prev => [...prev, { id, position: [position[0], position[1], position[2]] }]);
       setTimeout(() => {
          setRings(prev => prev.filter(r => r.id !== id));
       }, 1000);
    }
  };

  const onAnchorFound = (anchor: any) => {
    if (anchor.type === "plane") {
      setPlanes(prev => ({ ...prev, [anchor.anchorId]: anchor }));
    }
  };
  
  // Using a ref to track time since last update to avoid React thrashing on 60fps anchor updates
  const lastAnchorUpdate = useRef<number>(0);
  const onAnchorUpdated = (anchor: any) => {
    if (anchor.type === "plane") {
      const now = Date.now();
      if (now - lastAnchorUpdate.current > 500) { // Only update state strictly 2 times a second
         setPlanes(prev => ({ ...prev, [anchor.anchorId]: anchor }));
         lastAnchorUpdate.current = now;
      }
    }
  };
  
  const onAnchorRemoved = (anchor: any) => {
    if (anchor.type === "plane") {
      setPlanes(prev => { 
        const next = {...prev}; 
        delete next[anchor.anchorId]; 
        return next; 
      });
    }
  };

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

  const handleDrag = (dragToPos: number[], source: any) => {
    // 1. Update React state immediately so the map is always perfectly synced.
    setObjectPosition([dragToPos[0], dragToPos[1], dragToPos[2]]);

    // 2. Perform Native ARKit HitTest to find the normal of the surface we dragged onto
    const now = Date.now();
    if (arSceneRef && arSceneRef.current && (now - lastHitTest.current > 100)) {
       lastHitTest.current = now;
       arSceneRef.current.performARHitTestWithPosition(dragToPos).then((results: any) => {
          if (results && results.length > 0) {
             const hit = results[0];
             if (hit.transform && hit.transform.rotation) {
                const snapRot = hit.transform.rotation;
                const isWall = Math.abs(snapRot[0]) > 45 || Math.abs(snapRot[2]) > 45;
                if (isWall) {
                   currentRotation.current = [snapRot[0], snapRot[1], snapRot[2]];
                   if (nodeRef.current) nodeRef.current.setNativeProps({ rotation: currentRotation.current });
                } else {
                   currentRotation.current = [0, currentRotation.current[1], 0];
                   if (nodeRef.current) nodeRef.current.setNativeProps({ rotation: currentRotation.current });
                }
             }
          }
       }).catch(() => {});
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
    <ViroARScene 
      ref={arSceneRef}
      anchorDetectionTypes={['PlanesHorizontal', 'PlanesVertical']}
      onAnchorFound={onAnchorFound}
      onAnchorUpdated={onAnchorUpdated}
      onAnchorRemoved={onAnchorRemoved}
      onClick={handleSceneClick}
    >
      {/* Render Holodeck Glowing Grids on all detected physical planes */}
      {showMesh && Object.values(planes).map((p) => {
        return (
          <ViroARPlane key={p.anchorId} anchorId={p.anchorId}>
            <ViroQuad 
              position={[0, 0, 0]} 
              rotation={[-90, 0, 0]} 
              width={p.width} 
              height={p.height}
              uvCoordinates={[0, 0, p.width / 0.25, p.height / 0.25] as any}
              materials={["trackingMaterial"]} 
            />
          </ViroARPlane>
        );
      })}

      {rings.map(r => (
        <ViroNode key={r.id} position={r.position}>
          <ViroQuad 
            rotation={[-90, 0, 0]} 
            width={0.5} height={0.5} 
            materials={["ringMaterial"]}
            animation={{ name: "ringPulse", run: true, loop: false }}
          />
        </ViroNode>
      ))}

      {/* Ambient light for base visibility */}
      <ViroAmbientLight color="#ffffff" intensity={200} />
      
      {/* We use a low shadowMapSize (512) and low opacity to naturally blur the shadow via PCF Native filtering, simulating an Ambient Occlusion contact shadow. */}
      <ViroDirectionalLight 
        color="#ffffff" 
        direction={[0, -1, -0.2]} 
        intensity={400} 
        castsShadow={true}
        shadowMapSize={512}
        shadowNearZ={0.1}
        shadowFarZ={5}
        shadowOpacity={0.5}
      />
      
      {/* Render object ONLY after user taps on a surface */}
      {isPlaced && (
      <ViroNode
        ref={nodeRef}
        position={objectPosition}
        scale={currentScale.current}
        rotation={currentRotation.current}
        dragType="FixedToPlane"
        dragPlane={{ planePoint: [0, objectPosition[1], 0], planeNormal: [0, 1, 0], maxDistance: 20 }}
        onDrag={handleDrag}
        onPinch={onPinch}
        onRotate={onRotate}
      >
        {isTestCube ? (
           <>
             <ViroBox
               position={[0, 0, 0]}
               scale={[1, 1, 1]}
               materials={["testCubeMaterial"]}
             />
             <ViroQuad
               position={[0, -0.01, 0]}
               rotation={[-90, 0, 0]}
               width={10}
               height={10}
               arShadowReceiver={true}
               ignoreEventHandling={true}
             />
           </>
        ) : localModelPath && (
          <>
            <Viro3DObject
              source={{ uri: localModelPath }}
              type={(() => {
                const ext = localModelPath.split('.').pop()?.toUpperCase() || 'GLB';
                return ext === 'GLTF' ? 'GLTF' : ext === 'OBJ' ? 'OBJ' : ext === 'VRX' ? 'VRX' : 'GLB';
              })()}
              position={[0, yOffset, 0]}
              scale={[1, 1, 1]}
              onLoadStart={() => console.log("ViroObject Load Start")}
              onLoadEnd={async () => {
                console.log("ViroObject Load Completed. Calculating Bounding Box for Pivot Offset.");
                if (nodeRef.current && nodeRef.current.getBoundingBoxAsync) {
                   try {
                      const boundingBox = await nodeRef.current.getBoundingBoxAsync();
                      if (boundingBox && boundingBox.minY < 0 && yOffset === 0) {
                         const shift = Math.abs(boundingBox.minY);
                         console.log(`Pivot correction: Lifting model by +${shift.toFixed(4)}m to ground it.`);
                         setYOffset(shift);
                      }
                   } catch (e) {
                      console.log("Could not measure bounding box:", e);
                   }
                }
              }}
              onError={(e) => {
                const errorMessage = e && e.nativeEvent ? e.nativeEvent.error : String(e);
                console.warn("ViroObject Render Error:", errorMessage);
                Alert.alert("Unsupported Format", "Model failed to load. If this is an FBX, please convert it to GLB first.");
              }}
            />
            
            {/* Invisible floor below the object to catch shadows cast from the directional light */}
            <ViroQuad
              position={[0, -0.01, 0]}
              rotation={[-90, 0, 0]}
              width={10}
              height={10}
              arShadowReceiver={true}
              ignoreEventHandling={true}
            />
          </>
        )}
      </ViroNode>
      )}
    </ViroARScene>
  );
};

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
  const [showMap, setShowMap] = useState(false);
  const [showMesh, setShowMesh] = useState(true);
  const [isTestCube, setIsTestCube] = useState(false); 
  const [objectPosition, setObjectPosition] = useState<[number, number, number]>([0, 0, 0]);
  const [isPlaced, setIsPlaced] = useState(false);

  // Download model to local filesystem (ViroReact requires local file paths)
  useEffect(() => {
    let isMounted = true;
    const downloadModel = async () => {
      try {
        setIsLoading(true);
        setDownloadError(null);

        const fileName = modelUrl.split('?')[0].split('/').pop() || 'model.glb';
        const localUri = `${FileSystem.documentDirectory}${fileName}`;

        const fileInfo = await FileSystem.getInfoAsync(localUri);
        if (fileInfo.exists) {
           console.log("Model loaded from cache:", localUri);
           if (isMounted) {
             setLocalModelPath(`file://${localUri}`);
             setIsLoading(false);
           }
           return;
        }

        console.log("Downloading model from Supabase to:", localUri);
        const { uri } = await FileSystem.downloadAsync(modelUrl, localUri);
        
        if (isMounted) {
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

  const viroAppProps = {
    localModelPath, initialScale, initialRotation,
    showMesh, isTestCube,
    objectPosition, setObjectPosition,
    isPlaced, setIsPlaced
  };

  return (
    <View style={styles.container}>
      {/* Viro Navigator takes up full screen behind UI. Mount unconditionally to prevent ARKit terminating. */}
      <ViroARSceneNavigator
        autofocus={true}
        // @ts-ignore
        initialScene={{ scene: ARScene }}
        viroAppProps={viroAppProps}
        style={styles.viroContainer}
        occlusionMode="depthBased"
      />


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
          {modelTitle}
        </Text>
        
        <TouchableOpacity 
          style={[styles.clayButton, showMesh && styles.clayButtonActive]} 
          onPress={() => setShowMesh(!showMesh)}
        >
          <Text style={styles.clayButtonText}>MESH</Text>
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
                {"Drag to move • Pinch to scale • Twist to rotate"}
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
  
  mapOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(10, 20, 30, 0.85)',
    zIndex: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapGrid: {
    width: 300,
    height: 400,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 255, 0.2)',
    backgroundColor: 'rgba(0, 255, 255, 0.05)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mapUserDot: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapUserDotInner: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: '#00FFFF',
    shadowColor: '#00FFFF', shadowRadius: 10, shadowOpacity: 0.8,
  },
  mapUserText: {
    color: '#00FFFF', fontSize: 10, fontFamily: typography.fontFamily.bold,
    marginBottom: 4,
  },
  mapObjectBox: {
    position: 'absolute',
    width: 16, height: 16, backgroundColor: colors.primary,
    borderWidth: 2, borderColor: '#FFF',
    alignItems: 'center', justifyContent: 'center',
  },
  mapObjectText: {
    position: 'absolute',
    top: -20,
    color: '#FFF', fontSize: 12, fontFamily: typography.fontFamily.bold,
    width: 100, textAlign: 'center',
  },

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


