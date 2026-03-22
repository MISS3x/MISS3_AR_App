import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, FlatList, Alert, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import {
  ViroARSceneNavigator, ViroARScene, Viro3DObject, ViroAmbientLight,
  ViroNode, ViroDirectionalLight, ViroQuad, ViroMaterials,
  ViroARPlane, ViroAnimations,
  ViroBox,
  ViroSphere,
  ViroPolyline
} from '@reactvision/react-viro';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

import { colors, spacing, borderRadius, typography, shadows } from '../theme/theme';
import { supabase } from '../lib/supabase';

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
    diffuseColor: "rgba(0, 255, 255, 0.08)",
  },
  // X-ray ghost material — solid cyan translucent
  xrayMaterial: {
    lightingModel: "Constant",
    diffuseColor: "rgba(0, 200, 255, 0.7)",
  },
  // Reticle circle on floor — 50cm, bright cyan
  reticleCircleMaterial: {
    lightingModel: "Constant",
    diffuseColor: "rgba(0, 255, 255, 0.6)",
  },
  // Inner dot of reticle
  reticleDotMaterial: {
    lightingModel: "Constant",
    diffuseColor: "rgba(0, 255, 255, 0.9)",
  },
  ringMaterial: {
    lightingModel: "Constant",
    blendMode: "Add",
    diffuseColor: "rgba(0, 255, 255, 0.0)"
  },
});

ViroAnimations.registerAnimations({
  ringPulse: {
    properties: { scaleX: 3, scaleY: 3, scaleZ: 3, opacity: 0 },
    duration: 1000,
    easing: "EaseOut"
  },
  reticlePulse: {
    properties: { scaleX: 1.15, scaleY: 1.15, scaleZ: 1.15, opacity: 0.4 },
    duration: 1500,
    easing: "EaseInEaseOut"
  },
});

interface ARPlacedObject {
  id: string;
  title: string;
  localUri: string;
  position: [number, number, number];
  scale: [number, number, number];
  rotation: [number, number, number];
  yOffset: number;
  modelOffset: [number, number, number];
}

interface CatalogModel {
  id: string;
  title: string;
  thumbnail_path: string | null;
  storage_path: string;
  metadata: { file_size?: number } | null;
  model_transform?: {
      position?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number };
      scale?: { x: number; y: number; z: number };
      modelOffset?: { x: number; y: number; z: number };
  } | null;
}


const ARNodeComponent = ({ obj, index, setPlacedObjects, arSceneRef }: { obj: ARPlacedObject, index: number, setPlacedObjects: any, arSceneRef?: any }) => {
  const nodeRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const currentScale = useRef<[number, number, number]>(obj.scale);
  const currentRotation = useRef<[number, number, number]>(obj.rotation);
  const gestureBaseScale = useRef<[number, number, number]>(obj.scale);
  const gestureBaseRotation = useRef<[number, number, number]>(obj.rotation);

  const onPinch = (pinchState: number, scaleFactor: number, source: any) => {
    if (pinchState === 1) gestureBaseScale.current = [...currentScale.current];
    const newScale: [number, number, number] = [
      gestureBaseScale.current[0] * scaleFactor,
      gestureBaseScale.current[1] * scaleFactor,
      gestureBaseScale.current[2] * scaleFactor
    ];
    if (pinchState === 3) currentScale.current = newScale;
    if (nodeRef.current) nodeRef.current.setNativeProps({ scale: newScale });
  };

  const onRotate = (rotateState: number, rotationFactor: number, source: any) => {
    if (rotateState === 1) gestureBaseRotation.current = [...currentRotation.current];
    const newRotation: [number, number, number] = [
      gestureBaseRotation.current[0], 
      gestureBaseRotation.current[1] + rotationFactor, 
      gestureBaseRotation.current[2]
    ];
    if (rotateState === 3) currentRotation.current = newRotation;
    if (nodeRef.current) nodeRef.current.setNativeProps({ rotation: newRotation });
  };

  const lastHitTest = useRef<number>(0);

  const handleDrag = (dragToPos: number[], source: any) => {
    setPlacedObjects((prev: ARPlacedObject[]) => {
      return prev.map(p =>
        p.id === obj.id ? { ...p, position: [dragToPos[0], dragToPos[1], dragToPos[2]] as [number, number, number] } : p
      );
    });

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

  return (
    <ViroNode
      ref={nodeRef}
      scale={currentScale.current}
      rotation={currentRotation.current}
      position={obj.position}
      dragType="FixedToPlane"
      dragPlane={{ planePoint: [0, obj.position[1], 0], planeNormal: [0, 1, 0], maxDistance: 20 }}
      onDrag={handleDrag}
      onPinch={onPinch}
      onRotate={onRotate}
    >
      <Viro3DObject
        ref={modelRef}
        source={{ uri: obj.localUri }}
        type={(() => {
          const ext = obj.localUri.split('.').pop()?.toUpperCase() || 'GLB';
          return ext === 'GLTF' ? 'GLTF' : ext === 'OBJ' ? 'OBJ' : ext === 'VRX' ? 'VRX' : 'GLB';
        })()}
        position={[obj.modelOffset[0], obj.yOffset + obj.modelOffset[1], obj.modelOffset[2]]}
        scale={[1, 1, 1]}
        onLoadEnd={async () => {
          // Calculate bounding box to offset pivot → bottom sits on floor
          if (modelRef.current && modelRef.current.getBoundingBoxAsync && obj.yOffset === 0) {
             try {
                const result = await modelRef.current.getBoundingBoxAsync();
                if (result && result.boundingBox && typeof result.boundingBox.minY === 'number') {
                   // Shift by inverted minY to align the exact bottom of the mesh to Y=0
                   const shift = -result.boundingBox.minY + 0.01; 
                   console.log(`[Model ${obj.title}] BBox minY=${result.boundingBox.minY.toFixed(3)} → yOffset=${shift.toFixed(3)}`);
                   // Use obj.id (not index!) to find correct object — index may be stale
                   setPlacedObjects((prev: ARPlacedObject[]) => 
                     prev.map(p => p.id === obj.id ? { ...p, yOffset: shift } : p)
                   );
                }
             } catch (e) {
               console.log(`[Model ${obj.title}] getBoundingBoxAsync failed:`, e);
             }
          }
        }}
      />
      <ViroQuad
        position={[0, 0.002, 0]}
        rotation={[-90, 0, 0]}
        width={3}
        height={3}
        arShadowReceiver={true}
        ignoreEventHandling={true}
      />
    </ViroNode>
  );
};

const circlePoints: [number, number, number][] = Array.from({ length: 33 }).map((_, i) => {
  const angle = (i / 32) * Math.PI * 2;
  return [Math.cos(angle) * 0.25, 0.001, Math.sin(angle) * 0.25];
});

const ARScene = (props: any) => {
  const { 
     placedObjects, setPlacedObjects, 
     planes, setPlanes,
     pendingModelContext, setPendingModelContext,
     ghostPosition, setGhostPosition,
     onPlaceGhost,
     crystalUri
  } = props.sceneNavigator.viroAppProps;
  
  const [rings, setRings] = useState<{ id: number; position: [number, number, number] }[]>([]);
  const lastAnchorUpdate = useRef<number>(0);
  const arSceneRef = useRef<any>(null);

  // Continuous floor hit-test for ghost preview
  const lastGhostUpdate = useRef<number>(0);
  
  const handleCameraTransform = () => {
    if (!arSceneRef.current) return;
    
    const now = Date.now();
    if (now - lastGhostUpdate.current < 100) return; // 10fps for ghost
    lastGhostUpdate.current = now;
    
    arSceneRef.current.getCameraOrientationAsync().then((cam: any) => {
      if (!cam || !cam.position || !cam.forward) return;
      // Cast a ray from camera forward 3m toward floor for a better projection distance
      const rayEnd = [
        cam.position[0] + cam.forward[0] * 3,
        cam.position[1] + cam.forward[1] * 3,
        cam.position[2] + cam.forward[2] * 3
      ];
      arSceneRef.current.performARHitTestWithPosition(rayEnd).then((results: any) => {
        if (results && results.length > 0) {
          // Reverting to the logic that worked well for the user:
          // Find any hit with a roughly horizontal rotation, regardless of plane typing.
          const floorHit = results.find((hit: any) => {
            if (!hit.transform || !hit.transform.rotation) return false;
            const rot = hit.transform.rotation;
            return Math.abs(rot[0]) < 20 && Math.abs(rot[2]) < 20;
          });
          
          if (floorHit) {
            const pos = floorHit.transform.position || rayEnd;
            setGhostPosition([pos[0], pos[1], pos[2]]);
          } else {
             // Fallback: If no flat hit point found, project safely to 1.5m below camera height.
             const fallbackY = cam.position[1] - 1.5;
             setGhostPosition([rayEnd[0], fallbackY, rayEnd[2]]);
          }
        }
      }).catch(() => {});
    }).catch(() => {});
  };

  const handleSceneClick = (position: number[], source: any) => {
    // Disabled placing objects on tap. 
    // Objects should only be placed using the UI button.
  };

  const onAnchorFound = (anchor: any) => {
    if (anchor.type === "plane") setPlanes((prev: any) => ({ ...prev, [anchor.anchorId]: anchor }));
  };
  
  const onAnchorUpdated = (anchor: any) => {
    if (anchor.type === "plane") {
      const now = Date.now();
      if (now - lastAnchorUpdate.current > 500) {
         setPlanes((prev: any) => ({ ...prev, [anchor.anchorId]: anchor }));
         lastAnchorUpdate.current = now;
      }
    }
  };
  
  const onAnchorRemoved = (anchor: any) => {
    if (anchor.type === "plane") {
      setPlanes((prev: any) => { 
        const next = {...prev}; 
        delete next[anchor.anchorId]; 
        return next; 
      });
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
      onCameraTransformUpdate={handleCameraTransform}
    >
      {Object.values(planes).map((p: any) => {
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

      <ViroAmbientLight color="#ffffff" intensity={250} />
      <ViroDirectionalLight 
        color="#ffffff" 
        direction={[0, -1, -0.2]} 
        intensity={350} 
        castsShadow={true} 
        shadowMapSize={2048}
        shadowNearZ={0.1} 
        shadowFarZ={8} 
        shadowOpacity={0.25}
        shadowOrthographicSize={5}
      />

      {/* Floor reticle — always visible when ghostPosition is available */}
      {ghostPosition && (
        <ViroNode position={ghostPosition}>
          {/* 50cm circle on floor — ViroPolyline outline */}
          <ViroPolyline
            position={[0, 0, 0]}
            points={circlePoints}
            thickness={0.015}
            materials={["reticleCircleMaterial"]}
            animation={{ name: "reticlePulse", run: true, loop: true }}
          />
          {/* Center dot */}
          <ViroSphere 
            radius={0.015}
            scale={[1, 0.01, 1]}
            position={[0, 0.001, 0]}
            materials={["reticleDotMaterial"]}
          />
        </ViroNode>
      )}

      {/* Ghost preview — x-ray model following floor reticle */}
      {pendingModelContext && ghostPosition && (
        <ViroNode position={ghostPosition} opacity={0.65}>
          {/* Ghost 3D model with x-ray material */}
          <Viro3DObject
            source={{ uri: pendingModelContext.localUri }}
            resources={[]}
            type={(() => {
              const ext = pendingModelContext.localUri.split('.').pop()?.toUpperCase() || 'GLB';
              return ext === 'GLTF' ? 'GLTF' : ext === 'OBJ' ? 'OBJ' : ext === 'VRX' ? 'VRX' : 'GLB';
            })()}
            position={[
              pendingModelContext.model_transform?.modelOffset?.x || 0,
              pendingModelContext.model_transform?.modelOffset?.y || 0,
              pendingModelContext.model_transform?.modelOffset?.z || 0
            ]}
            scale={[
              pendingModelContext.model_transform?.scale?.x || 1,
              pendingModelContext.model_transform?.scale?.y || 1,
              pendingModelContext.model_transform?.scale?.z || 1
            ]}
            materials={["xrayMaterial"]}
          />
        </ViroNode>
      )}

      {/* Demo ghost — local Crystal primitive when no model selected but reticle active */}
      {!pendingModelContext && ghostPosition && crystalUri && (
        <ViroNode position={ghostPosition} opacity={0.65}>
          <Viro3DObject
            source={{ uri: crystalUri }}
            position={[0, 0, 0]}
            scale={[1, 1, 1]}
            type="GLB"
            materials={["xrayMaterial"]}
          />
        </ViroNode>
      )}
      
      {placedObjects && placedObjects.map((obj: ARPlacedObject, i: number) => (
        <ARNodeComponent key={obj.id} obj={obj} index={i} setPlacedObjects={setPlacedObjects} arSceneRef={arSceneRef} />
      ))}
    </ViroARScene>
  );
};

export default function SandboxARScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  
  const [placedObjects, setPlacedObjects] = useState<ARPlacedObject[]>([]);
  const [planes, setPlanes] = useState<{[key: string]: any}>({});
  const [pendingModelContext, setPendingModelContext] = useState<(CatalogModel & { localUri: string }) | null>(null);
  const [ghostPosition, setGhostPosition] = useState<[number, number, number] | null>(null);
  
  // Catalog Modal States
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [crystalUri, setCrystalUri] = useState<string | null>(null);
  
  // Blink animation for PLACE button
  const blinkAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (pendingModelContext) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(blinkAnim, { toValue: 0.4, duration: 600, useNativeDriver: true }),
          Animated.timing(blinkAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      blinkAnim.setValue(1);
    }
  }, [pendingModelContext]);

  const fetchInventory = async () => {
    try {
      setLoadingCatalog(true);
      const { data, error } = await supabase
        .from('models_3d')
        .select('id, title, thumbnail_path, storage_path, metadata, model_transform')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCatalogModels(data || []);
    } catch (err) {
      console.error("Error fetching inventory:", err);
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    fetchInventory();
    preloadCrystal();
  }, []);

  const preloadCrystal = async () => {
    try {
      const asset = await Asset.fromModule(require('../../assets/models/crystal_pbr.glb')).downloadAsync();
      setCrystalUri(asset.localUri || asset.uri);
    } catch (err) {
      console.log("Failed to preload crystal:", err);
    }
  };

  const handleSelectModelFromCatalog = async (model: CatalogModel) => {
    setDownloadingModelId(model.id);
    try {
      const { data: signedData, error: signedError } = await supabase
        .storage
        .from('models_secure')
        .createSignedUrl(model.storage_path, 3600);
        
      if (signedError || !signedData?.signedUrl) {
         throw new Error("Could not generate secure file URL");
      }

      const fileName = model.storage_path.split('/').pop() || 'model.glb';
      const localUri = `${FileSystem.documentDirectory}${fileName}`;

      const fileInfo = await FileSystem.getInfoAsync(localUri);
      let finalUri = localUri;
      if (!fileInfo.exists) {
        console.log('Downloading model to:', localUri);
        const { uri } = await FileSystem.downloadAsync(signedData.signedUrl, localUri);
        finalUri = uri;
      } else {
        console.log('Model loaded from cache:', localUri);
      }

      setPendingModelContext({
         ...model,
         localUri: `file://${finalUri}`
      });
      setGhostPosition(null); // Reset ghost position
      
      setIsCatalogOpen(false);
    } catch (err) {
      console.error("Failed to download model:", err);
      Alert.alert('Download Failed', 'Could not download the 3D model.');
    } finally {
      setDownloadingModelId(null);
    }
  };

  // Place the ghost model at its current position
  const handlePlaceGhost = () => {
    if (!pendingModelContext || !ghostPosition) return;

    // IMPORTANT: Freeze position values immediately — ghostPosition state
    // can change between now and next render, which would move placed model
    const frozenX = ghostPosition[0];
    const frozenY = ghostPosition[1];
    const frozenZ = ghostPosition[2];

    const scaleArgs = pendingModelContext.model_transform?.scale;
    const parsedScale: [number, number, number] = scaleArgs ? [scaleArgs.x, scaleArgs.y, scaleArgs.z] : [1, 1, 1];
    const rotArgs = pendingModelContext.model_transform?.rotation;
    const parsedRotation: [number, number, number] = rotArgs ? [rotArgs.x, rotArgs.y, rotArgs.z] : [0, 0, 0];
    const offsetArgs = pendingModelContext.model_transform?.modelOffset;
    const parsedOffset: [number, number, number] = offsetArgs ? [offsetArgs.x, offsetArgs.y, offsetArgs.z] : [0, 0, 0];

    const newObject: ARPlacedObject = {
      id: Math.random().toString(36).substring(7),
      title: pendingModelContext.title || 'Model',
      localUri: pendingModelContext.localUri,
      position: [frozenX, frozenY, frozenZ] as [number, number, number],
      scale: parsedScale,
      rotation: parsedRotation,
      yOffset: 0,
      modelOffset: parsedOffset,
    };

    // Add to placed objects FIRST, then reset ghost
    setPlacedObjects(prev => {
      const updated = [...prev, newObject];
      return updated;
    });
    // Reset ghost position so it follows camera again for next placement
    // Using setTimeout to ensure placedObjects state is committed first
    setTimeout(() => setGhostPosition(null), 50);
  };

  const formatSize = (meta: any) => meta?.file_size ? `${(meta.file_size / 1048576).toFixed(1)} MB` : 'N/A';
  const getThumbnailUrl = (path: string | null) => path ? `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/model_thumbnails/${path}` : null;

  const hasPlacedAny = placedObjects.length > 0;

  return (
    <View style={styles.container}>
      <ViroARSceneNavigator 
        autofocus={true} 
        // @ts-ignore
        initialScene={{ scene: ARScene }} 
        viroAppProps={{ 
           placedObjects, setPlacedObjects, 
           planes, setPlanes,
           pendingModelContext, setPendingModelContext,
           ghostPosition, setGhostPosition,
           onPlaceGhost: handlePlaceGhost,
           crystalUri,
        }}
        style={styles.viroContainer} 
        occlusionMode="depthBased"
      />

      {/* Crosshair removed — big 50cm reticle circle in AR scene is always visible */}

      {/* Top Header */}
      <View style={[styles.headerOverlay, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Multi Models Viewer</Text>
        {pendingModelContext && (
          <View style={styles.ghostIndicator}>
            <Text style={styles.ghostIndicatorText}>👻 {pendingModelContext.title}</Text>
          </View>
        )}
      </View>

      {/* Bottom Action Area — always 2 buttons when model is loaded */}
      {!isCatalogOpen && (
        <View style={[styles.bottomOverlay, { paddingBottom: insets.bottom + spacing.lg }]}>
          {pendingModelContext ? (
            // Ghost active — CHANGE MODEL + PLACE MODEL / PLACE ANOTHER
            <View style={styles.buttonRow}>
              <TouchableOpacity 
                style={[styles.secondaryButton]} 
                onPress={() => {
                  setPendingModelContext(null);
                  setGhostPosition(null);
                  setIsCatalogOpen(true);
                }}
              >
                <Text style={styles.secondaryButtonText}>CHANGE{"\n"}MODEL</Text>
              </TouchableOpacity>
              
              <Animated.View style={{ opacity: blinkAnim }}>
                <TouchableOpacity 
                  style={styles.placeButton} 
                  onPress={handlePlaceGhost}
                  activeOpacity={0.8}
                >
                  <Text style={styles.placeButtonIcon}>⬇</Text>
                  <Text style={styles.placeButtonText}>{hasPlacedAny ? 'PLACE ANOTHER' : 'PLACE MODEL'}</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>
          ) : (
            // No model selected — show ADD MODEL
            <TouchableOpacity 
              style={styles.addButton} 
              onPress={() => setIsCatalogOpen(true)}
            >
              <Text style={styles.addButtonIcon}>+</Text>
              <Text style={styles.addButtonText}>{hasPlacedAny ? 'PLACE ANOTHER' : 'ADD MODEL'}</Text>
            </TouchableOpacity>
          )}
          
          {/* Instruction hint */}
          {pendingModelContext ? (
            <Text style={styles.hintText}>Move phone to position ghost • Tap PLACE to confirm</Text>
          ) : hasPlacedAny ? (
            <Text style={styles.hintText}>Drag to move • Pinch to scale • Twist to rotate</Text>
          ) : (
            <Text style={styles.hintText}>Select a 3D model from the catalog to begin</Text>
          )}
        </View>
      )}

      {/* CATALOG MODAL */}
      <Modal visible={isCatalogOpen} animationType="slide" transparent={true}>
         <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
           <View style={styles.modalHeader}>
             <Text style={styles.modalTitle}>Model Catalog</Text>
             <TouchableOpacity onPress={() => setIsCatalogOpen(false)} style={styles.modalCloseButton}>
               <Text style={{ color: '#FFF', fontSize: 15 }}>✕</Text>
             </TouchableOpacity>
           </View>
           
           {loadingCatalog ? (
             <ActivityIndicator style={{marginTop: 50}} size="large" color={colors.primary} />
           ) : (
             <FlatList
               data={catalogModels}
               keyExtractor={(item) => item.id}
               contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
               renderItem={({ item }) => (
                 <TouchableOpacity 
                   style={styles.catalogCard} 
                   activeOpacity={0.8}
                   onPress={() => {
                     if (downloadingModelId) return;
                     handleSelectModelFromCatalog(item);
                   }}
                 >
                   <Image source={{ uri: getThumbnailUrl(item.thumbnail_path) || '' }} style={styles.catalogImage} contentFit="cover" />
                   <View style={styles.catalogCardInfo}>
                     <Text style={styles.catalogCardTitle}>{item.title || 'Model'}</Text>
                     <Text style={styles.catalogCardSize}>{formatSize(item.metadata)}</Text>
                   </View>
                   {downloadingModelId === item.id ? (
                      <ActivityIndicator color={colors.primary} />
                   ) : (
                     <View style={styles.catalogAddIcon}><Text style={{color: '#FFF', fontSize: 16}}>+</Text></View>
                   )}
                 </TouchableOpacity>
               )}
             />
           )}
         </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  viroContainer: { flex: 1 },
  headerOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, gap: spacing.sm, zIndex: 10,
  },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 20, color: '#FFF' },
  headerTitle: { flex: 1, fontFamily: typography.fontFamily.semiBold, fontSize: typography.fontSize.lg, color: '#FFF' },
  
  ghostIndicator: {
    backgroundColor: 'rgba(0, 230, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 255, 0.4)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ghostIndicatorText: {
    color: '#00E6FF',
    fontSize: 11,
    fontFamily: typography.fontFamily.semiBold,
  },
  
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 40,
    height: 40,
    marginLeft: -20,
    marginTop: -20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  crosshairRing: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(0, 230, 255, 0.6)',
  },
  crosshairDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E6FF',
  },
  
  bottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', zIndex: 10, gap: 8 },
  
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  
  addButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 30, ...shadows.md,
  },
  addButtonIcon: { color: '#000', fontSize: 24, marginRight: 8, fontWeight: 'bold' },
  addButtonText: { color: '#000', fontFamily: typography.fontFamily.bold, fontSize: 14, letterSpacing: 1 },

  placeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00E6FF',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 30,
    ...shadows.md,
  },
  placeButtonIcon: { fontSize: 18, marginRight: 8 },
  placeButtonText: { color: '#000', fontFamily: typography.fontFamily.bold, fontSize: 15, letterSpacing: 1 },
  
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#FFF',
    fontFamily: typography.fontFamily.bold,
    fontSize: 10,
    letterSpacing: 1,
    textAlign: 'center',
    lineHeight: 14,
  },
  
  hintText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontFamily: typography.fontFamily.medium,
    textAlign: 'center',
  },

  modalContainer: { flex: 1, backgroundColor: colors.surfaceElevated },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { color: '#FFF', fontSize: 18, fontFamily: typography.fontFamily.bold },
  modalCloseButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  catalogCard: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.sm, alignItems: 'center' },
  catalogImage: { width: 60, height: 60, borderRadius: borderRadius.sm, backgroundColor: 'rgba(255,255,255,0.05)' },
  catalogCardInfo: { flex: 1, marginLeft: spacing.md },
  catalogCardTitle: { color: '#FFF', fontFamily: typography.fontFamily.semiBold, fontSize: 14 },
  catalogCardSize: { color: colors.textTertiary, fontFamily: typography.fontFamily.medium, fontSize: 12, marginTop: 4 },
  catalogAddIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,230,255,0.15)', borderWidth: 1, borderColor: 'rgba(0,230,255,0.3)', alignItems: 'center', justifyContent: 'center' },
});
