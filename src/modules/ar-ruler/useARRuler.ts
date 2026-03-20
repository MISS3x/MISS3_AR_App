import { useState, useCallback, useEffect, useRef } from 'react';
import { enableSceneReconstruction, getMeshWireframe, isLidarAvailable } from '../../../modules/lidar-mesh';

export interface ARRulerNode {
  id: string;
  position: [number, number, number];
}

export interface ARRulerRing {
  id: number;
  position: [number, number, number];
}

export function useARRuler() {
  const [phase, setPhase] = useState<'floor' | 'ceiling' | 'plan'>('floor');
  const [floorPoint, setFloorPoint] = useState<[number, number, number] | null>(null);
  const [ceilingPoint, setCeilingPoint] = useState<[number, number, number] | null>(null);
  const [floorSamples, setFloorSamples] = useState<[number, number, number][]>([]);
  const [ceilingSamples, setCeilingSamples] = useState<[number, number, number][]>([]);

  const [nodes, setNodes] = useState<ARRulerNode[]>([]);
  const [completedShapes, setCompletedShapes] = useState<ARRulerNode[][]>([]);
  const [rings, setRings] = useState<ARRulerRing[]>([]);
  const [planes, setPlanes] = useState<{[key: string]: any}>({});

  const [reticlePosition, setReticlePosition] = useState<[number, number, number] | null>(null);
  const [reticleRotation, setReticleRotation] = useState<[number, number, number] | null>(null);
  
  // Track camera position / forward vector for math intersection
  const [cameraPosition, setCameraPosition] = useState<[number, number, number] | null>(null);
  const [cameraForward, setCameraForward] = useState<[number, number, number] | null>(null);
  
  // LiDAR mesh vertices (disabled — enableSceneReconstruction crashes ViroReact's ARSession)
  const [meshVertices, setMeshVertices] = useState<[number, number, number][]>([]);
  // const meshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Log LiDAR availability but DON'T reconfigure the session
  useEffect(() => {
    try {
      const available = isLidarAvailable();
      console.log('[AR-RULER] LiDAR available:', available, '(mesh disabled — conflicts with ViroReact)');
    } catch (e) {
      console.log('[AR-RULER] LiDAR check error:', e);
    }
  }, []);
  
  const onCameraTransformUpdate = useCallback((transformState: any) => {
    if (transformState.position && transformState.forward) {
      const pos: [number, number, number] = [transformState.position[0], transformState.position[1], transformState.position[2]];
      const fwd: [number, number, number] = [transformState.forward[0], transformState.forward[1], transformState.forward[2]];
      setCameraPosition(pos);
      setCameraForward(fwd);
      
      // Seed the reticle immediately so the crosshair is visible from the very first frame
      if (!reticlePosition) {
        const assumedFloorY = pos[1] - 1.5;
        if (fwd[1] < -0.1) {
          const t = (assumedFloorY - pos[1]) / fwd[1];
          setReticlePosition([pos[0] + fwd[0] * t, assumedFloorY, pos[2] + fwd[2] * t]);
        } else {
          setReticlePosition([pos[0] + fwd[0] * 3, assumedFloorY, pos[2] + fwd[2] * 3]);
        }
        setReticleRotation([-90, 0, 0]);
      }
    }
  }, [reticlePosition]);

  const onHitTest = useCallback((results: any) => {
    // 1. If we are in 'plan' phase, we IGNORE ARKit hits and find the exact mathematical intersection
    // between the camera's forward ray and the horizontal floor plane we established in phase 1.
    if (phase === 'plan' && floorPoint && cameraPosition && cameraForward) {
        const t = (floorPoint[1] - cameraPosition[1]) / cameraForward[1];
        if (t > 0) { // Intersects the plane in front of the camera
           let hitX = cameraPosition[0] + t * cameraForward[0];
           let hitZ = cameraPosition[2] + t * cameraForward[2];
           
           // Snap to existing nodes if within 15cm (0.15m) radius
           const snapThreshold = 0.15;
           for (const node of nodes) {
              const dist = Math.sqrt(Math.pow(node.position[0] - hitX, 2) + Math.pow(node.position[2] - hitZ, 2));
              if (dist < snapThreshold) {
                 hitX = node.position[0];
                 hitZ = node.position[2];
                 break;
              }
           }
           
           setReticlePosition([hitX, floorPoint[1], hitZ]);
           setReticleRotation([0, 0, 0]);
        } else {
           // Looking away from the floor
           setReticlePosition(null);
        }
        return;
    }

    // 2. If we are in 'ceiling' phase, we project the camera ray onto the strict vertical axis established by floorPoint.
    if (phase === 'ceiling' && floorPoint && cameraPosition && cameraForward) {
        // We want the point on the ray P(t) = cameraPosition + t * cameraForward
        // that is closest to the vertical line passing through (floorPoint[0], z, floorPoint[2]).
        // The safest projection is mapping the ray intersection onto the vertical plane facing the camera,
        // or simply mapping the user's pitch to the Y axis.
        
        // Let's find the intersection of the camera ray with the vertical plane that passes through floorPoint
        // and is perpendicular to the vector from camera to floorPoint in the XZ plane.
        
        const dx = floorPoint[0] - cameraPosition[0];
        const dz = floorPoint[2] - cameraPosition[2];
        const distToFloorPtXZ = Math.sqrt(dx*dx + dz*dz);
        
        if (distToFloorPtXZ > 0.01 && cameraForward[1] > 0) {
           // Basic trigonometric projection based on camera pitch
           const pitchAngle = Math.asin(cameraForward[1]); // Angle above horizon
           // Height = distance * tan(pitchAngle)
           const heightAboveCamera = distToFloorPtXZ * Math.tan(pitchAngle);
           const projectedY = cameraPosition[1] + heightAboveCamera;
           
           setReticlePosition([floorPoint[0], projectedY, floorPoint[2]]);
           setReticleRotation([0, 0, 0]);
        } else {
           // Fallback if looking down or right at it
           setReticlePosition([floorPoint[0], cameraPosition[1], floorPoint[2]]);
           setReticleRotation([0, 0, 0]);
        }
        return;
    }

    // 3. Use real ARKit physical detection (planes/feature points)
    if (results.hitTestResults && results.hitTestResults.length > 0) {
        // Sort results by distance so we always hit the closest surface
        const sortedResults = [...results.hitTestResults].sort((a: any, b: any) => a.distance - b.distance);
        
        // Prioritize LiDAR mesh geometry hits over estimated planes for exact physical floor tracking
        let hit = null;
        if (phase === 'floor') {
            hit = sortedResults.find((h: any) => h.type === 'ExistingPlaneUsingGeometry') ||
                  sortedResults.find((h: any) => h.type === 'ExistingPlaneUsingExtent') ||
                  sortedResults.find((h: any) => h.type === 'EstimatedHorizontalPlane');
                  
            // Double check that it's relatively flat (pitch/roll < 25 degrees)
            if (hit && hit.transform && hit.transform.rotation) {
                const rot = hit.transform.rotation;
                if (Math.abs(rot[0]) > 25 || Math.abs(rot[2]) > 25) {
                    hit = null; // Reject walls/slopes from floor phase
                }
            }
        } else {
            // General physical hit testing for other phases
            hit = sortedResults.find((h: any) => h.type === 'ExistingPlaneUsingGeometry') ||
                  sortedResults.find((h: any) => h.type === 'ExistingPlaneUsingExtent') ||
                  sortedResults.find((h: any) => h.type === 'EstimatedHorizontalPlane') ||
                  sortedResults.find((h: any) => h.type === 'EstimatedVerticalPlane') ||
                  sortedResults[0]; // Fallback to feature points
        }
        
        if (hit) {
            const pos = hit.transform.position;
            let rot = [0, 0, 0];
            if (hit.transform.rotation) {
                rot = [hit.transform.rotation[0], hit.transform.rotation[1], hit.transform.rotation[2]];
            }
            
            setReticlePosition([pos[0], pos[1], pos[2]]);
            setReticleRotation([rot[0], rot[1], rot[2]]);
            return; // We got a good hit, exit successfully
        }
    }

    // 4. Fallback "Tunnel": If ARKit finds absolutely nothing OR if our strict 'floor' filter rejected all planes 
    // (e.g. only found a table), artificially project the crosshair using forward raycast math
    if (cameraPosition && cameraForward) {
         if (phase === 'floor') {
             // TUNNEL PROJECTION FOR FLOOR: Assume the phone is held ~1.5m above the ground.
             // We shoot a ray forward from the camera and see where it intersects the plane Y = (camera.y - 1.5)
             const assumedFloorY = cameraPosition[1] - 1.5;
             
             // Check if user is actually looking down-ish, otherwise the math goes to infinity
             if (cameraForward[1] < -0.1) {
                 // t = (PlaneY - RayOriginY) / RayDirY
                 const t = (assumedFloorY - cameraPosition[1]) / cameraForward[1];
                 setReticlePosition([
                     cameraPosition[0] + cameraForward[0] * t,
                     assumedFloorY,
                     cameraPosition[2] + cameraForward[2] * t
                 ]);
             } else {
                 // User is looking straight ahead or up, just put it 3 meters away on the assumed floor
                 setReticlePosition([
                     cameraPosition[0] + cameraForward[0] * 3,
                     assumedFloorY,
                     cameraPosition[2] + cameraForward[2] * 3
                 ]);
             }
         } else {
             // General fallback for other phases (just float 2 meters in front of camera)
             setReticlePosition([
               cameraPosition[0] + cameraForward[0] * 2,
               cameraPosition[1] + cameraForward[1] * 2,
               cameraPosition[2] + cameraForward[2] * 2
             ]);
         }
         
         // Make it face the camera by copying the inverse yaw, or just leave it flat
         setReticleRotation([-90, 0, 0]); // Rotated so it points at camera
    } else {
         setReticlePosition(null);
         setReticleRotation(null);
    }
  }, [phase, floorPoint, cameraPosition, cameraForward]);

  const addNodeAtReticle = useCallback(() => {
    if (!reticlePosition) return;
    
    if (phase === 'floor') {
      // Collect 3 floor samples, then average Y
      const horizontalPlanes = Object.values(planes).filter((p: any) => 
        p.alignment === 'Horizontal' || p.alignment === 'HorizontalUpward'
      );
      let sampleY = reticlePosition[1];
      if (horizontalPlanes.length > 0) {
        let bestDist = Infinity;
        horizontalPlanes.forEach((p: any) => {
          const dist = Math.abs(p.center[1] - reticlePosition[1]);
          if (dist < bestDist) { bestDist = dist; sampleY = p.center[1]; }
        });
      }
      
      const newSample: [number, number, number] = [reticlePosition[0], sampleY, reticlePosition[2]];
      const updatedSamples = [...floorSamples, newSample];
      setFloorSamples(updatedSamples);
      
      console.log('[AR-RULER] Floor sample', updatedSamples.length, '/3, Y=', sampleY.toFixed(3));
      
      if (updatedSamples.length >= 3) {
        // Average all 3 samples
        const avgX = updatedSamples.reduce((s, p) => s + p[0], 0) / 3;
        const avgY = updatedSamples.reduce((s, p) => s + p[1], 0) / 3;
        const avgZ = updatedSamples.reduce((s, p) => s + p[2], 0) / 3;
        setFloorPoint([avgX, avgY, avgZ]);
        setPhase('ceiling');
        console.log('[AR-RULER] Floor set at avg Y=', avgY.toFixed(3));
      }
    } else if (phase === 'ceiling') {
      // Collect 3 ceiling samples, then average Y
      const newSample: [number, number, number] = [reticlePosition[0], reticlePosition[1], reticlePosition[2]];
      const updatedSamples = [...ceilingSamples, newSample];
      setCeilingSamples(updatedSamples);
      
      console.log('[AR-RULER] Ceiling sample', updatedSamples.length, '/3, Y=', reticlePosition[1].toFixed(3));
      
      if (updatedSamples.length >= 3) {
        const avgX = updatedSamples.reduce((s, p) => s + p[0], 0) / 3;
        const avgY = updatedSamples.reduce((s, p) => s + p[1], 0) / 3;
        const avgZ = updatedSamples.reduce((s, p) => s + p[2], 0) / 3;
        setCeilingPoint([avgX, avgY, avgZ]);
        setPhase('plan');
        console.log('[AR-RULER] Ceiling set at avg Y=', avgY.toFixed(3));
      }
    } else if (phase === 'plan') {
      // Collect ALL existing nodes for snap check (current shape + completed shapes)
      const allExistingNodes: ARRulerNode[] = [
        ...nodes,
        ...completedShapes.flat()
      ];
      
      // Snap to existing node if within 15cm
      let targetPos: [number, number, number] = [...reticlePosition];
      let snapped = false;
      for (const existingNode of allExistingNodes) {
        const snapDist = Math.sqrt(
          Math.pow(existingNode.position[0] - reticlePosition[0], 2) +
          Math.pow(existingNode.position[2] - reticlePosition[2], 2) // XZ only for floor snap
        );
        if (snapDist < 0.15) {
          targetPos = [...existingNode.position];
          snapped = true;
          break;
        }
      }
      
      // Don't add if identical to last node
      if (nodes.length > 0) {
         const lastNode = nodes[nodes.length - 1];
         const dist = Math.sqrt(
            Math.pow(lastNode.position[0] - targetPos[0], 2) +
            Math.pow(lastNode.position[1] - targetPos[1], 2) +
            Math.pow(lastNode.position[2] - targetPos[2], 2)
         );
         if (dist < 0.01) return;
      }
      
      const newNode: ARRulerNode = {
        id: Date.now().toString(),
        position: targetPos,
      };
      setNodes(prev => [...prev, newNode]);
    }

    // Feedback animation ring
    const id = Date.now();
    setRings(prev => [...prev, { id, position: [...reticlePosition] }]);
    
    setTimeout(() => {
       setRings(prev => prev.filter(r => r.id !== id));
    }, 1000);
  }, [reticlePosition, phase, planes, nodes, completedShapes]);

  const undoLastNode = useCallback(() => {
    if (phase === 'plan') {
       if (nodes.length > 0) {
         setNodes(prev => prev.slice(0, -1));
       } else {
         setCeilingPoint(null);
         setCeilingSamples([]);
         setPhase('ceiling');
       }
    } else if (phase === 'ceiling') {
       if (ceilingSamples.length > 0) {
         setCeilingSamples(prev => prev.slice(0, -1));
       } else {
         setFloorPoint(null);
         setFloorSamples([]);
         setPhase('floor');
       }
    } else if (phase === 'floor') {
       if (floorSamples.length > 0) {
         setFloorSamples(prev => prev.slice(0, -1));
       }
    }
  }, [phase, nodes, floorSamples, ceilingSamples]);

  const closePlan = useCallback(() => {
    if (phase === 'plan' && nodes.length >= 3) {
      const firstNode = nodes[0];
      const closedShape = [...nodes, { id: Date.now().toString(), position: [...firstNode.position] as [number, number, number] }];
      
      console.log('[AR-RULER] CLOSING SHAPE with', nodes.length, 'nodes. Total completed:', completedShapes.length + 1);
      
      setCompletedShapes(prev => [...prev, closedShape]);
      setNodes([]);
    } else {
      console.log('[AR-RULER] CLOSE REJECTED: phase=', phase, 'nodes=', nodes.length);
    }
  }, [phase, nodes, completedShapes]);

  const clearNodes = useCallback(() => {
    setNodes([]);
    setCompletedShapes([]);
    setFloorPoint(null);
    setCeilingPoint(null);
    setFloorSamples([]);
    setCeilingSamples([]);
    setPhase('floor');
  }, []);

  const onAnchorFound = useCallback((anchor: any) => {
    if (anchor.type === "plane") {
      console.log('[AR-RULER] PLANE FOUND:', anchor.anchorId, anchor.alignment, 
        'center:', anchor.center, 'w:', anchor.width, 'h:', anchor.height,
        'vertices:', anchor.vertices ? anchor.vertices.length : 'NONE',
        'keys:', Object.keys(anchor).join(','));
      setPlanes(prev => ({ ...prev, [anchor.anchorId]: anchor }));
    }
  }, []);

  const onAnchorUpdated = useCallback((anchor: any) => {
    if (anchor.type === "plane") {
      setPlanes(prev => ({ ...prev, [anchor.anchorId]: anchor }));
    }
  }, []);

  const onAnchorRemoved = useCallback((anchor: any) => {
    if (anchor.type === "plane") {
      setPlanes(prev => {
        const newPlanes = { ...prev };
        delete newPlanes[anchor.anchorId];
        return newPlanes;
      });
    }
  }, []);

  // Compute real-time distance from camera to the reticle intersection point
  const distanceToReticle = (cameraPosition && reticlePosition) 
    ? Math.sqrt(
        Math.pow(cameraPosition[0] - reticlePosition[0], 2) +
        Math.pow(cameraPosition[1] - reticlePosition[1], 2) +
        Math.pow(cameraPosition[2] - reticlePosition[2], 2)
      )
    : null;

  return {
    phase,
    floorPoint,
    ceilingPoint,
    floorSamples,
    ceilingSamples,
    nodes,
    setNodes,
    completedShapes,
    rings,
    planes,
    reticlePosition,
    reticleRotation,
    meshVertices,
    distanceToReticle,
    onHitTest,
    onCameraTransformUpdate,
    onAnchorFound,
    onAnchorUpdated,
    onAnchorRemoved,
    addNodeAtReticle,
    undoLastNode,
    clearNodes,
    closePlan
  };
}
