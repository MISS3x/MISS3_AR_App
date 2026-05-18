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
  ViroPolyline,
  ViroText
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
  scaleLocked?: boolean;
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
  updated_at?: string;
}


const ARNodeComponent = ({ obj, index, setPlacedObjects, arSceneRef, selectedObjectId, setSelectedObjectId, activeTransformMode, setActiveTransformMode, isXRayMode }: { obj: ARPlacedObject, index: number, setPlacedObjects: any, arSceneRef?: any, selectedObjectId?: string | null, setSelectedObjectId?: any, activeTransformMode?: 'move' | 'rotate' | null, setActiveTransformMode?: any, isXRayMode?: boolean }) => {
  const nodeRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const currentScale = useRef<[number, number, number]>(obj.scale);
  const currentRotation = useRef<[number, number, number]>(obj.rotation);
  const gestureBaseScale = useRef<[number, number, number]>(obj.scale);
  const gestureBaseRotation = useRef<[number, number, number]>(obj.rotation);

  useEffect(() => {
    if (Math.abs(currentRotation.current[1] - obj.rotation[1]) > 0.01) {
      currentRotation.current = obj.rotation;
      if (nodeRef.current) nodeRef.current.setNativeProps({ rotation: obj.rotation });
    }
  }, [obj.rotation]);

  const onPinch = (pinchState: number, scaleFactor: number, source: any) => {
    if (obj.scaleLocked !== false) return; // Locked by default
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
    // Only update global state on release (source === 3) to prevent native bridge feedback loops (shooting away)
    if (source === 3) {
      setPlacedObjects((prev: ARPlacedObject[]) => {
        return prev.map(p =>
          p.id === obj.id ? { ...p, position: [dragToPos[0], dragToPos[1], dragToPos[2]] as [number, number, number] } : p
        );
      });
    }

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
      key={`node_${obj.id}`}
      ref={nodeRef}
      scale={currentScale.current}
      rotation={currentRotation.current}
      position={obj.position}
      dragType="FixedToPlane"
      dragPlane={{ planePoint: [0, obj.position[1], 0], planeNormal: [0, 1, 0], maxDistance: 20 }}
      onDrag={selectedObjectId === obj.id && activeTransformMode === 'move' ? handleDrag : undefined}
      onPinch={onPinch}
      onRotate={onRotate}
      onClick={() => {
        if (setSelectedObjectId) setSelectedObjectId(obj.id);
        if (setActiveTransformMode) setActiveTransformMode('move');
      }}
    >
      <Viro3DObject
        key={`mesh_${obj.id}`}
        ref={modelRef}
        source={{ uri: obj.localUri }}
        type={(() => {
          const ext = obj.localUri.split('.').pop()?.toUpperCase() || 'GLB';
          return ext === 'GLTF' ? 'GLTF' : ext === 'OBJ' ? 'OBJ' : ext === 'VRX' ? 'VRX' : 'GLB';
        })()}
        materials={isXRayMode ? ["xrayMaterial"] : undefined}
        position={[obj.modelOffset[0], obj.yOffset + obj.modelOffset[1], obj.modelOffset[2]]}
        scale={[1, 1, 1]}
        onLoadEnd={async () => {
          // Calculate bounding box to offset pivot → bottom sits on floor
          if (modelRef.current && modelRef.current.getBoundingBoxAsync && obj.yOffset === 0) {
             try {
                const result = await modelRef.current.getBoundingBoxAsync();
                if (result && result.boundingBox && typeof result.boundingBox.minY === 'number') {
                   let shift = -result.boundingBox.minY + 0.01; 
                   if (isNaN(shift) || !isFinite(shift)) {
                     shift = 0;
                   }
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
     crystalUri,
     selectedObjectId, setSelectedObjectId,
     activeTransformMode, setActiveTransformMode,
     isXRayMode,
     isTapeMode,
     tapePoints, setTapePoints
  } = props.sceneNavigator.viroAppProps;
  
  const [rings, setRings] = useState<{ id: number; position: [number, number, number] }[]>([]);
  const lastAnchorUpdate = useRef<number>(0);
  const arSceneRef = useRef<any>(null);

  // Track lowest horizontal plane Y as best floor estimate
  const floorY = useRef<number | null>(null);

  // Continuous floor hit-test for ghost preview
  const lastGhostUpdate = useRef<number>(0);
  
  const handleCameraTransform = () => {
    if (!arSceneRef.current) return;
    
    const now = Date.now();
    if (now - lastGhostUpdate.current < 100) return; // 10fps for ghost
    lastGhostUpdate.current = now;
    
    arSceneRef.current.getCameraOrientationAsync().then((cam: any) => {
      if (!cam || !cam.position || !cam.forward) return;

      // Project camera forward onto horizontal floor plane
      // If floorY is known, calculate intersection of camera ray with Y=floorY
      const fy = floorY.current;
      if (fy !== null && cam.forward[1] !== 0) {
        // t = (floorY - camY) / forwardY
        const t = (fy - cam.position[1]) / cam.forward[1];
        if (t > 0.3 && t < 10) {
          // Valid forward intersection with floor
          const gx = cam.position[0] + cam.forward[0] * t;
          const gz = cam.position[2] + cam.forward[2] * t;
          setGhostPosition([gx, fy, gz]);
          return;
        }
      }

      // Fallback: hit test with a 3m forward ray
      const rayEnd = [
        cam.position[0] + cam.forward[0] * 3,
        cam.position[1] + cam.forward[1] * 3,
        cam.position[2] + cam.forward[2] * 3
      ];
      arSceneRef.current.performARHitTestWithPosition(rayEnd).then((results: any) => {
        if (results && results.length > 0) {
          const floorHit = results.find((hit: any) => {
            if (!hit.transform || !hit.transform.rotation) return false;
            const rot = hit.transform.rotation;
            return Math.abs(rot[0]) < 20 && Math.abs(rot[2]) < 20;
          });
          
          if (floorHit) {
            const pos = floorHit.transform.position || rayEnd;
            // Update floorY from successful hit
            if (floorY.current === null || pos[1] < floorY.current) {
              floorY.current = pos[1];
            }
            setGhostPosition([pos[0], pos[1], pos[2]]);
          } else {
             // Fallback: project to known floor or 1.5m below camera
             const fallbackY = floorY.current !== null ? floorY.current : cam.position[1] - 1.5;
             setGhostPosition([rayEnd[0], fallbackY, rayEnd[2]]);
          }
        }
      }).catch(() => {});
    }).catch(() => {});
  };

  const handleSceneClick = (position: number[], source: any) => {
    if (isTapeMode) {
      if (!ghostPosition) return;
      setTapePoints((prev: any) => [...prev, ghostPosition]);
      return;
    }

    if (pendingModelContext && onPlaceGhost) {
      onPlaceGhost();
      return;
    }
    
    // We removed isPointRotateMode handling here, as clicking the scene doesn't need to rotate anymore
    if (selectedObjectId && activeTransformMode !== 'move') {
       setSelectedObjectId(null);
    }
  };

  const updateFloorYFromPlane = (anchor: any) => {
    // Track horizontal planes to find real floor Y
    if (anchor.type === "plane" && anchor.alignment === 0) {
      // alignment 0 = horizontal
      const py = anchor.position?.[1] ?? anchor.center?.[1];
      if (typeof py === 'number') {
        if (floorY.current === null || py < floorY.current) {
          floorY.current = py;
        }
      }
    }
  };

  const onAnchorFound = (anchor: any) => {
    if (anchor.type === "plane") {
      setPlanes((prev: any) => ({ ...prev, [anchor.anchorId]: anchor }));
      updateFloorYFromPlane(anchor);
    }
  };
  
  const onAnchorUpdated = (anchor: any) => {
    if (anchor.type === "plane") {
      const now = Date.now();
      if (now - lastAnchorUpdate.current > 500) {
         setPlanes((prev: any) => ({ ...prev, [anchor.anchorId]: anchor }));
         lastAnchorUpdate.current = now;
      }
      updateFloorYFromPlane(anchor);
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

      {/* Ghost preview — translucent model following floor reticle */}
      {pendingModelContext && ghostPosition && (
        <ViroNode position={ghostPosition} opacity={0.65}>
          {/* Apply scale to an intermediate node, just like placed objects */}
          <ViroNode
            scale={[
              pendingModelContext.model_transform?.scale?.x || 1,
              pendingModelContext.model_transform?.scale?.y || 1,
              pendingModelContext.model_transform?.scale?.z || 1
            ]}
            rotation={[
              pendingModelContext.model_transform?.rotation?.x || 0,
              pendingModelContext.model_transform?.rotation?.y || 0,
              pendingModelContext.model_transform?.rotation?.z || 0
            ]}
          >
            <Viro3DObject
              source={{ uri: pendingModelContext.localUri }}
              resources={[]}
              type={(() => {
                const ext = pendingModelContext.localUri.split('.').pop()?.toUpperCase() || 'GLB';
                return ext === 'GLTF' ? 'GLTF' : ext === 'OBJ' ? 'OBJ' : ext === 'VRX' ? 'VRX' : 'GLB';
              })()}
              materials={isXRayMode ? ["xrayMaterial"] : undefined}
              position={[
                pendingModelContext.model_transform?.modelOffset?.x || 0,
                pendingModelContext.model_transform?.modelOffset?.y || 0,
                pendingModelContext.model_transform?.modelOffset?.z || 0
              ]}
              scale={[1, 1, 1]}
              onError={(e) => {
                const errorMessage = e && e.nativeEvent ? e.nativeEvent.error : String(e);
                console.warn("Ghost Model Render Error:", errorMessage);
                Alert.alert("Viro Error", "Failed to load model: " + errorMessage);
              }}
            />
          </ViroNode>
        </ViroNode>
      )}

      {/* Demo ghost — local Crystal primitive when no model selected but reticle active */}
      {!pendingModelContext && ghostPosition && (
        <ViroNode position={ghostPosition} opacity={0.65}>
          <Viro3DObject
            source={require('../../assets/models/crystal_pbr.glb')}
            position={[0, 0, 0]}
            scale={[1, 1, 1]}
            type="GLB"
            materials={["xrayMaterial"]}
          />
        </ViroNode>
      )}
      
      {/* Placed Objects */}
      {placedObjects.map((obj: ARPlacedObject, index: number) => (
        <ARNodeComponent 
          key={obj.id} 
          obj={obj} 
          index={index} 
          setPlacedObjects={setPlacedObjects} 
          arSceneRef={arSceneRef}
          selectedObjectId={selectedObjectId}
          setSelectedObjectId={setSelectedObjectId}
          activeTransformMode={activeTransformMode}
          setActiveTransformMode={setActiveTransformMode}
          isXRayMode={isXRayMode}
        />
      ))}

      {/* Tape Measure Overlay */}
      {tapePoints.length > 0 && (
         <>
           <ViroPolyline
             position={[0,0,0]}
             points={isTapeMode && ghostPosition ? [...tapePoints, ghostPosition] : tapePoints}
             thickness={0.015}
             materials={["reticleDotMaterial"]}
           />
           
           {/* Placed dimension texts */}
           {tapePoints.map((pt, i) => {
             if (i === 0) return null;
             const prevPt = tapePoints[i - 1];
             const dist = Math.sqrt(Math.pow(pt[0] - prevPt[0], 2) + Math.pow(pt[1] - prevPt[1], 2) + Math.pow(pt[2] - prevPt[2], 2));
             return (
               <ViroText
                 key={`tape-text-${i}`}
                 position={[
                   (prevPt[0] + pt[0]) / 2,
                   (prevPt[1] + pt[1]) / 2 + 0.1,
                   (prevPt[2] + pt[2]) / 2
                 ]}
                 text={`${dist.toFixed(2)} m`}
                 scale={[0.2, 0.2, 0.2]}
                 style={{ fontFamily: 'Arial', fontSize: 24, color: '#FFF' }}
                 transformBehaviors={["billboard"]}
               />
             );
           })}

           {/* Live dimension text */}
           {isTapeMode && ghostPosition && (
              <ViroText
                 position={[
                   (tapePoints[tapePoints.length - 1][0] + ghostPosition[0]) / 2,
                   (tapePoints[tapePoints.length - 1][1] + ghostPosition[1]) / 2 + 0.1,
                   (tapePoints[tapePoints.length - 1][2] + ghostPosition[2]) / 2
                 ]}
                 text={`${Math.sqrt(Math.pow(ghostPosition[0] - tapePoints[tapePoints.length - 1][0], 2) + Math.pow(ghostPosition[1] - tapePoints[tapePoints.length - 1][1], 2) + Math.pow(ghostPosition[2] - tapePoints[tapePoints.length - 1][2], 2)).toFixed(2)} m`}
                 scale={[0.2, 0.2, 0.2]}
                 style={{ fontFamily: 'Arial', fontSize: 24, color: '#FFF' }}
                 transformBehaviors={["billboard"]}
              />
           )}
         </>
      )}
    </ViroARScene>
  );
};

const PureJSSlider = ({ value, minimumValue, maximumValue, onValueChange, style, minimumTrackTintColor, maximumTrackTintColor }: any) => {
  const [width, setWidth] = useState(0);
  const [internalValue, setInternalValue] = useState(value);
  const lastUpdate = useRef(0);

  useEffect(() => {
    setInternalValue(value);
  }, [value]);

  const handleMove = (x: number, isRelease: boolean = false) => {
    if (width === 0) return;
    const percentage = Math.max(0, Math.min(1, x / width));
    const val = minimumValue + percentage * (maximumValue - minimumValue);
    setInternalValue(val);
    
    // Throttle the parent update to avoid bridging crash (max 15fps)
    const now = Date.now();
    if (isRelease || now - lastUpdate.current > 66) {
       onValueChange(val);
       lastUpdate.current = now;
    }
  };

  return (
    <View 
      style={[style, { justifyContent: 'center' }]} 
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(evt) => handleMove(evt.nativeEvent.locationX)}
      onResponderMove={(evt) => handleMove(evt.nativeEvent.locationX)}
      onResponderRelease={(evt) => handleMove(evt.nativeEvent.locationX, true)}
    >
      <View style={{ height: 4, backgroundColor: maximumTrackTintColor || '#555', borderRadius: 2 }} pointerEvents="none" />
      <View style={{ 
        position: 'absolute', 
        left: Math.max(0, width * ((internalValue - minimumValue) / (maximumValue - minimumValue)) - 10), 
        width: 20, 
        height: 20, 
        borderRadius: 10, 
        backgroundColor: minimumTrackTintColor || '#00E6FF' 
      }} pointerEvents="none" />
    </View>
  );
};

export default function SandboxARScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  
  const [placedObjects, setPlacedObjects] = useState<ARPlacedObject[]>([]);
  const [planes, setPlanes] = useState<{[key: string]: any}>({});
  const [pendingModelContext, setPendingModelContext] = useState<(CatalogModel & { localUri: string }) | null>(null);
  const [ghostPosition, setGhostPosition] = useState<[number, number, number] | null>(null);
  
  // Selection & UI state
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [activeTransformMode, setActiveTransformMode] = useState<'move' | 'rotate' | null>('rotate');
  const [isObjectListOpen, setIsObjectListOpen] = useState(false);
  const [isXRayMode, setIsXRayMode] = useState(false);
  
  // Tape measure state
  const [isTapeMode, setIsTapeMode] = useState(false);
  const [tapePoints, setTapePoints] = useState<number[][]>([]);
  
  const selectedObject = placedObjects.find(o => o.id === selectedObjectId);

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
        .select('id, title, thumbnail_path, storage_path, metadata, model_transform, updated_at')
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
    // Legacy async load removed — we use require() directly in the Viro component now.
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

      const timestamp = model.updated_at ? new Date(model.updated_at).getTime() : Date.now();
      const fileName = `${model.id}_${timestamp}.glb`;
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
         localUri: finalUri
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

    const instanceId = Math.random().toString(36).substring(7);
    const newObject: ARPlacedObject = {
      id: instanceId,
      title: pendingModelContext.title || 'Model',
      localUri: pendingModelContext.localUri,
      position: [frozenX, frozenY, frozenZ] as [number, number, number],
      scale: parsedScale,
      rotation: parsedRotation,
      yOffset: 0,
      modelOffset: parsedOffset,
      scaleLocked: true, // locked by default
    };

    // Add to placed objects FIRST, then reset ghost
    setPlacedObjects(prev => {
      if (prev.filter(o => o.id !== 'dummy-bugfix').length === 0) {
        // MACRO FIX: The very first object in Viro sometimes disappears due to a native initialization glitch.
        // We place a hidden dummy object far underground first, and the real one after it.
        const dummyObject = { ...newObject, id: 'dummy-bugfix', title: 'dummy-bugfix', position: [0, -100, 0] as [number, number, number] };
        
        // Remove dummy shortly after
        setTimeout(() => {
          setPlacedObjects(curr => curr.filter(o => o.id !== 'dummy-bugfix'));
        }, 800);

        return [...prev, dummyObject, newObject];
      }
      return [...prev, newObject];
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
           selectedObjectId, setSelectedObjectId,
           activeTransformMode, setActiveTransformMode,
           isXRayMode,
           isTapeMode,
           tapePoints, setTapePoints
        }}
        style={styles.viroContainer} 
        occlusionMode={isXRayMode ? undefined : "depthBased"}
      />

      {/* Crosshair removed — big 50cm reticle circle in AR scene is always visible */}

      {/* Top Header */}
      <View style={[styles.headerOverlay, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Multi Models Viewer</Text>
        <TouchableOpacity onPress={() => {
          if (!isTapeMode) {
            setTapePoints([]); // Clear points when starting a NEW measurement
          }
          setIsTapeMode(!isTapeMode);
        }} style={[styles.backButton, isTapeMode && { backgroundColor: 'rgba(0,230,255,0.3)' }]}>
          <Text style={{ fontSize: 18 }}>📏</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setIsObjectListOpen(!isObjectListOpen)} style={[styles.backButton, isObjectListOpen && { backgroundColor: 'rgba(0,230,255,0.3)' }]}>
          <Text style={{ fontSize: 18 }}>👁️</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setIsXRayMode(!isXRayMode)} style={[styles.backButton, isXRayMode && { backgroundColor: 'rgba(0,230,255,0.3)' }]}>
          <Text style={{ fontSize: 18 }}>{isXRayMode ? '🩻' : '🧱'}</Text>
        </TouchableOpacity>
      </View>
      
      {pendingModelContext && (
        <View style={styles.ghostIndicator}>
          <Text style={styles.ghostIndicatorText}>👻 {pendingModelContext.title}</Text>
        </View>
      )}

      {/* Right Side Vertical Tools for Selected Object */}
      {selectedObjectId && selectedObject && !isObjectListOpen && (
        <View style={styles.sideToolbar}>
          <TouchableOpacity 
            style={[styles.sideToolButton, activeTransformMode === 'move' ? styles.sideToolActive : null]}
            onPress={() => setActiveTransformMode('move')}
          >
            <Text style={styles.sideToolIcon}>↕️</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.sideToolButton, activeTransformMode === 'rotate' ? styles.sideToolActive : null]}
            onPress={() => setActiveTransformMode('rotate')}
          >
            <Text style={styles.sideToolIcon}>🔄</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom Action Area */}
      {!isCatalogOpen && !isObjectListOpen && (
        <View style={[styles.bottomOverlay, { paddingBottom: insets.bottom + spacing.lg }]}>
          {selectedObjectId && selectedObject ? (
             <View style={styles.selectedPanel}>
               <View style={styles.selectedHeader}>
                 <Text style={styles.selectedTitle} numberOfLines={1}>{selectedObject.title}</Text>
                 <TouchableOpacity onPress={() => { setSelectedObjectId(null); }}>
                   <Text style={{color: '#FFF', fontSize: 20}}>✕</Text>
                 </TouchableOpacity>
               </View>

               {activeTransformMode === 'rotate' && (
                 <>
                   <Text style={{color: '#AAA', marginBottom: 15}}>Rotation ({Math.round(selectedObject.rotation[1])}°)</Text>
                   <PureJSSlider
                     style={{width: '100%', height: 40}}
                     minimumValue={0}
                     maximumValue={360}
                     value={((selectedObject.rotation[1] % 360) + 360) % 360}
                     onValueChange={(val: number) => {
                       setPlacedObjects(prev => prev.map(o => o.id === selectedObjectId ? {...o, rotation: [o.rotation[0], val, o.rotation[2]]} : o));
                     }}
                     minimumTrackTintColor={colors.primary}
                     maximumTrackTintColor="#555"
                   />
                 </>
               )}
               
               {activeTransformMode === 'move' && (
                 <>
                   <Text style={{color: '#AAA', marginBottom: 15}}>Vertical Offset (Z/Y Axis)</Text>
                   <PureJSSlider
                     style={{width: '100%', height: 40}}
                     minimumValue={-2}
                     maximumValue={2}
                     value={selectedObject.yOffset || 0}
                     onValueChange={(val: number) => {
                       setPlacedObjects(prev => prev.map(o => o.id === selectedObjectId ? {...o, yOffset: val} : o));
                     }}
                     minimumTrackTintColor="#00E6FF"
                     maximumTrackTintColor="#555"
                   />
                   <Text style={[styles.hintText, { marginTop: 10 }]}>Drag the object on screen to move it horizontally</Text>
                 </>
               )}
             </View>
          ) : pendingModelContext ? (
            // Ghost active — CANCEL + PLACE MODEL / PLACE ANOTHER
            <View style={styles.buttonRow}>
               <TouchableOpacity 
                 style={[styles.secondaryButton]} 
                 onPress={() => {
                   setPendingModelContext(null);
                   setGhostPosition(null);
                 }}
               >
                 <Text style={styles.secondaryButtonText}>CANCEL</Text>
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
          {isTapeMode ? (
            <Text style={styles.hintText}>{tapePoints.length === 0 ? "Aim at floor and tap to place start point" : "Tap to continue measuring, toggle ruler to clear"}</Text>
          ) : pendingModelContext ? (
            <Text style={styles.hintText}>Move phone to position ghost • Tap PLACE to confirm</Text>
          ) : hasPlacedAny && !selectedObjectId ? (
            <Text style={styles.hintText}>Select an object via the 👁️ menu to edit</Text>
          ) : hasPlacedAny && selectedObjectId && activeTransformMode === 'move' ? (
            <Text style={styles.hintText}>Drag to move • Vertical slider for Z</Text>
          ) : hasPlacedAny && selectedObjectId && activeTransformMode === 'rotate' ? (
            <Text style={styles.hintText}>Use slider to rotate</Text>
          ) : (
            <Text style={styles.hintText}>Select a 3D model from the catalog to begin</Text>
          )}
        </View>
      )}

      {/* OBJECT SELECTION LIST OVERLAY */}
      {isObjectListOpen && (
        <View style={[styles.objectListOverlay, { paddingTop: insets.top + 80 }]}>
          <Text style={styles.objectListTitle}>Placed Objects</Text>
          {placedObjects.filter(o => o.id !== 'dummy-bugfix').length === 0 ? (
            <Text style={styles.hintText}>No objects placed yet</Text>
          ) : (
            <FlatList
              data={placedObjects.filter(o => o.id !== 'dummy-bugfix')}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
              renderItem={({ item, index }) => {
                const isSelected = selectedObjectId === item.id;
                // Generate a vibrant HSL color for the bubble
                const hue = (index * 137.5) % 360;
                const bubbleColor = `hsl(${hue}, 80%, 40%)`;
                return (
                  <View 
                    style={[
                      styles.objectBubble,
                      { backgroundColor: bubbleColor },
                      isSelected && { borderWidth: 3, borderColor: '#FFF' }
                    ]}
                  >
                    <TouchableOpacity
                      style={{ flex: 1, paddingVertical: 15, paddingHorizontal: 20 }}
                      activeOpacity={0.8}
                      onPress={() => {
                        setSelectedObjectId(item.id);
                        setActiveTransformMode('move'); // Default to move
                        setIsObjectListOpen(false);
                      }}
                    >
                      <Text style={styles.objectBubbleText} numberOfLines={1}>
                        {item.title} {isSelected && '✓'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.deleteObjectButton}
                      onPress={() => {
                        Alert.alert("Smazat objekt", "Opravdu chcete tento objekt smazat z prostoru?", [
                           { text: "Zrušit", style: "cancel" },
                           { text: "Smazat", style: "destructive", onPress: () => {
                               setPlacedObjects((prev: ARPlacedObject[]) => {
                                  const next = prev.filter(o => o.id !== item.id);
                                  if (next.filter(o => o.id !== 'dummy-bugfix').length === 0) {
                                    setIsObjectListOpen(false); // Close list if empty
                                  }
                                  return next;
                               });
                               if (selectedObjectId === item.id) {
                                  setSelectedObjectId(null);
                               }
                           }}
                        ]);
                      }}
                    >
                      <Text style={{ color: '#FFF', fontSize: 18 }}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
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
  selectedTitle: {
    color: '#FFF',
    fontFamily: typography.fontFamily.semiBold,
    fontSize: typography.fontSize.md,
    flex: 1,
  },
  sideToolbar: {
    position: 'absolute',
    right: spacing.md,
    top: '40%',
    gap: spacing.md,
    zIndex: 20,
  },
  sideToolButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  sideToolActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(0, 230, 255, 0.2)',
  },
  sideToolIcon: {
    fontSize: 28,
  },
  
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
  selectedPanel: { backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: borderRadius.lg, padding: spacing.md, width: '100%' },
  selectedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  
  objectListOverlay: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 15,
  },
  objectListTitle: {
    color: '#FFF', fontSize: 20, fontFamily: typography.fontFamily.semiBold,
    textAlign: 'center', marginBottom: 20,
  },
  objectBubble: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 30, minHeight: 60, overflow: 'hidden'
  },
  objectBubbleText: {
    color: '#FFF', fontSize: 16, fontFamily: typography.fontFamily.semiBold, flex: 1,
  },
  deleteObjectButton: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: 'rgba(255, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  }
});
