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
import { getMeshSlice, isLidarAvailable, getMeshVertices, enableSceneReconstruction, getDebugInfo } from '../../modules/lidar-mesh/src/index';

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
    diffuseColor: "rgba(0, 255, 200, 0.8)"
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
}

interface CatalogModel {
  id: string;
  title: string;
  thumbnail_path: string | null;
  storage_path: string;
  metadata: { file_size?: number } | null;
  model_transform?: {
      scale?: { x: number; y: number; z: number };
  } | null;
}

// Generate the exact geometric floor plan from AR planes and deployed model locations
const generateFloorPlanSVG = (objects: ARPlacedObject[], planes: {[key: string]: any}) => {
   // 1. We determine the bounds of our objects to auto-scale the SVG ViewBox
   let minX = -2, maxX = 2, minZ = -2, maxZ = 2; // Default 4x4 meter padding minimum
   objects.forEach(obj => {
      if (obj.position[0] < minX) minX = obj.position[0];
      if (obj.position[0] > maxX) maxX = obj.position[0];
      if (obj.position[2] < minZ) minZ = obj.position[2];
      if (obj.position[2] > maxZ) maxZ = obj.position[2];
   });
   
   Object.values(planes).forEach(p => {
       if (p.position) {
          if (p.position[0] < minX) minX = p.position[0] - p.width/2;
          if (p.position[0] > maxX) maxX = p.position[0] + p.width/2;
          if (p.position[2] < minZ) minZ = p.position[2] - p.height/2;
          if (p.position[2] > maxZ) maxZ = p.position[2] + p.height/2;
       }
   });

   // Add 1 meter breathing room padding around everything
   minX -= 1; maxX += 1; minZ -= 1; maxZ += 1;
   const width = maxX - minX;
   const height = maxZ - minZ;
   
   // Our physical AR metric coordinates translate directly to SVG ViewBox space 
   // Note: AR Z-axis is negative forward, but SVG Y-axis is positive down. We will just render it flipped, it's a map.
   let svg = `<svg viewBox="${minX} ${minZ} ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
   
   // Background
   svg += `<rect x="${minX}" y="${minZ}" width="${width}" height="${height}" fill="#0A141E" />`;
   
   // 1. Draw walls/planes as transparent bounding rects
   Object.values(planes).forEach(p => {
     if (p.position) {
         // Vertical walls have width/height physically, but map top-down as lines.
         // Horizontal floors map as 2D rectangles.
         const px = p.position[0] - (p.width / 2);
         const pz = p.position[2] - (p.height / 2);
         // Alignment is "Horizontal" or "Vertical". If it's a wall, draw a thick blue line representing it.
         if (p.alignment === "Vertical") {
              const cx = p.position[0];
              const cz = p.position[2];
              // Extremely rough visual representation of a wall line in 2D
              svg += `<line x1="${cx - p.width/2}" y1="${cz}" x2="${cx + p.width/2}" y2="${cz}" stroke="#2196F3" stroke-width="0.1" stroke-linecap="round"/>`;
         } else {
             // Floor / Table rectangle footprint
             svg += `<rect x="${px}" y="${pz}" width="${p.width}" height="${p.height}" fill="rgba(0, 255, 255, 0.05)" stroke="rgba(0, 255, 255, 0.3)" stroke-width="0.05" />`;
         }
     }
   });

   // 2. Draw Distance Lines between every placed object!
   for (let i = 0; i < objects.length; i++) {
     for (let j = i + 1; j < objects.length; j++) {
        const o1 = objects[i];
        const o2 = objects[j];
        
        const dx = o2.position[0] - o1.position[0];
        const dz = o2.position[2] - o1.position[2];
        const dist = Math.sqrt(dx*dx + dz*dz) * 100; // cm distance
        
        let cx = (o1.position[0] + o2.position[0]) / 2;
        let cz = (o1.position[2] + o2.position[2]) / 2;
        
        svg += `<line x1="${o1.position[0]}" y1="${o1.position[2]}" x2="${o2.position[0]}" y2="${o2.position[2]}" stroke="rgba(255, 255, 255, 0.3)" stroke-width="0.02" stroke-dasharray="0.05, 0.05"/>`;
        
        // Draw distance label box
        svg += `<rect x="${cx - 0.2}" y="${cz - 0.1}" width="0.4" height="0.2" fill="rgba(0,0,0,0.6)" rx="0.05" />`;
        svg += `<text x="${cx}" y="${cz + 0.04}" font-family="sans-serif" font-size="0.1" fill="#FFF" text-anchor="middle">${dist.toFixed(0)}cm</text>`;
     }
   }
   
   // 3. Draw Object Locations
   objects.forEach(obj => {
      svg += `<circle cx="${obj.position[0]}" cy="${obj.position[2]}" r="0.1" fill="${colors.primary}" stroke="#000" stroke-width="0.02"/>`;
      svg += `<text x="${obj.position[0]}" y="${obj.position[2] - 0.15}" font-family="sans-serif" font-size="0.15" fill="#FFF" font-weight="bold" text-anchor="middle">${obj.title}</text>`;
   });

   // 4. Draw User (0,0) Origin
   svg += `<circle cx="0" cy="0" r="0.15" fill="#00FFFF" opacity="0.5"/>`;
   svg += `<circle cx="0" cy="0" r="0.05" fill="#FFF" />`;
   svg += `<text x="0" y="0.25" font-family="sans-serif" font-size="0.12" fill="#00FFFF" text-anchor="middle">YOU</text>`;

   svg += '</svg>';
   return svg;
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
        position={[0, obj.yOffset, 0]}
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
     showMesh, planes, setPlanes,
     pendingModelContext, setPendingModelContext,
     meshContour, meshVertices3D, showWire
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

        const newObject: ARPlacedObject = {
          id: Math.random().toString(36).substring(7),
          title: pendingModelContext.title || 'Model',
          localUri: pendingModelContext.localUri,
          position: [hitPos[0], hitPos[1], hitPos[2]],
          scale: parsedScale,
          rotation: parsedRotation,
          yOffset: 0,
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
      {showMesh && Object.values(planes).map((p: any) => {
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

      {/* LiDAR mesh — 3D point cloud */}
      {showWire && meshVertices3D && meshVertices3D.length > 0 && meshVertices3D.map(([x, y, z]: [number, number, number], i: number) => (
        <ViroBox key={`wire-${i}`}
          position={[x, y, z]}
          width={0.02} height={0.02} length={0.02}
          materials={["wireMaterial"]}
        />
      ))}
      {/* Fallback: meshContour 2D at Y=1m */}
      {showWire && (!meshVertices3D || meshVertices3D.length === 0) && meshContour && meshContour.length > 0 && meshContour.map(([x, z]: [number, number], i: number) => (
        <ViroBox key={`wire2d-${i}`}
          position={[x, 1.0, z]}
          width={0.02} height={0.02} length={0.02}
          materials={["wireMaterial"]}
        />
      ))}
    </ViroARScene>
  );
};

export default function SandboxARScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  
  // Array of furniture pieces placed in the room
  const [placedObjects, setPlacedObjects] = useState<ARPlacedObject[]>([]);
  
  // AR View States
  const [showMap, setShowMap] = useState(false);
  const [showMesh, setShowMesh] = useState(true);
  const [showWire, setShowWire] = useState(false);
  const [cutHeight, setCutHeight] = useState(1.0);
  
  // LiDAR mesh contour points [x, z]
  const [meshContour, setMeshContour] = useState<[number, number][]>([]);
  const [meshVertices3D, setMeshVertices3D] = useState<[number, number, number][]>([]);
  const [hasLidar, setHasLidar] = useState(false);

  // Poll for 3D mesh vertices when WIRE is active
  useEffect(() => {
    if (!showWire) return;
    // Force-enable LiDAR scene reconstruction
    enableSceneReconstruction().then(ok => {
      if (ok) setHasLidar(true);
    });
    let alive = true;
    const poll = async () => {
      while (alive) {
        try {
          const verts = await getMeshVertices(2000);
          if (alive) setMeshVertices3D(verts as [number, number, number][]);
        } catch {}
        await new Promise(r => setTimeout(r, 2000));
      }
    };
    poll();
    return () => { alive = false; };
  }, [showWire]);
  
  // Hoisted state for Wall and Floor detection from ARKit
  const [planes, setPlanes] = useState<{[key: string]: any}>({});
  const [pendingModelContext, setPendingModelContext] = useState<(CatalogModel & { localUri: string }) | null>(null);
  
  // Catalog Modal States
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [meshStats, setMeshStats] = useState<{vertexCount: number; triangleCount: number; averageConfidence: number} | null>(null);

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
    // Try to detect LiDAR - check API support AND try enabling directly
    const apiCheck = isLidarAvailable();
    setHasLidar(apiCheck);
    // Also try enabling scene reconstruction directly — some devices report false but work
    enableSceneReconstruction().then(ok => {
      if (ok) setHasLidar(true);
    });
  }, []);

  // Poll LiDAR mesh when map is visible
  useEffect(() => {
    if (!showMap || !hasLidar) return;
    const interval = setInterval(async () => {
      try {
        const points = await getMeshSlice(cutHeight);
        if (points.length > 0) {
          setMeshContour(points as [number, number][]);
        }
      } catch (e) {
        // LiDAR not ready yet
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [showMap, hasLidar, cutHeight]);

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
          debugDrawEnabled: true,
        }}
        onWorldMeshUpdated={(stats: any) => {
          if (stats) {
            setMeshStats(stats);
            if (stats.vertexCount > 0) setHasLidar(true);
          }
        }}
      />

      {/* 2D FLOOR PLAN — Wall segments + floor fill */}
      {showMap && (() => {
        // Separate wall and floor planes
        const wallPlanes = Object.values(planes).filter((p: any) =>
          p.position && p.alignment === 'Vertical'
        );
        const floorPlanes = Object.values(planes).filter((p: any) =>
          p.position && p.alignment === 'Horizontal' && p.position[1] < 0.3
        );
        
        // Compute wall segment endpoints from rotation + width
        const wallSegments: { x1: number; z1: number; x2: number; z2: number; w: number }[] = [];
        wallPlanes.forEach((p: any) => {
          const cx = p.position[0], cz = p.position[2];
          const halfW = (p.width || 1) / 2;
          // Wall rotation around Y axis — use p.rotation[1] (yaw in degrees)
          const yawDeg = p.rotation ? p.rotation[1] : 0;
          const yawRad = (yawDeg * Math.PI) / 180;
          // Endpoints perpendicular to wall normal
          const dx = Math.cos(yawRad) * halfW;
          const dz = Math.sin(yawRad) * halfW;
          wallSegments.push({ x1: cx - dx, z1: cz - dz, x2: cx + dx, z2: cz + dz, w: p.width || 1 });
        });
        
        // Calculate bounds from wall endpoints + floor planes + objects
        let minX = -2, maxX = 2, minZ = -2, maxZ = 2;
        wallSegments.forEach(s => {
          minX = Math.min(minX, s.x1, s.x2);
          maxX = Math.max(maxX, s.x1, s.x2);
          minZ = Math.min(minZ, s.z1, s.z2);
          maxZ = Math.max(maxZ, s.z1, s.z2);
        });
        floorPlanes.forEach((p: any) => {
          const hw = (p.width || 1) / 2, hh = (p.height || 1) / 2;
          minX = Math.min(minX, p.position[0] - hw);
          maxX = Math.max(maxX, p.position[0] + hw);
          minZ = Math.min(minZ, p.position[2] - hh);
          maxZ = Math.max(maxZ, p.position[2] + hh);
        });
        placedObjects.forEach(obj => {
          minX = Math.min(minX, obj.position[0] - 0.5);
          maxX = Math.max(maxX, obj.position[0] + 0.5);
          minZ = Math.min(minZ, obj.position[2] - 0.5);
          maxZ = Math.max(maxZ, obj.position[2] + 0.5);
        });
        
        minX -= 0.5; maxX += 0.5; minZ -= 0.5; maxZ += 0.5;
        const worldW = maxX - minX;
        const worldH = maxZ - minZ;
        const mapW = 300;
        const mapH = 380;
        const scale = Math.min(mapW / worldW, mapH / worldH);
        const oX = (mapW - worldW * scale) / 2;
        const oY = (mapH - worldH * scale) / 2;
        
        const toX = (x: number) => oX + (x - minX) * scale;
        const toY = (z: number) => oY + (z - minZ) * scale;
        const toW = (w: number) => w * scale;
        const snap = (v: number) => Math.round(v / 2) * 2;
        const gridStep = 1;
        
        // Stats
        let estimatedArea = 0;
        floorPlanes.forEach((p: any) => {
          estimatedArea += (p.width || 1) * (p.height || 1);
        });
        let totalPerimeter = 0;
        wallSegments.forEach(s => { totalPerimeter += s.w; });
        const wallCount = wallSegments.length;
        const dataSource = meshContour.length > 0 ? 'LIDAR' : 'PLANES';

        return (
        <View style={styles.mapOverlay} pointerEvents="box-none">
           {/* Stats bar */}
           <View style={{ flexDirection: 'row', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
             <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 }}>
               <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: '700', letterSpacing: 1 }}>AREA</Text>
               <Text style={{ color: '#0FF', fontSize: 14, fontWeight: '700' }}>{estimatedArea.toFixed(1)} m²</Text>
             </View>
             <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 }}>
               <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: '700', letterSpacing: 1 }}>PERIMETER</Text>
               <Text style={{ color: '#00e5e5', fontSize: 14, fontWeight: '700' }}>{totalPerimeter.toFixed(1)} m</Text>
             </View>
             <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 }}>
               <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: '700', letterSpacing: 1 }}>WALLS</Text>
               <Text style={{ color: '#FF6B00', fontSize: 14, fontWeight: '700' }}>{wallCount}</Text>
             </View>
           </View>

           {/* Map + Height Slider row */}
           <View style={{ flexDirection: 'row', gap: 8 }}>

           <ScrollView 
             style={{ width: mapW, height: mapH, backgroundColor: '#0a1015', borderRadius: 12, overflow: 'hidden' }}
             contentContainerStyle={{ width: mapW, height: mapH }}
             maximumZoomScale={5}
             minimumZoomScale={1}
             bouncesZoom={true}
             showsHorizontalScrollIndicator={false}
             showsVerticalScrollIndicator={false}
           >
              {/* Subtle grid */}
              {Array.from({ length: Math.ceil(worldW / gridStep) + 1 }, (_, i) => {
                const px = toX(Math.ceil(minX) + i * gridStep);
                if (px < 0 || px > mapW) return null;
                return <View key={`gx-${i}`} style={{ position: 'absolute', left: snap(px), top: 0, width: 1, height: mapH, backgroundColor: 'rgba(0,255,255,0.03)' }} />;
              })}
              {Array.from({ length: Math.ceil(worldH / gridStep) + 1 }, (_, i) => {
                const py = toY(Math.ceil(minZ) + i * gridStep);
                if (py < 0 || py > mapH) return null;
                return <View key={`gy-${i}`} style={{ position: 'absolute', left: 0, top: snap(py), width: mapW, height: 1, backgroundColor: 'rgba(0,255,255,0.03)' }} />;
              })}

              {/* Floor plane rectangles — teal fill */}
              {floorPlanes.map((p: any, i: number) => {
                const pw = toW(p.width || 1);
                const ph = toW(p.height || 1);
                return (
                  <View key={`floor-${i}`} style={{
                    position: 'absolute',
                    left: snap(toX(p.position[0]) - pw / 2),
                    top: snap(toY(p.position[2]) - ph / 2),
                    width: Math.max(pw, 2), height: Math.max(ph, 2),
                    backgroundColor: 'rgba(0, 180, 180, 0.15)',
                  }} />
                );
              })}

              {/* Wall segments — thick pixel lines */}
              {wallSegments.map((seg, si) => {
                const pixels: React.ReactNode[] = [];
                const ax = snap(toX(seg.x1)), ay = snap(toY(seg.z1));
                const bx = snap(toX(seg.x2)), by = snap(toY(seg.z2));
                const dx = bx - ax, dy = by - ay;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const steps = Math.max(1, Math.floor(dist / 3));
                for (let s = 0; s <= steps; s++) {
                  const t = s / steps;
                  const px = snap(ax + dx * t);
                  const py = snap(ay + dy * t);
                  pixels.push(
                    <View key={`w-${si}-${s}`} style={{
                      position: 'absolute', left: px - 3, top: py - 3,
                      width: 6, height: 6,
                      backgroundColor: '#00e5e5',
                    }} />
                  );
                }
                return pixels;
              })}

              {/* LiDAR mesh contour dots (when available) */}
              {meshContour.length > 0 && meshContour.map(([x, z], i) => (
                <View key={`li-${i}`} style={{
                  position: 'absolute',
                  left: snap(toX(x)) - 2, top: snap(toY(z)) - 2,
                  width: 4, height: 4,
                  backgroundColor: 'rgba(0, 255, 200, 0.6)',
                }} />
              ))}

              {/* Placed objects */}
              {placedObjects.map(obj => (
                <View key={obj.id} style={{
                  position: 'absolute',
                  left: snap(toX(obj.position[0])) - 8,
                  top: snap(toY(obj.position[2])) - 8,
                  width: 16, height: 16, borderRadius: 8,
                  backgroundColor: 'rgba(255, 200, 0, 0.9)',
                  borderWidth: 2, borderColor: '#FFF',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ position: 'absolute', top: -14, color: '#FFF', fontSize: 8, fontWeight: '700', width: 60, textAlign: 'center' }} numberOfLines={1}>{obj.title}</Text>
                </View>
              ))}

              {/* User position */}
              <View style={{
                position: 'absolute',
                left: snap(toX(0)) - 10, top: snap(toY(0)) - 10,
                width: 20, height: 20, borderRadius: 10,
                backgroundColor: 'rgba(255,255,255,0.15)',
                borderWidth: 2, borderColor: '#FFF',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF' }} />
                <Text style={{ position: 'absolute', bottom: -14, color: 'rgba(255,255,255,0.7)', fontSize: 7, fontWeight: '600' }}>YOU</Text>
              </View>

              {/* Scale bar */}
              <View style={{ position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: toW(1), height: 2, backgroundColor: 'rgba(255,255,255,0.5)' }} />
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 7, marginLeft: 3 }}>1m</Text>
              </View>
           </ScrollView>

           {/* Vertical cut height slider */}
           <View style={{ height: mapH, width: 32, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 }}>
             <TouchableOpacity onPress={() => setCutHeight(h => Math.min(3, h + 0.1))} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
               <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>+</Text>
             </TouchableOpacity>
             <View style={{ flex: 1, width: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, marginVertical: 8, justifyContent: 'flex-end' }}>
               <View style={{ width: 4, height: `${(cutHeight / 3) * 100}%` as any, backgroundColor: '#FF6B00', borderRadius: 2 }} />
             </View>
             <Text style={{ color: '#FF6B00', fontSize: 9, fontWeight: '700' }}>{cutHeight.toFixed(1)}m</Text>
             <TouchableOpacity onPress={() => setCutHeight(h => Math.max(0, h - 0.1))} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
               <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>−</Text>
             </TouchableOpacity>
           </View>
           </View>
           
           <TouchableOpacity 
              style={styles.exportButton} 
              onPress={() => {
                 try {
                    const svgString = generateFloorPlanSVG(placedObjects, planes);
                    Alert.alert("Floor Plan", `${placedObjects.length} objects placed\nWalls: ${Object.values(planes).filter((p: any) => p.alignment === 'Vertical').length}`);
                 } catch (e) {
                    Alert.alert("Export Failed", "Could not generate floor plan data.");
                 }
              }}
            >
               <Text style={styles.exportButtonText}>EXPORT</Text>
            </TouchableOpacity>
        </View>
        );
      })()}

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
        <Text style={styles.headerTitle} numberOfLines={1}>Room Sandbox</Text>
        
        <TouchableOpacity style={[styles.clayButton, showMesh && styles.clayButtonActive]} onPress={() => setShowMesh(!showMesh)}>
          <Text style={styles.clayButtonText}>MESH</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.clayButton, showWire && styles.clayButtonActive]} onPress={() => {
          const newState = !showWire;
          setShowWire(newState);
          if (newState) {
            const planeCount = Object.keys(planes).length;
            const floorCount = Object.values(planes).filter((p: any) => p.alignment === 'Horizontal').length;
            const wallCount = Object.values(planes).filter((p: any) => p.alignment === 'Vertical').length;
            const ms = meshStats;
            Alert.alert("WIRE Mesh", [
              `Vertices: ${ms?.vertexCount ?? 0}`,
              `Triangles: ${ms?.triangleCount ?? 0}`,
              `Confidence: ${ms ? (ms.averageConfidence * 100).toFixed(0) + '%' : 'N/A'}`,
              `Planes: ${planeCount} (${floorCount}F/${wallCount}W)`,
            ].join('\n'));
          }
        }}>
          <Text style={styles.clayButtonText}>WIRE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.clayButton, showMap && styles.clayButtonActive]} onPress={() => setShowMap(!showMap)}>
          <Text style={styles.clayButtonText}>MAP</Text>
        </TouchableOpacity>
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
