import React from 'react';
import {
  ViroNode,
  ViroQuad,
  ViroPolyline,
  ViroPolygon,
  ViroText,
  ViroSphere,
  ViroMaterials,
  ViroAnimations
} from '@reactvision/react-viro';
import { ARRulerNode, ARRulerRing } from './useARRuler';
import { calcDistance, calcShoelaceArea } from './utils';

ViroMaterials.createMaterials({
  rulerLineMaterial: {
    lightingModel: "Constant",
    diffuseColor: "#00FFFF", // Cyan line
    writesToDepthBuffer: false,
    readsFromDepthBuffer: false,
  },
  rulerHeightMaterial: {
    lightingModel: "Constant",
    diffuseColor: "#FF3366", // Red/Pink height line
    writesToDepthBuffer: false,
    readsFromDepthBuffer: false,
  },
  rulerAreaMaterial: {
    lightingModel: "Constant",
    diffuseColor: "#00FFFF", // Cyan area fill
  },
  neonGridMaterial: {
    lightingModel: "Constant",
    diffuseTexture: require("../../assets/neon_grid.png"),
    wrapS: "Repeat",
    wrapT: "Repeat",
    blendMode: "Alpha",
  },
  rulerNodeMaterial: {
    lightingModel: "Constant",
    diffuseColor: "#FFFFFF", // White connection nodes
    writesToDepthBuffer: false,
    readsFromDepthBuffer: false,
  },
  ringMaterial: {
    lightingModel: "Constant",
    blendMode: "Add",
    diffuseColor: "rgba(0, 255, 255, 0.0)"
  },
  trackingMaterial: {
    lightingModel: "Constant",
    diffuseColor: "#00FFFF",
    writesToDepthBuffer: false,
    readsFromDepthBuffer: false,
  },
  previewSphereMaterial: {
    lightingModel: "Constant",
    diffuseColor: "#FF0000",
    writesToDepthBuffer: false,
    readsFromDepthBuffer: false,
  },
  planeSolidMaterial: {
    lightingModel: "Constant",
    diffuseColor: "#00FFFF",
    writesToDepthBuffer: false,
    readsFromDepthBuffer: false,
  },
  wallSolidMaterial: {
    lightingModel: "Constant",
    diffuseColor: "#FF66FF",
    writesToDepthBuffer: false,
    readsFromDepthBuffer: false,
  }
});

ViroAnimations.registerAnimations({
  ringPulse: {
    properties: { scaleX: 3, scaleY: 3, scaleZ: 3, opacity: 0 },
    duration: 1000,
    easing: "EaseOut"
  }
});

interface ARRulerNodesProps {
  phase: 'floor' | 'ceiling' | 'plan';
  floorPoint: [number, number, number] | null;
  ceilingPoint: [number, number, number] | null;
  planes?: {[key: string]: any};
  nodes: ARRulerNode[];
  completedShapes?: ARRulerNode[][];
  meshVertices?: [number, number, number][];
  rings: ARRulerRing[];
  reticlePosition: [number, number, number] | null;
}

export default function ARRulerNodes({ phase, floorPoint, ceilingPoint, planes = {}, nodes, completedShapes = [], meshVertices = [], rings, reticlePosition }: ARRulerNodesProps) {

  const isPlanClosed = nodes.length > 2 && calcDistance(nodes[0].position, nodes[nodes.length - 1].position) < 0.01;

  // Build sequential polylines
  const renderLines = () => {
    if (nodes.length === 0) return null;
    
    const paths = [];
    
    // 1. Render confirmed static lines between dropped nodes (Floor plan)
    for (let i = 1; i < nodes.length; i++) {
       paths.push(
         <ViroPolyline
           key={`line-${i}`}
           position={[0,0,0]}
           points={[nodes[i-1].position, nodes[i].position]}
           thickness={0.015} // 1.5cm thick tape
           materials={["rulerLineMaterial"]}
           ignoreEventHandling={true}
         />
       );
    }
    
    // 1.5 FLOOR SPHERE PREVIEW — bright red, snapped to detected floor plane Y
    if (phase === 'floor' && reticlePosition) {
       // Find the best floor plane Y so the sphere sits ON the visible surface
       const horizontalPlanes = Object.values(planes).filter((p: any) => 
         p.alignment === 'Horizontal' || p.alignment === 'HorizontalUpward'
       );
       let previewY = reticlePosition[1];
       if (horizontalPlanes.length > 0) {
         let bestDist = Infinity;
         horizontalPlanes.forEach((p: any) => {
           const dist = Math.abs(p.center[1] - reticlePosition[1]);
           if (dist < bestDist) { bestDist = dist; previewY = p.center[1]; }
         });
       }
       
       // Ground ring on the floor plane
       paths.push(
         <ViroQuad
           key={'floor-preview-ring'}
           position={[reticlePosition[0], previewY + 0.005, reticlePosition[2]]}
           rotation={[-90, 0, 0]}
           width={0.15}
           height={0.15}
           materials={["previewSphereMaterial"]}
           opacity={0.4}
           ignoreEventHandling={true}
         />
       );
       // Red sphere sitting on the floor
       paths.push(
          <ViroSphere
            key={'floor-preview-sphere'}
            position={[reticlePosition[0], previewY + 0.03, reticlePosition[2]]}
            radius={0.04}
            materials={["previewSphereMaterial"]}
            widthSegmentCount={16}
            heightSegmentCount={16}
            ignoreEventHandling={true}
          />
       );
    }
    
    // 2. FLOOR SPHERE — show immediately once floor is placed
    if (floorPoint) {
       paths.push(
          <ViroSphere
            key={'floor-point-sphere'}
            position={[floorPoint[0], floorPoint[1] + 0.01, floorPoint[2]]}
            radius={0.025}
            materials={["rulerHeightMaterial"]}
            widthSegmentCount={16}
            heightSegmentCount={16}
            ignoreEventHandling={true}
          />
       );
       
       // "FLOOR" label below the sphere
       paths.push(
         <ViroText
           key={'floor-label'}
           position={[floorPoint[0], floorPoint[1] - 0.06, floorPoint[2]]}
           scale={[0.08, 0.08, 0.08]}
           text={"FLOOR"}
           style={{fontFamily: 'Inter_700Bold', color: '#FF3366', fontWeight: 'bold'}}
           transformBehaviors={["billboard"]}
           ignoreEventHandling={true}
         />
       );
    }
    
    // 3. RED HEIGHT LINE + CEILING SPHERE — grows in real-time during ceiling phase
    if (floorPoint && (ceilingPoint || phase === 'ceiling')) {
       const topPoint = ceilingPoint ? ceilingPoint : reticlePosition;
       if (topPoint) {
         // Red vertical line from floor to current top point
         paths.push(
           <ViroPolyline
             key={`line-height`}
             position={[0,0,0]}
             points={[floorPoint, [floorPoint[0], topPoint[1], floorPoint[2]]]}
             thickness={0.015}
             materials={["rulerHeightMaterial"]}
             opacity={ceilingPoint ? 1.0 : 0.8}
             ignoreEventHandling={true}
           />
         );
         
         // CEILING sphere — semi-transparent preview during ceiling phase, solid after confirmed
         paths.push(
            <ViroSphere
              key={'ceiling-point-sphere'}
              position={[floorPoint[0], topPoint[1], floorPoint[2]]}
              radius={0.025}
              materials={["rulerHeightMaterial"]}
              widthSegmentCount={16}
              heightSegmentCount={16}
              opacity={ceilingPoint ? 1.0 : 0.5}
              ignoreEventHandling={true}
            />
         );
         
         // Height dimension text — always visible, halfway up the red line
         const heightVal = Math.abs(topPoint[1] - floorPoint[1]);
         const midY = (topPoint[1] + floorPoint[1]) / 2;
         
         paths.push(
           <ViroText
             key={'height-point-label'}
             position={[floorPoint[0] + 0.08, midY, floorPoint[2]]}
             scale={[0.6, 0.6, 0.6]}
             text={`${heightVal.toFixed(2)} m`}
             style={{fontFamily: 'Inter_700Bold', color: '#FFFFFF', fontWeight: 'bold'}}
             transformBehaviors={["billboard"]}
             ignoreEventHandling={true}
             renderingOrder={100}
           />
         );
         
         // "CEILING" label above the ceiling sphere
         paths.push(
           <ViroText
             key={'ceiling-label'}
             position={[floorPoint[0], topPoint[1] + 0.06, floorPoint[2]]}
             scale={[0.4, 0.4, 0.4]}
             text={ceilingPoint ? "CEILING" : "CEILING ▲"}
             style={{fontFamily: 'Inter_700Bold', color: '#FF3366', fontWeight: 'bold'}}
             transformBehaviors={["billboard"]}
             ignoreEventHandling={true}
             opacity={ceilingPoint ? 1.0 : 0.6}
           />
         );
       }
    }
    
    // 3. Render live "rubber band" line to the reticle FOR PLAN TRACING
    if (phase === 'plan' && nodes.length > 0 && reticlePosition) {
       paths.push(
         <ViroPolyline
           key={`line-live`}
           position={[0,0,0]}
           points={[nodes[nodes.length-1].position, reticlePosition]}
           thickness={0.015}
           materials={["rulerLineMaterial"]}
           opacity={0.8}
           ignoreEventHandling={true}
         />
       );
    }
    
    // 4. Auto-close ghost line if more than 2 points
    if (nodes.length > 2) {
       paths.push(
         <ViroPolyline
           key={`line-close`}
           position={[0,0,0]}
           points={[nodes[nodes.length-1].position, nodes[0].position]}
           thickness={0.01}
           materials={["rulerLineMaterial"]}
           opacity={0.3}
           ignoreEventHandling={true}
         />
       );
    }
    return paths;
  };
  
  // Build distance text floating above lines
  const renderDistances = () => {
    if (nodes.length === 0) return null;
    const texts = [];
    
    // Static confirmed distances
    for (let i = 1; i < nodes.length; i++) {
        const p1 = nodes[i-1].position;
        const p2 = nodes[i].position;
        const dist = calcDistance(p1, p2);
        
        const midX = (p1[0] + p2[0]) / 2;
        const midY = (p1[1] + p2[1]) / 2 + 0.1; // lift 10cm above ground
        const midZ = (p1[2] + p2[2]) / 2;
        
        texts.push(
           <ViroText
             key={`text-${i}`}
             position={[midX, midY, midZ]}
             scale={[0.4, 0.4, 0.4]}
             text={dist.toFixed(2) + "m"}
             style={{fontFamily: 'Inter_700Bold', color: '#00FFFF', fontWeight: 'bold'}}
             transformBehaviors={["billboard"]}
             ignoreEventHandling={true}
             renderingOrder={100}
           />
        );
    }

    // Live distance to reticle during PLAN phase
    if (phase === 'plan' && nodes.length > 0 && reticlePosition) {
        const p1 = nodes[nodes.length-1].position;
        const p2 = reticlePosition;
        const dist = calcDistance(p1, p2);
        
        const midX = (p1[0] + p2[0]) / 2;
        const midY = (p1[1] + p2[1]) / 2 + 0.1;
        const midZ = (p1[2] + p2[2]) / 2;

        texts.push(
           <ViroText
             key={`text-live`}
             position={[midX, midY, midZ]}
             scale={[0.4, 0.4, 0.4]}
             text={dist.toFixed(2) + "m"}
             style={{fontFamily: 'Inter_700Bold', color: '#FFFFFF', fontWeight: 'bold'}}
             transformBehaviors={["billboard"]}
             ignoreEventHandling={true}
           />
        );
    }
    return texts;
  };

  const renderAreaFill = () => {
    if (!isPlanClosed || !floorPoint) return null;
    
    const vertices2D: [number, number][] = nodes.slice(0, -1).map(n => [n.position[0] as number, -n.position[2] as number]);
    
    const area = calcShoelaceArea(nodes);
    
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    nodes.forEach(n => {
       if (n.position[0] < minX) minX = n.position[0];
       if (n.position[0] > maxX) maxX = n.position[0];
       if (n.position[2] < minZ) minZ = n.position[2];
       if (n.position[2] > maxZ) maxZ = n.position[2];
    });
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    return (
      <ViroNode position={[0, floorPoint[1] + 0.002, 0]}>
         <ViroNode rotation={[-90, 0, 0]}>
             <ViroPolygon
                vertices={vertices2D}
                holes={[]}
                materials={["rulerAreaMaterial"]}
                opacity={0.3}
                ignoreEventHandling={true}
             />
         </ViroNode>
         
         {/* Label */}
         <ViroText
            position={[centerX, 0.05, centerZ]}
            text={`${area.toFixed(2)} m\u00B2`}
            width={10}
            scale={[0.8, 0.8, 0.8]}
            style={{ fontFamily: 'Inter_700Bold', fontSize: 40, color: '#00FFFF', fontWeight: 'bold', textAlign: 'center' }}
            transformBehaviors={["billboard"]}
            ignoreEventHandling={true}
         />
      </ViroNode>
    );
  };

  return (
    <>

      {/* Visual touch rings */}
      {rings.map(r => (
        <ViroNode key={r.id} position={r.position}>
          <ViroQuad 
            rotation={[-90, 0, 0]} 
            width={0.3} height={0.3}
            materials={["ringMaterial"]}
            animation={{ name: "ringPulse", run: true, loop: false }}
            ignoreEventHandling={true}
          />
        </ViroNode>
      ))}

      {/* Area Fill */}
      {renderAreaFill()}

      {/* AR Planes — hidden for now */}
      {/* Object.values(planes).map(...) */}

      {/* Nodes dropping indicator */}
      {nodes.map((node) => (
         <ViroSphere
           key={`sphere-${node.id}`}
           position={node.position}
           radius={0.02}
           materials={["rulerNodeMaterial"]}
           widthSegmentCount={16}
           heightSegmentCount={16}
           ignoreEventHandling={true}
         />
      ))}
      
      {renderLines()}
      {renderDistances()}
      
      {/* Completed (archived) shapes */}
      {completedShapes.map((shape, si) => (
        <ViroNode key={`shape-${si}`}>
          {/* Lines */}
          {shape.slice(1).map((node, i) => (
            <ViroPolyline
              key={`cs-${si}-line-${i}`}
              position={[0,0,0]}
              points={[shape[i].position, node.position]}
              thickness={0.015}
              materials={["rulerLineMaterial"]}
              ignoreEventHandling={true}
            />
          ))}
          {/* Node spheres */}
          {shape.slice(0, -1).map((node, i) => (
            <ViroSphere
              key={`cs-${si}-node-${i}`}
              position={node.position}
              radius={0.02}
              materials={["rulerNodeMaterial"]}
              widthSegmentCount={16}
              heightSegmentCount={16}
              ignoreEventHandling={true}
            />
          ))}
          {/* Distance labels */}
          {shape.slice(1).map((node, i) => {
            const p1 = shape[i].position;
            const p2 = node.position;
            const dist = calcDistance(p1, p2);
            return (
              <ViroText
                key={`cs-${si}-txt-${i}`}
                position={[(p1[0]+p2[0])/2, (p1[1]+p2[1])/2 + 0.1, (p1[2]+p2[2])/2]}
                scale={[0.4, 0.4, 0.4]}
                text={dist.toFixed(2) + "m"}
                style={{fontFamily: 'Inter_700Bold', color: '#00FFFF', fontWeight: 'bold'}}
                transformBehaviors={["billboard"]}
                ignoreEventHandling={true}
              />
            );
          })}
          {/* Area fill for completed shape */}
          {floorPoint && (() => {
            const uniqueNodes = shape.slice(0, -1);
            const verts2D: [number, number][] = uniqueNodes.map(n => [n.position[0], -n.position[2]]);
            const area = calcShoelaceArea(uniqueNodes);
            let cx = 0, cz = 0;
            uniqueNodes.forEach(n => { cx += n.position[0]; cz += n.position[2]; });
            cx /= uniqueNodes.length; cz /= uniqueNodes.length;
            return (
              <ViroNode position={[0, floorPoint[1] + 0.002, 0]}>
                <ViroNode rotation={[-90, 0, 0]}>
                  <ViroPolygon
                    vertices={verts2D}
                    holes={[]}
                    materials={["rulerAreaMaterial"]}
                    opacity={0.3}
                    ignoreEventHandling={true}
                  />
                </ViroNode>
                <ViroText
                  position={[cx, 0.05, cz]}
                  text={`${area.toFixed(2)} m\u00B2`}
                  width={10}
                  scale={[0.8, 0.8, 0.8]}
                  style={{ fontFamily: 'Inter_700Bold', fontSize: 40, color: '#00FFFF', fontWeight: 'bold', textAlign: 'center' }}
                  transformBehaviors={["billboard"]}
                  ignoreEventHandling={true}
                />
              </ViroNode>
            );
          })()}
        </ViroNode>
      ))}
      {/* LiDAR Mesh Point Cloud — "deep scanner" proximity effect */}
      {meshVertices.length > 0 && reticlePosition && (() => {
        // Only show points within 2m of reticle, max 200 for perf
        const nearby = meshVertices
          .map((v, i) => {
            const dx = v[0] - reticlePosition[0];
            const dz = v[2] - reticlePosition[2];
            return { v, dist: Math.sqrt(dx * dx + dz * dz), i };
          })
          .filter(p => p.dist < 2.0)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 200);
        
        return nearby.map(p => (
          <ViroSphere
            key={`mesh-${p.i}`}
            position={p.v}
            radius={0.008}
            materials={["trackingMaterial"]}
            widthSegmentCount={4}
            heightSegmentCount={4}
            opacity={Math.max(0.1, 1.0 - p.dist / 2.0)}
            ignoreEventHandling={true}
          />
        ));
      })()}
    </>
  );
}
