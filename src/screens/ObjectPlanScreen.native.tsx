import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, FlatList, Alert, ScrollView, PanResponder } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import {
  ViroARSceneNavigator, ViroARScene, Viro3DObject, ViroAmbientLight,
  ViroNode, ViroDirectionalLight, ViroQuad, ViroMaterials,
  ViroARPlaneSelector, ViroBox, ViroARPlane, ViroAnimations, ViroText
} from '@reactvision/react-viro';
import * as FileSystem from 'expo-file-system/legacy';

import { colors, spacing, borderRadius, typography, shadows } from '../theme/theme';
import { supabase } from '../lib/supabase';
// Removed lidar-mesh imports

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
    diffuseColor: "rgba(0, 255, 255, 0.0)"
  },
  wireMaterial: {
    lightingModel: "Constant",
    blendMode: "Add",
    diffuseColor: "rgba(0, 255, 200, 0.4)" // Soft semi-transparent wire mesh
  }
});

ViroAnimations.registerAnimations({
  ringPulse: {
    properties: { scaleX: 3, scaleY: 3, scaleZ: 3, opacity: 0 },
    duration: 1000,
    easing: "EaseOut"
  }
});

interface ARPlacedObject {
  id: string;             // Unique instance ID
  title: string;          // Model Title
  localUri: string;       // Local absolute file path
  position: [number, number, number];
  scale: [number, number, number];
  rotation: [number, number, number];
  yOffset: number;        // Cached bounding box offset
  modelOffset: [number, number, number]; // Pivot offset from web editor
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


// Extract components outside the main function so ViroReact doesn't destroy and recreate them on every render
const ARNodeComponent = ({ obj, index, setPlacedObjects, arSceneRef }: { obj: ARPlacedObject, index: number, setPlacedObjects: any, arSceneRef?: any }) => {
  const nodeRef = useRef<any>(null);
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
    // 1. Update position state for 2D map tracking by explicitly matching the unique ID, 
    // avoiding stale index closures when multiple identical objects are spawned.
    setPlacedObjects((prev: ARPlacedObject[]) => {
      return prev.map(p =>
        p.id === obj.id ? { ...p, position: [dragToPos[0], dragToPos[1], dragToPos[2]] as [number, number, number] } : p
      );
    });

    // 2. Perform Native ARKit HitTest to find the normal of the surface we dragged onto
    const now = Date.now();
    if (arSceneRef && arSceneRef.current && (now - lastHitTest.current > 100)) {
       lastHitTest.current = now;
       arSceneRef.current.performARHitTestWithPosition(dragToPos).then((results: any) => {
          if (results && results.length > 0) {
             const hit = results[0];
             // hit.transform.rotation is the normal rotation of the plane!
             // If the user drags onto a wall, this rotation represents the wall's outward normal.
             if (hit.transform && hit.transform.rotation) {
                // To attach the object flush against the wall, we might need to combine this base surface rotation 
                // with the user's twist rotation. For now, let's just snap the base explicitly if it drastically changes.
                // An ARKit floor is typically [0,0,0]. A wall is typically rotated on X or Z by 90/-90.
                const snapRot = hit.transform.rotation;
                
                // Only snap to wall normal if the surface is noticeably vertical (e.g. pitch or roll > 45 deg)
                const isWall = Math.abs(snapRot[0]) > 45 || Math.abs(snapRot[2]) > 45;
                if (isWall) {
                   // We assign the wall's native matrix rotation as our object's rotation baseline
                   currentRotation.current = [snapRot[0], snapRot[1], snapRot[2]];
                   // Update visually instantly
                   if (nodeRef.current) nodeRef.current.setNativeProps({ rotation: currentRotation.current });
                } else {
                   // Return to flat ground upright, retaining user's Y-axis twist
                   currentRotation.current = [0, currentRotation.current[1], 0];
                   if (nodeRef.current) nodeRef.current.setNativeProps({ rotation: currentRotation.current });
                }
             }
          }
       }).catch(() => {}); // ignore hit test errors silently
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
        source={{ uri: obj.localUri }}
        type={(() => {
          const ext = obj.localUri.split('.').pop()?.toUpperCase() || 'GLB';
          return ext === 'GLTF' ? 'GLTF' : ext === 'OBJ' ? 'OBJ' : ext === 'VRX' ? 'VRX' : 'GLB';
        })()}
        position={[obj.modelOffset[0], obj.yOffset + obj.modelOffset[1], obj.modelOffset[2]]}
        scale={[1, 1, 1]}
        onLoadEnd={async () => {
          if (nodeRef.current && nodeRef.current.getBoundingBoxAsync && obj.yOffset === 0) {
             try {
                const boundingBox = await nodeRef.current.getBoundingBoxAsync();
                if (boundingBox && boundingBox.minY < 0) {
                   const shift = Math.abs(boundingBox.minY);
                   setPlacedObjects((prev: ARPlacedObject[]) => {
                      const next = [...prev];
                      if (next[index]) next[index] = { ...next[index], yOffset: shift };
                      return next;
                   });
                }
             } catch (e) {}
          }
        }}
      />
      <ViroQuad
        position={[0, -0.01, 0]}
        rotation={[-90, 0, 0]}
        width={10}
        height={10}
        arShadowReceiver={true}
        ignoreEventHandling={true}
      />
    </ViroNode>
  );
};

const ARScene = (props: any) => {
  const { 
     placedObjects, setPlacedObjects, 
     planes, setPlanes,
     pendingModelContext, setPendingModelContext
  } = props.sceneNavigator.viroAppProps;
  
  const [rings, setRings] = useState<{ id: number; position: [number, number, number] }[]>([]);
  const lastAnchorUpdate = useRef<number>(0);
  const arSceneRef = useRef<any>(null);
  const lastTapTime = useRef<number>(0);

  const handleSceneClick = (position: number[], source: any) => {
    if (!position || position.length !== 3) return;

    // Only place objects when a model is pending (user selected from catalog)
    if (!pendingModelContext) return;

    // Hit-test: verify tap landed on a horizontal floor plane
    if (arSceneRef && arSceneRef.current) {
      arSceneRef.current.performARHitTestWithPosition(position).then((results: any) => {
        if (!results || results.length === 0) return;

        // Find first horizontal surface hit
        const floorHit = results.find((hit: any) => {
          if (!hit.transform || !hit.transform.rotation) return false;
          const rot = hit.transform.rotation;
          // Floor is mostly flat: X and Z rotation near 0 (< 20 degrees)
          return Math.abs(rot[0]) < 20 && Math.abs(rot[2]) < 20;
        });

        if (!floorHit) return; // Didn't hit a floor — ignore

        const hitPos = floorHit.transform.position || position;

        // Collision check — don't place if gizmo overlaps (30cm min distance)
        const minDist = 0.3;
        const tooClose = placedObjects.some((obj: ARPlacedObject) => {
          const dx = obj.position[0] - hitPos[0];
          const dz = obj.position[2] - hitPos[2];
          return Math.sqrt(dx*dx + dz*dz) < minDist;
        });

        if (tooClose) return;

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
          position: [hitPos[0], hitPos[1], hitPos[2]],
          scale: parsedScale,
          rotation: parsedRotation,
          yOffset: 0,
          modelOffset: parsedOffset,
        };

        setPlacedObjects((prev: any) => [...prev, newObject]);

        // Clear pending so it's single-placement only
        setPendingModelContext(null);

        // Ring confirmation on successful placement
        const id = Date.now();
        setRings((prev: any) => [...prev, { id, position: [hitPos[0], hitPos[1], hitPos[2]] }]);
        setTimeout(() => {
          setRings((prev: any) => prev.filter((r: any) => r.id !== id));
        }, 1000);
      }).catch(() => {});
    }
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

      {/* World mesh from ViroReact handles WIRE visualization now */}


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

      <ViroAmbientLight color="#ffffff" intensity={200} />
      {/* We use a low shadowMapSize (512) and low opacity to naturally blur the shadow via PCF Native filtering, simulating an Ambient Occlusion contact shadow. */}
      <ViroDirectionalLight 
        color="#ffffff" 
        direction={[0, -1, -0.2]} 
        intensity={400} 
        castsShadow={true} shadowMapSize={512}
        shadowNearZ={0.1} shadowFarZ={5} shadowOpacity={0.5}
      />
      
      {placedObjects && placedObjects.map((obj: ARPlacedObject, i: number) => (
        <ARNodeComponent key={obj.id} obj={obj} index={i} setPlacedObjects={setPlacedObjects} arSceneRef={arSceneRef} />
      ))}

      {/* 
        LiDAR mesh visualization removed to prevent React Native bridge crashes.
        Generating thousands of ViroBox/ViroGeometry instances dynamically causes 
        immediate memory exhaustion. We now only fetch the data to prove connection 
        and show the vertex count in the "WIRE Mesh" overlay.
      */}
    </ViroARScene>
  );
};

export default function SandboxARScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  
  // Array of furniture pieces placed in the room
  const [placedObjects, setPlacedObjects] = useState<ARPlacedObject[]>([]);
  
  const [planes, setPlanes] = useState<{[key: string]: any}>({});
  const [pendingModelContext, setPendingModelContext] = useState<(CatalogModel & { localUri: string }) | null>(null);
  
  // Catalog Modal States
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);

  // Fetch catalog from all companies to populate the Sandbox inventory
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
  }, []);

  // When user taps a catalog item, download it and prep it for dropping into the scene
  const handleSelectModelFromCatalog = async (model: CatalogModel) => {
    setDownloadingModelId(model.id);
    try {
      // Securely request signed URL from Supabase
      const { data: signedData, error: signedError } = await supabase
        .storage
        .from('models_secure')
        .createSignedUrl(model.storage_path, 3600);
        
      if (signedError || !signedData?.signedUrl) {
         throw new Error("Could not generate secure file URL");
      }

      // Download model to local filesystem (ViroReact requires local files)
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
      
      setIsCatalogOpen(false);
    } catch (err) {
      console.error("Failed to download model:", err);
      Alert.alert('Download Failed', 'Could not download the 3D model.');
    } finally {
      setDownloadingModelId(null);
    }
  };



  // UI Helpers
  const formatSize = (meta: any) => meta?.file_size ? `${(meta.file_size / 1048576).toFixed(1)} MB` : 'N/A';
  const getThumbnailUrl = (path: string | null) => path ? `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/model_thumbnails/${path}` : null;

  return (
    <View style={styles.container}>
      <ViroARSceneNavigator 
        autofocus={true} 
        // @ts-ignore - Viro types are outdated and expect () => Element, but it passes sceneNavigator props
        initialScene={{ scene: ARScene }} 
        viroAppProps={{ 
           placedObjects, setPlacedObjects, 
           showMesh, planes, setPlanes,
           pendingModelContext, setPendingModelContext,
           meshContour, meshVertices3D, showWire
        }}
        style={styles.viroContainer} 
        occlusionMode="depthBased"
        worldMeshEnabled={showWire}
        worldMeshConfig={{
          stride: 1,
          minConfidence: 0.3,
          maxDepth: 5.0,
          updateIntervalMs: 100,
          debugDrawEnabled: false, // Turned off to remove the small red triangles
        }}
        onWorldMeshUpdated={(stats: any) => {
          if (stats) {
            setMeshStats(stats);
            if (stats.vertexCount > 0) setHasLidar(true);
          }
        }}
      />


      {/* Tap-To-Place Prompt */}
      {pendingModelContext && (
         <View style={styles.promptOverlay}>
            <Text style={styles.promptText}>Tap floor to place {pendingModelContext.title}</Text>
            <TouchableOpacity 
              onPress={() => setPendingModelContext(null)} 
              style={{ marginLeft: 12, backgroundColor: 'rgba(255,60,60,0.8)', borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>
         </View>
      )}

      {/* Top Header */}
      <View style={[styles.headerOverlay, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Multi Models Viewer</Text>
      </View>
      {/* Bottom Floating Appended Action Area */}
      {!isCatalogOpen && (
        <View style={[styles.bottomOverlay, { paddingBottom: insets.bottom + spacing.lg }]}>
           <TouchableOpacity style={styles.addButton} onPress={() => setIsCatalogOpen(true)}>
              <Text style={styles.addButtonIcon}>+</Text>
              <Text style={styles.addButtonText}>ADD ITEM</Text>
           </TouchableOpacity>
        </View>
      )}

      {/* CATALOG MODAL */}
      <Modal visible={isCatalogOpen} animationType="slide" transparent={true}>
         <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
           <View style={styles.modalHeader}>
             <Text style={styles.modalTitle}>Sandbox Catalog</Text>
             <TouchableOpacity onPress={() => setIsCatalogOpen(false)} style={styles.modalCloseButton}>
               <Text style={{ color: '#FFF' }}>Done</Text>
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
                     <View style={styles.catalogAddIcon}><Text style={{color: '#FFF'}}>+</Text></View>
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
  headerSubtitle: { fontFamily: typography.fontFamily.medium, fontSize: 12, color: colors.primary, marginTop: 2 },
  clayButton: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: borderRadius.sm, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  clayButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  clayButtonText: { color: '#FFF', fontFamily: typography.fontFamily.bold, fontSize: 12, letterSpacing: 1 },
  
  promptOverlay: { position: 'absolute', top: 120, left: spacing.md, right: spacing.md, alignItems: 'center', zIndex: 12, pointerEvents: 'none' },
  promptText: { backgroundColor: 'rgba(0,0,0,0.8)', color: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 30, fontFamily: typography.fontFamily.semiBold, ...shadows.md, overflow: 'hidden'},
  
  floatingHud: { position: 'absolute', left: spacing.md, right: spacing.md, backgroundColor: 'rgba(0,0,0,0.7)', padding: spacing.md, borderRadius: borderRadius.sm, zIndex: 10, borderWidth: 1, borderColor: colors.primary },
  hudText: { color: colors.primary, fontFamily: typography.fontFamily.bold, fontSize: 12, marginBottom: 2, textAlign: 'center' },
  
  bottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  addButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 30, ...shadows.md,
  },
  addButtonIcon: { color: '#000', fontSize: 24, marginRight: 8, fontWeight: 'bold' },
  addButtonText: { color: '#000', fontFamily: typography.fontFamily.bold, fontSize: 14, letterSpacing: 1 },

  mapOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10, 20, 30, 0.85)', zIndex: 4, justifyContent: 'center', alignItems: 'center' },
  mapGrid: { width: 300, height: 400, borderWidth: 1, borderColor: 'rgba(0, 255, 255, 0.2)', backgroundColor: 'rgba(0, 255, 255, 0.05)', borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  mapUserDot: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  mapUserDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#00FFFF', shadowColor: '#00FFFF', shadowRadius: 10, shadowOpacity: 0.8 },
  mapUserText: { color: '#00FFFF', fontSize: 10, fontFamily: typography.fontFamily.bold, marginBottom: 4 },
  mapObjectBox: { position: 'absolute', width: 10, height: 10, backgroundColor: colors.primary, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  mapObjectText: { position: 'absolute', top: -16, color: '#FFF', fontSize: 10, fontFamily: typography.fontFamily.bold, width: 80, textAlign: 'center' },
  mapObjectSubtext: { position: 'absolute', top: -30, color: 'rgba(255,255,255,0.7)', fontSize: 9, width: 60, textAlign: 'center' },

  modalContainer: { flex: 1, backgroundColor: colors.surfaceElevated },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { color: '#FFF', fontSize: 18, fontFamily: typography.fontFamily.bold },
  modalCloseButton: { padding: 4 },
  catalogCard: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.sm, alignItems: 'center' },
  catalogImage: { width: 60, height: 60, borderRadius: borderRadius.sm, backgroundColor: 'rgba(255,255,255,0.05)' },
  catalogCardInfo: { flex: 1, marginLeft: spacing.md },
  catalogCardTitle: { color: '#FFF', fontFamily: typography.fontFamily.semiBold, fontSize: 14 },
  catalogCardSize: { color: colors.textTertiary, fontFamily: typography.fontFamily.medium, fontSize: 12, marginTop: 4 },
  catalogAddIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  
  exportButton: { marginTop: spacing.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, backgroundColor: '#2196F3', borderRadius: borderRadius.md, ...shadows.md },
  exportButtonText: { color: '#FFF', fontFamily: typography.fontFamily.bold, letterSpacing: 1 },
});
