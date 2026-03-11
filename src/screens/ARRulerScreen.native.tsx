// ============================================================
// AR Ruler Screen — Native iOS/Android Tape Measure
// ============================================================
import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import {
  ViroARSceneNavigator,
  ViroARScene,
  ViroNode,
  ViroQuad,
  ViroLightingEnvironment,
  ViroAmbientLight,
  ViroDirectionalLight,
  ViroMaterials,
  ViroPolyline,
  ViroText,
  ViroSphere
} from '@reactvision/react-viro';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/theme';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

// Reusing base64 textures for tracker visibility
import { crossTexture, ringTexture } from '../theme/textures';

ViroMaterials.createMaterials({
  trackingMaterial: {
    diffuseTexture: crossTexture,
    lightingModel: "Lambert",
  },
  ringMaterial: {
    diffuseTexture: ringTexture,
    lightingModel: "Lambert",
    blendMode: "Alpha",
  },
  rulerNodeMaterial: {
    diffuseColor: '#00FFFF',
    lightingModel: "Lambert",
  },
  rulerLineMaterial: {
    diffuseColor: '#00A3A3',
  }
});

// Utility to calculate Distance between two 3D Vector positions
const calcDistance = (p1: number[], p2: number[]) => {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dz = p2[2] - p1[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// Utility to calculate Area of 3D Polygon projected onto the X/Z logical floor
const calcShoelaceArea = (points: {position: number[]}[]): number => {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].position[0] * points[j].position[2];
    area -= points[j].position[0] * points[i].position[2];
  }
  return Math.abs(area) / 2;
};

// SVG String generator for the Area map
const generateAreaSVG = (nodes: {id: string, position: number[]}[]) => {
  if (nodes.length < 3) return `<svg viewBox="-5 -5 10 10" xmlns="http://www.w3.org/2000/svg"><text fill="#FFF">Need 3+ points</text></svg>`;
  // Map 3D coords to 2D
  let minX = Infinity, maxZ = -Infinity, maxX = -Infinity, minZ = Infinity;
  const mapped = nodes.map(n => {
     // X is right, Z is back (-Z is forward). Map X to X, -Z to Y.
     const x = n.position[0];
     const y = -n.position[2];
     if(x < minX) minX = x;
     if(x > maxX) maxX = x;
     if(y < minZ) minZ = y;
     if(y > maxZ) maxZ = y;
     return {x, y};
  });
  
  const spanX = maxX - minX || 1;
  const spanY = maxZ - minZ || 1;
  const padding = Math.max(spanX, spanY) * 0.2; // 20% padding
  const viewMinX = minX - padding;
  const viewMinY = minZ - padding;
  const viewWidth = spanX + padding * 2;
  const viewHeight = spanY + padding * 2;
  
  const pointsStr = mapped.map(p => `${p.x},${p.y}`).join(' ');

  return `
    <svg viewBox="${viewMinX} ${viewMinY} ${viewWidth} ${viewHeight}" xmlns="http://www.w3.org/2000/svg" style="background-color: #0A141E;">
      <defs>
        <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(0, 255, 255, 0.2)" stroke-width="0.02"/>
        </pattern>
      </defs>
      <rect x="${viewMinX}" y="${viewMinY}" width="${viewWidth}" height="${viewHeight}" fill="url(#grid)" />
      
      <!-- Polygon Footprint -->
      <polygon points="${pointsStr}" fill="rgba(0, 255, 255, 0.2)" stroke="#00FFFF" stroke-width="0.05" />
      
      <!-- Nodes -->
      ${mapped.map(p => `<circle cx="${p.x}" cy="${p.y}" r="0.08" fill="#FFF" />`).join('')}
    </svg>
  `;
};

const ARScene = (props: any) => {
  const { nodes, setNodes } = props.sceneNavigator.viroAppProps;
  
  const [rings, setRings] = useState<{ id: number; position: [number, number, number] }[]>([]);

  const handleSceneClick = (position: number[], source: any) => {
    if (position && position.length === 3) {
      // Drop a measurement node exactly at hit
      const newNode = {
        id: Date.now().toString(),
        position: [position[0], position[1], position[2]] as [number, number, number],
      };
      
      setNodes((prev: any) => [...prev, newNode]);

      // Feedback animation
      const id = Date.now();
      setRings((prev: any) => [...prev, { id, position: [position[0], position[1], position[2]] }]);
      setTimeout(() => {
         setRings((prev: any) => prev.filter((r: any) => r.id !== id));
      }, 1000);
    }
  };

  // Build sequential polylines
  const renderLines = () => {
    if (nodes.length < 2) return null;
    const paths = [];
    for (let i = 1; i < nodes.length; i++) {
       paths.push(
         <ViroPolyline
           key={`line-${i}`}
           position={[0,0,0]}
           points={[nodes[i-1].position, nodes[i].position]}
           thickness={0.015} // 1.5cm thick tape
           materials={["rulerLineMaterial"]}
         />
       );
    }
    
    // Auto-close area track polygon if more than 2 points to visualize full footprint
    if (nodes.length > 2) {
       paths.push(
         <ViroPolyline
           key={`line-close`}
           position={[0,0,0]}
           points={[nodes[nodes.length-1].position, nodes[0].position]}
           thickness={0.01} // thinner line for the ghost closure
           materials={["rulerLineMaterial"]}
           opacity={0.5}
         />
       );
    }
    return paths;
  };
  
  // Build distance text floating above lines
  const renderDistances = () => {
    if (nodes.length < 2) return null;
    const texts = [];
    for (let i = 1; i < nodes.length; i++) {
        const p1 = nodes[i-1].position;
        const p2 = nodes[i].position;
        const dist = calcDistance(p1, p2);
        
        // Midpoint
        const midX = (p1[0] + p2[0]) / 2;
        const midY = (p1[1] + p2[1]) / 2 + 0.1; // lift 10cm above ground
        const midZ = (p1[2] + p2[2]) / 2;
        
        texts.push(
           <ViroText
             key={`text-${i}`}
             position={[midX, midY, midZ]}
             scale={[0.08, 0.08, 0.08]}
             text={dist.toFixed(2) + "m"}
             style={{fontFamily: 'Inter_700Bold', color: '#00FFFF', fontWeight: 'bold'}}
             transformBehaviors={["billboard"]}
           />
        );
    }
    return texts;
  };

  return (
    <ViroARScene 
      anchorDetectionTypes={['PlanesHorizontal']}
      onClick={handleSceneClick}
    >
      {/* Visual touch rings */}
      {rings.map(r => (
        <ViroNode key={r.id} position={r.position}>
          <ViroQuad 
            rotation={[-90, 0, 0]} 
            width={0.3} height={0.3}
            materials={["ringMaterial"]}
            animation={{ name: "ringPulse", run: true, loop: false }}
          />
        </ViroNode>
      ))}

      {/* Nodes dropping indicator */}
      {nodes.map((node: any, i: number) => (
         <ViroSphere
           key={`sphere-${node.id}`}
           position={node.position}
           radius={0.02}
           materials={["rulerNodeMaterial"]}
           widthSegmentCount={16}
           heightSegmentCount={16}
         />
      ))}
      
      {renderLines()}
      {renderDistances()}

      <ViroAmbientLight color="#ffffff" intensity={300} />
      
      {/* HQ Shadow Ambient Occlusion simulation request via Directional mapping */}
      <ViroDirectionalLight 
        color="#ffffff" 
        direction={[0, -1, -0.2]} 
        intensity={500} 
        castsShadow={true} 
        shadowMapSize={2048}
        shadowOpacity={0.6}
        shadowNearZ={0.1}
        shadowFarZ={5}
      />
      
      {/* Master shadow plane over entire floor to catch light AO */}
      <ViroQuad
         position={[0, -0.01, 0]}
         rotation={[-90, 0, 0]}
         width={50}
         height={50}
         arShadowReceiver={true}
         ignoreEventHandling={true}
      />
    </ViroARScene>
  );
};

export default function ARRulerScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [nodes, setNodes] = useState<{id: string, position: number[]}[]>([]);

  // Calculate dynamic metrics
  let totalDistance = 0;
  for (let i = 1; i < nodes.length; i++) {
     totalDistance += calcDistance(nodes[i-1].position, nodes[i].position);
  }
  
  let polyArea = 0;
  if (nodes.length >= 3) {
     polyArea = calcShoelaceArea(nodes);
  }

  const handleUndo = () => {
    if (nodes.length > 0) {
       setNodes(prev => prev.slice(0, -1));
    }
  };

  const handleClear = () => {
    setNodes([]);
  };

  return (
    <View style={styles.container}>
      <ViroARSceneNavigator 
        autofocus={true} 
        // @ts-ignore
        initialScene={{ scene: ARScene }} 
        viroAppProps={{ nodes, setNodes }}
        style={styles.viroContainer} 
      />
      
      {/* Top Header */}
      <View style={[styles.headerOverlay, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>AR Tape Measure</Text>
        
        <TouchableOpacity style={styles.actionButton} onPress={handleUndo}>
          <Text style={styles.actionButtonText}>UNDO</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleClear}>
           <Text style={styles.actionButtonText}>CLEAR</Text>
        </TouchableOpacity>
      </View>
      
      {/* HUD Hint directly in viewport */}
      {nodes.length === 0 && (
         <View style={styles.promptOverlay}>
            <Text style={styles.promptText}>Tap the floor to drop the first measuring node</Text>
         </View>
      )}
      
      {/* Bottom Panel Displaying Math */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + spacing.lg }]}>
         <View style={styles.measureBox}>
            <Text style={styles.measureValue}>{totalDistance.toFixed(2)}<Text style={styles.measureUnit}> m</Text></Text>
            <Text style={styles.measureLabel}>Line Length</Text>
         </View>
         
         <View style={styles.measureDivider} />

         <View style={styles.measureBox}>
             <Text style={styles.measureValue}>{polyArea > 0 ? polyArea.toFixed(2) : '--'}<Text style={styles.measureUnit}> m²</Text></Text>
             <Text style={styles.measureLabel}>Area</Text>
         </View>
         
         <View style={styles.measureDivider} />
         
         <View style={{justifyContent: 'center', paddingHorizontal: spacing.sm}}>
           <TouchableOpacity 
             style={styles.exportButton}
             onPress={async () => {
               if (nodes.length < 3) {
                  Alert.alert("Not Enough Points", "Tap at least 3 points to export an area map.");
                  return;
               }
               try {
                  const svgString = generateAreaSVG(nodes);
                  const fileUri = `${FileSystem.documentDirectory}ar_measurement_${Date.now()}.svg`;
                  await FileSystem.writeAsStringAsync(fileUri, svgString, { encoding: FileSystem.EncodingType.UTF8 });
                  if (await Sharing.isAvailableAsync()) {
                     await Sharing.shareAsync(fileUri, { UTI: 'public.svg-image', mimeType: 'image/svg+xml' });
                  }
               } catch (e) {
                  Alert.alert("Error", "Could not export SVG.");
               }
             }}
           >
              <Text style={styles.actionButtonText}>EXPORT SVG</Text>
           </TouchableOpacity>
         </View>
      </View>

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
  actionButton: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: borderRadius.sm, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  actionButtonText: { color: '#FFF', fontFamily: typography.fontFamily.bold, fontSize: 12, letterSpacing: 1 },
  
  promptOverlay: { position: 'absolute', top: 120, left: spacing.md, right: spacing.md, alignItems: 'center', zIndex: 12, pointerEvents: 'none' },
  promptText: { backgroundColor: 'rgba(0,0,0,0.8)', color: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 30, fontFamily: typography.fontFamily.semiBold, ...shadows.md, overflow: 'hidden'},
  
  bottomPanel: { 
     position: 'absolute', bottom: 0, left: 0, right: 0, 
     backgroundColor: 'rgba(10, 20, 30, 0.9)',
     borderTopWidth: 1, borderTopColor: 'rgba(0, 255, 255, 0.2)',
     flexDirection: 'row', justifyContent: 'space-evenly', 
     paddingTop: spacing.lg, zIndex: 10 
  },
  measureBox: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  measureValue: { color: '#FFF', fontSize: 32, fontFamily: typography.fontFamily.bold },
  measureUnit: { fontSize: 18, color: colors.primary },
  measureLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontFamily: typography.fontFamily.medium, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },
  measureDivider: { width: 1, backgroundColor: 'rgba(0, 255, 255, 0.2)', height: '70%' },
  exportButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: '#2196F3', borderRadius: borderRadius.md, justifyContent: 'center', alignItems: 'center' }
});
