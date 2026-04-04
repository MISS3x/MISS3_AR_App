// AR Sketch v2 — Clean drawing flow with 2D/3D tool pickers
const BUILD_TAG = 'BUILD-2025-0404-A'; // VISIBLE VERSION TAG
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Modal,
  TextInput, ActivityIndicator, ScrollView, KeyboardAvoidingView, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ARRulerNativeView } from '../../modules/ar-ruler-native';
import { supabase } from '../lib/supabase';

// UUID v4 generator (Hermes doesn't have crypto.randomUUID)
const generateUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

// ═══════════════════════════════════
// TYPES & CONSTANTS
// ═══════════════════════════════════
type Tool2D = 'line' | 'polyline' | 'rect' | 'square' | 'circle' | 'ellipse';
type Tool3D = 'box' | 'sphere' | 'cylinder' | 'cone' | 'pyramid';
type ToolFreehand = 'freehand';
type ActionTool = 'select';
type ActiveTool = Tool2D | Tool3D | ToolFreehand | ActionTool | null;
type ToolCategory = '2d' | '3d' | null;

type Phase = 'login' | 'project' | 'sketch' | 'selectMode';
type SelectTab = 'shapes' | 'transform' | 'actions';
type TransformMode = 'move' | 'rotate' | 'scale';

// Drawing step state
interface DrawPoint { x: number; y: number; z: number; }
interface DrawingState {
  step: number;
  points: DrawPoint[];
  toolType: ActiveTool;
}

const TOOLS_2D: { id: Tool2D; icon: string; label: string; steps: string[] }[] = [
  { id: 'line',     icon: '📏', label: 'Line',     steps: ['Tap Point A', 'Tap Point B'] },
  { id: 'polyline', icon: '⌇',  label: 'Polyline', steps: ['Tap first point', 'Tap next point...', 'Tap first point to close'] },
  { id: 'rect',     icon: '▭',  label: 'Rect',     steps: ['Tap corner A', 'Tap corner B (edge)', 'Pull width'] },
  { id: 'square',   icon: '◻',  label: 'Square',   steps: ['Tap corner A', 'Tap to set size'] },
  { id: 'circle',   icon: '○',  label: 'Circle',   steps: ['Tap center', 'Tap to set radius'] },
  { id: 'ellipse',  icon: '⬯',  label: 'Ellipse',  steps: ['Tap center', 'Tap for width', 'Tap for height'] },
];

const TOOLS_3D: { id: Tool3D; icon: string; label: string; steps: string[] }[] = [
  { id: 'box',      icon: '🧊', label: 'Box',      steps: ['Tap corner A', 'Tap corner B (edge)', 'Pull width', 'Pull height'] },
  { id: 'sphere',   icon: '🔵', label: 'Sphere',   steps: ['Tap center', 'Pull radius'] },
  { id: 'cylinder', icon: '🛢️', label: 'Cylinder', steps: ['Tap center', 'Pull radius', 'Pull height'] },
  { id: 'cone',     icon: '🔺', label: 'Cone',     steps: ['Tap center', 'Pull radius', 'Pull height'] },
  { id: 'pyramid',  icon: '🔻', label: 'Pyramid',  steps: ['Tap corner A', 'Tap opposite corner', 'Pull height'] },
];

const SHAPE_COLORS = [
  '#FF4136', '#FF851B', '#FFDC00', '#2ECC40', '#0074D9',
  '#B10DC9', '#FF6B6B', '#01FF70', '#7FDBFF', '#F012BE',
];

const AUTO_SAVE_INTERVAL = 15000;

export default function ARSketchScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const rulerRef = useRef<any>(null);

  // Phase
  const [phase, setPhase] = useState<Phase>('login');

  // Auth
  const [userId, setUserId] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Project
  const [projectName, setProjectName] = useState('');
  const [projectData, setProjectData] = useState<{ id: string; name: string } | null>(null);
  const [userProjects, setUserProjects] = useState<any[]>([]);

  // Drawing state (v2)
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [toolCategory, setToolCategory] = useState<ToolCategory>(null);
  const [expandedPicker, setExpandedPicker] = useState<ToolCategory>(null);

  // Freehand state
  const [freehandThickness, setFreehandThickness] = useState<number>(0.05);
  const [isDrawingFreehand, setIsDrawingFreehand] = useState(false);
  const [drawState, setDrawState] = useState<DrawingState>({ step: 0, points: [], toolType: null });
  const [shapes, setShapes] = useState<any[]>([]);

  // SELECT & MOVE modes
  const [selectActive, setSelectActive] = useState(false);
  const [moveActive, setMoveActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sketchShapeList, setSketchShapeList] = useState<any[]>([]);
  const [transformMode, setTransformMode] = useState<TransformMode>('move');
  const [transformStep, setTransformStep] = useState(0.1);

  // Mesh controls
  const [showMesh, setShowMesh] = useState(true);
  const [showWire, setShowWire] = useState(false);

  // Auto-save
  const autoSaveRef = useRef<any>(null);
  const floorplanTimerRef = useRef<any>(null);
  const [floorplanId, setFloorplanId] = useState<string | null>(null);

  // ═══════════════════════════════════
  // AUTH
  // ═══════════════════════════════════
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserId(session.user.id);
        setPhase('project');
        loadUserProjects(session.user.id);
      }
    })();
    return () => {
      if (autoSaveRef.current) clearInterval(autoSaveRef.current);
      if (floorplanTimerRef.current) clearInterval(floorplanTimerRef.current);
    };
  }, []);

  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) { setLoginError('Fill email & password'); return; }
    setLoginLoading(true); setLoginError(null);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(), password: loginPassword,
    });
    setLoginLoading(false);
    if (error) { setLoginError(error.message); return; }
    setUserId(data.user.id);
    setPhase('project');
    loadUserProjects(data.user.id);
  };

  // ═══════════════════════════════════
  // PROJECTS
  // ═══════════════════════════════════
  const loadUserProjects = async (uid: string) => {
    const { data } = await supabase.from('ar_projects')
      .select('id, name, created_at')
      .eq('user_id', uid)
      .eq('tool_type', 'sketch')
      .order('created_at', { ascending: false })
      .limit(20);
    setUserProjects(data || []);
  };

  const createProject = async () => {
    if (!projectName.trim() || !userId) return;
    const { data, error } = await supabase.from('ar_projects').insert({
      id: generateUUID(), name: projectName.trim(), user_id: userId, tool_type: 'sketch',
    }).select('id, name').single();
    if (error) { Alert.alert('Error', error.message); return; }
    setProjectData(data);
    setPhase('sketch');
    startAutoSave(data.id);
    startBackgroundFloorPlan(data.id, userId);
  };

  const loadProject = async (proj: any) => {
    setProjectData({ id: proj.id, name: proj.name });
    setPhase('sketch');
    startAutoSave(proj.id);
    if (userId) startBackgroundFloorPlan(proj.id, userId);
  };

  // ═══════════════════════════════════
  // BACKGROUND FLOOR PLAN
  // ═══════════════════════════════════
  const startBackgroundFloorPlan = async (projId: string, uid: string) => {
    try {
      await rulerRef.current?.startRoomScan();
      const { data: existing } = await supabase.from('ar_tape_floorplan')
        .select('id').eq('project_id', projId).eq('is_live', true).limit(1).single();

      let fpId = existing?.id;
      if (!fpId) {
        const { data: inserted, error } = await supabase.from('ar_tape_floorplan').insert({
          project_id: projId, user_id: uid, is_live: true,
        }).select('id').single();
        if (error) { console.warn('[Sketch] floorplan INSERT failed:', error.message); return; }
        fpId = inserted?.id;
      }
      setFloorplanId(fpId);

      floorplanTimerRef.current = setInterval(async () => {
        try {
          const rpData = await rulerRef.current?.exportRoomPlanData?.();
          if (rpData && fpId) {
            await supabase.from('ar_tape_floorplan').update({
              walls: rpData.walls || [], floors: rpData.floors || [],
              doors: rpData.doors || [], windows: rpData.windows || [],
              updated_at: new Date().toISOString(),
            }).eq('id', fpId);
          }
        } catch {}
      }, 15000);
    } catch (e: any) {
      console.warn('[Sketch] Background floorplan failed:', e.message);
    }
  };

  // ═══════════════════════════════════
  // AUTO-SAVE — ar_sketch_objects
  // ═══════════════════════════════════
  const startAutoSave = (projId: string) => {
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    autoSaveRef.current = setInterval(() => syncAllShapes(projId), AUTO_SAVE_INTERVAL);
  };

  // Immediate INSERT when shape is completed
  const saveShapeToDb = async (shape: any) => {
    const pid = projectData?.id;
    if (!pid || !userId) return;

    try {
      const color = SHAPE_COLORS[shapes.length % SHAPE_COLORS.length];
      const { error } = await supabase.from('ar_sketch_objects').insert({
        project_id: pid,
        user_id: userId,
        shape_type: shape.type || 'line',
        name: `${(shape.type || 'Shape').charAt(0).toUpperCase() + (shape.type || 'Shape').slice(1)}_${String(shapes.length + 1).padStart(2, '0')}`,
        points: shape.points || [],
        is_closed: shape.closed || false,
        height: shape.height || null,
        radius: shape.radius || null,
        radius2: shape.radius2 || null,
        position: shape.position || null,
        rotation: shape.rotation || null,
        scale: shape.scale || null,
        color: color,
        sort_order: shapes.length,
      });
      if (error) console.warn('[Sketch] DB insert failed:', error.message);
      else console.log('[Sketch] Shape saved to DB:', shape.type);
    } catch (e: any) {
      console.warn('[Sketch] DB insert error:', e.message);
    }
  };

  // Periodic full sync — upsert all native shapes
  const syncAllShapes = async (projId?: string) => {
    const pid = projId || projectData?.id;
    if (!pid || !userId) return;

    try {
      const nativeShapes = await rulerRef.current?.getCurrentShapes();
      if (!nativeShapes || nativeShapes.length === 0) return;

      for (let i = 0; i < nativeShapes.length; i++) {
        const s = nativeShapes[i];
        const color = SHAPE_COLORS[i % SHAPE_COLORS.length];
        const shapeType = s.closed ? (s.extrusionHeight ? 'extrusion' : 'polygon') : 'line';

        await supabase.from('ar_sketch_objects').upsert({
          project_id: pid,
          user_id: userId,
          shape_type: shapeType,
          name: s.label || `Shape_${String(i + 1).padStart(2, '0')}`,
          points: s.points || [],
          is_closed: s.closed || false,
          height: s.extrusionHeight || null,
          color: color,
          sort_order: i,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id', ignoreDuplicates: false });
      }

      console.log('[Sketch] Synced', nativeShapes.length, 'shapes to DB');
    } catch (e: any) {
      console.warn('[Sketch] Sync failed:', e.message);
    }
  };

  // ═══════════════════════════════════
  // V2 DRAWING ACTIONS
  // ═══════════════════════════════════

  const resetDrawing = () => {
    setDrawState({ step: 0, points: [], toolType: null });
    try { rulerRef.current?.clearShapePreview?.(); } catch {}
  };

  const updatePreview = (t: ActiveTool, currentPoints: DrawPoint[]) => {
    if (!t || currentPoints.length === 0 || t === 'freehand') {
      rulerRef.current?.clearShapePreview?.();
      return;
    }
    // Cancel any in-progress drawing first
    if (drawState.step > 0) {
      rulerRef.current?.clearCurrentShape?.().catch(() => {});
    }
    try {
      const pts = currentPoints.map((p: DrawPoint) => ({ x: p.x, y: p.y, z: p.z }));
      rulerRef.current?.setPreviewShape?.(t, pts);
    } catch {}
  };

  const handleSelectTool = (tool: ActiveTool, category: ToolCategory) => {
    if (tool === 'select') {
      handleStartSelect();
      return;
    }
    // Cancel any in-progress drawing first
    if (drawState.step > 0) {
      rulerRef.current?.clearCurrentShape?.().catch(() => {});
    }
    setActiveTool(tool);
    setToolCategory(category);
    setExpandedPicker(null);
    resetDrawing();
  };

  const getStatusText = (): string => {
    if (!activeTool) return 'Select a tool to start drawing';
    const tool2d = TOOLS_2D.find(t => t.id === activeTool);
    const tool3d = TOOLS_3D.find(t => t.id === activeTool);
    const toolDef = tool2d || tool3d;
    if (!toolDef) return 'Ready';
    const stepIdx = Math.min(drawState.step, toolDef.steps.length - 1);
    return toolDef.steps[stepIdx] || 'Ready';
  };

  // ═══════════════════════════════════
  // HELPER: Build polygon from points
  // ═══════════════════════════════════

  // Generate circle points on a plane (Y-up, XZ floor by default)
  const generateCirclePoints = (center: DrawPoint, radius: number, segments = 32): DrawPoint[] => {
    const pts: DrawPoint[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      pts.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y,
        z: center.z + Math.sin(angle) * radius,
      });
    }
    return pts;
  };

  // Generate rectangle from 3 points: A=corner1, B=corner2 (top edge), C=sets width perpendicular
  const generateRectPoints = (a: DrawPoint, b: DrawPoint, c: DrawPoint): DrawPoint[] => {
    // AB = top edge direction
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const abLen = Math.sqrt(abx * abx + abz * abz) || 0.001;
    // Perpendicular direction (rotated 90°)
    const perpx = -abz / abLen;
    const perpz = abx / abLen;
    // Project C onto perpendicular to get width
    const acx = c.x - a.x;
    const acz = c.z - a.z;
    const width = acx * perpx + acz * perpz;
    return [
      { x: a.x, y: a.y, z: a.z },
      { x: b.x, y: a.y, z: b.z },
      { x: b.x + perpx * width, y: a.y, z: b.z + perpz * width },
      { x: a.x + perpx * width, y: a.y, z: a.z + perpz * width },
    ];
  };

  // For square: force equal sides from point A, using distance to B
  const generateSquarePoints = (a: DrawPoint, b: DrawPoint): DrawPoint[] => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const side = Math.max(Math.abs(dx), Math.abs(dz));
    const sx = dx >= 0 ? side : -side;
    const sz = dz >= 0 ? side : -side;
    return [
      { x: a.x, y: a.y, z: a.z },
      { x: a.x + sx, y: a.y, z: a.z },
      { x: a.x + sx, y: a.y, z: a.z + sz },
      { x: a.x, y: a.y, z: a.z + sz },
    ];
  };

  // Build a closed polygon shape from points array via native bridge
  const buildPolygonShape = async (pts: DrawPoint[], label: string) => {
    try {
      // Clear any current drawing, then add all points + close
      await rulerRef.current?.clearCurrentShape?.();
      for (const p of pts) {
        await rulerRef.current?.addPointAt?.(p.x, p.y, p.z);
      }
      await rulerRef.current?.closeShape();
    } catch (e: any) {
      // Fallback: just add each point normally if addPointAt isn't available
      console.warn('[Sketch] buildPolygonShape fallback:', e.message);
    }
  };

  // ═══════════════════════════════════
  // MAIN TAP HANDLER — per-tool logic
  // ═══════════════════════════════════
  const handleTap = async () => {
    if (!activeTool || activeTool === 'select') return;

    try {
      // Only POLYLINE uses native addPoint() (orange polyline).
      // Everything else (LINE, RECT, BOX, etc.) uses getCursorPosition() + wireframe preview.
      const needsNativePoint = activeTool === 'polyline';
      
      let point: DrawPoint;
      if (needsNativePoint) {
        const result = await rulerRef.current?.addPoint();
        if (!result) return;
        point = { x: result.x || 0, y: result.y || 0, z: result.z || 0 };
      } else {
        const pos = await rulerRef.current?.getCursorPosition?.();
        if (!pos) return;
        point = { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 };
      }
      
      const newPoints = [...drawState.points, point];
      const newStep = drawState.step + 1;

      switch (activeTool) {

        // ═══ LINE: 2 taps (unchained), white wireframe preview ═══
        case 'line': {
          if (newStep >= 2) {
            // Build a 2-point line via native bridge (same as RECT)
            await buildPolygonShape(newPoints, `Line_${shapes.length}`);
            const shape = { type: 'line', points: newPoints };
            setShapes(prev => [...prev, shape]);
            saveShapeToDb(shape);
            resetDrawing(); // step=0, points=[], activeTool stays 'line'
            return;
          }
          break;
        }

        // ═══ POLYLINE: N taps, close on first point ═══
        case 'polyline': {
          if (newPoints.length >= 3) {
            const first = newPoints[0];
            const dist = Math.sqrt(
              (point.x - first.x) ** 2 + (point.y - first.y) ** 2 + (point.z - first.z) ** 2
            );
            if (dist < 0.05) {
              Alert.alert('Uzavřít tvar?', 'Spojit s prvním bodem?', [
                { text: 'Ne', style: 'cancel' },
                { text: 'Ano', onPress: async () => {
                  await rulerRef.current?.closeShape();
                  const shape = { type: 'polygon', points: newPoints, closed: true };
                  setShapes(prev => [...prev, shape]);
                  saveShapeToDb(shape);
                  resetDrawing();
                }},
              ]);
              return;
            }
          }
          break;
        }

        // ═══ RECTANGLE: 3 taps (A + B = top edge, C = width) ═══
        case 'rect': {
          if (newStep === 2) {
            // Edge AB defined, wait for width
            setDrawState({ step: newStep, points: newPoints, toolType: activeTool });
            return;
          }
          if (newStep >= 3) {
            const rectPts = generateRectPoints(newPoints[0], newPoints[1], newPoints[2]);
            await buildPolygonShape(rectPts, `Rect_${shapes.length}`);
            const shape = { type: 'rect', points: rectPts, closed: true };
            setShapes(prev => [...prev, shape]);
            saveShapeToDb(shape);
            resetDrawing();
            return;
          }
          break;
        }

        // ═══ SQUARE: 2 taps → force 1:1 ratio ═══
        case 'square': {
          if (newStep >= 2) {
            const sqPts = generateSquarePoints(newPoints[0], newPoints[1]);
            await buildPolygonShape(sqPts, `Square_${shapes.length}`);
            const shape = { type: 'square', points: sqPts, closed: true };
            setShapes(prev => [...prev, shape]);
            saveShapeToDb(shape);
            resetDrawing();
            return;
          }
          break;
        }

        // ═══ CIRCLE: 2 taps (center + radius) → generate polygon ═══
        case 'circle': {
          if (newStep >= 2) {
            const radius = Math.sqrt(
              (point.x - newPoints[0].x) ** 2 + (point.z - newPoints[0].z) ** 2
            );
            const circlePts = generateCirclePoints(newPoints[0], radius || 0.1, 32);
            await buildPolygonShape(circlePts, `Circle_${shapes.length}`);
            const shape = { type: 'circle', points: circlePts, closed: true, radius };
            setShapes(prev => [...prev, shape]);
            saveShapeToDb(shape);
            resetDrawing();
            return;
          }
          break;
        }

        // ═══ ELLIPSE: 3 taps (center + X radius + Y radius) ═══
        case 'ellipse': {
          if (newStep >= 3) {
            const rx = Math.sqrt(
              (newPoints[1].x - newPoints[0].x) ** 2 + (newPoints[1].z - newPoints[0].z) ** 2
            ) || 0.1;
            const ry = Math.sqrt(
              (point.x - newPoints[0].x) ** 2 + (point.z - newPoints[0].z) ** 2
            ) || 0.1;
            const center = newPoints[0];
            const segments = 32;
            const ellipsePts: DrawPoint[] = [];
            for (let i = 0; i < segments; i++) {
              const angle = (i / segments) * Math.PI * 2;
              ellipsePts.push({
                x: center.x + Math.cos(angle) * rx,
                y: center.y,
                z: center.z + Math.sin(angle) * ry,
              });
            }
            await buildPolygonShape(ellipsePts, `Ellipse_${shapes.length}`);
            const shape = { type: 'ellipse', points: ellipsePts, closed: true, radius: rx, radius2: ry };
            setShapes(prev => [...prev, shape]);
            saveShapeToDb(shape);
            resetDrawing();
            return;
          }
          break;
        }


        // ═══ BOX: 4 taps (A + B = edge, width, height) ═══
        case 'box': {
          if (newStep === 2 || newStep === 3) {
            // Step 2: edge defined, wait for width. Step 3: base complete, wait for height
            setDrawState({ step: newStep, points: newPoints, toolType: activeTool });
            return;
          }
          if (newStep >= 4) {
            // Compute base rect from 3-point system (same as rect)
            const a = newPoints[0], b = newPoints[1], c = newPoints[2];
            const abx = b.x - a.x, abz = b.z - a.z;
            const abLen = Math.sqrt(abx * abx + abz * abz) || 0.001;
            const perpx = -abz / abLen, perpz = abx / abLen;
            const acx = c.x - a.x, acz = c.z - a.z;
            const w = acx * perpx + acz * perpz;
            const corners = [
              a, b,
              { x: b.x + perpx * w, y: a.y, z: b.z + perpz * w },
              { x: a.x + perpx * w, y: a.y, z: a.z + perpz * w },
            ];
            const height = Math.abs(newPoints[3].y - a.y) || 0.5;
            const cx = (corners[0].x + corners[2].x) / 2;
            const cy = a.y + height / 2;
            const cz = (corners[0].z + corners[2].z) / 2;

            await rulerRef.current?.addPrimitiveAt?.(
              'cube',
              { x: cx, y: cy, z: cz },
              { width: abLen, height, depth: Math.abs(w) },
              `Box_${shapes.length}`
            );
            const shape = {
              type: 'box', points: corners,
              position: { x: cx, y: cy, z: cz },
              scale: { x: abLen, y: height, z: Math.abs(w) },
              height,
            };
            setShapes(prev => [...prev, shape]);
            saveShapeToDb(shape);
            resetDrawing();
            return;
          }
          break;
        }

        // ═══ SPHERE: 2 taps (center + radius) ═══
        case 'sphere': {
          if (newStep >= 2) {
            const radius = Math.sqrt(
              (point.x - newPoints[0].x) ** 2 + (point.y - newPoints[0].y) ** 2 + (point.z - newPoints[0].z) ** 2
            ) || 0.25;
            await rulerRef.current?.addPrimitiveAt?.(
              'sphere',
              { x: newPoints[0].x, y: newPoints[0].y, z: newPoints[0].z },
              { radius },
              `Sphere_${shapes.length}`
            );
            const shape = {
              type: 'sphere', points: newPoints, radius,
              position: { x: newPoints[0].x, y: newPoints[0].y, z: newPoints[0].z },
            };
            setShapes(prev => [...prev, shape]);
            saveShapeToDb(shape);
            resetDrawing();
            return;
          }
          break;
        }

        // ═══ CYLINDER: 3 taps (center + radius + height) ═══
        case 'cylinder': {
          if (newStep === 2) {
            // Radius defined, wait for height
            setDrawState({ step: newStep, points: newPoints, toolType: activeTool });
            return;
          }
          if (newStep >= 3) {
            const radius = Math.sqrt(
              (newPoints[1].x - newPoints[0].x) ** 2 + (newPoints[1].z - newPoints[0].z) ** 2
            ) || 0.25;
            const height = Math.abs(newPoints[2].y - newPoints[0].y) || 0.5;
            await rulerRef.current?.addPrimitiveAt?.(
              'cylinder',
              { x: newPoints[0].x, y: newPoints[0].y + height / 2, z: newPoints[0].z },
              { radius, height },
              `Cylinder_${shapes.length}`
            );
            const shape = {
              type: 'cylinder', points: newPoints, radius, height,
              position: { x: newPoints[0].x, y: newPoints[0].y + height / 2, z: newPoints[0].z },
            };
            setShapes(prev => [...prev, shape]);
            saveShapeToDb(shape);
            resetDrawing();
            return;
          }
          break;
        }

        // ═══ CONE: 3 taps (center + radius + height) ═══
        case 'cone': {
          if (newStep === 2) {
            setDrawState({ step: newStep, points: newPoints, toolType: activeTool });
            return;
          }
          if (newStep >= 3) {
            const radius = Math.sqrt(
              (newPoints[1].x - newPoints[0].x) ** 2 + (newPoints[1].z - newPoints[0].z) ** 2
            ) || 0.25;
            const height = Math.abs(newPoints[2].y - newPoints[0].y) || 0.5;
            await rulerRef.current?.addPrimitiveAt?.(
              'cone',
              { x: newPoints[0].x, y: newPoints[0].y + height / 2, z: newPoints[0].z },
              { radius, height },
              `Cone_${shapes.length}`
            );
            const shape = {
              type: 'cone', points: newPoints, radius, height,
              position: { x: newPoints[0].x, y: newPoints[0].y + height / 2, z: newPoints[0].z },
            };
            setShapes(prev => [...prev, shape]);
            saveShapeToDb(shape);
            resetDrawing();
            return;
          }
          break;
        }

        // ═══ PYRAMID: 3 taps (2 base corners + height) ═══
        case 'pyramid': {
          if (newStep === 2) {
            setDrawState({ step: newStep, points: newPoints, toolType: activeTool });
            return;
          }
          if (newStep >= 3) {
            const baseA = newPoints[0];
            const baseB = newPoints[1];
            const height = Math.abs(newPoints[2].y - baseA.y) || 0.5;
            const radius = Math.sqrt((baseB.x - baseA.x) ** 2 + (baseB.z - baseA.z) ** 2) / 2 || 0.25;
            await rulerRef.current?.addPrimitiveAt?.(
              'cone',
              { x: (baseA.x + baseB.x) / 2, y: baseA.y + height / 2, z: (baseA.z + baseB.z) / 2 },
              { radius, height },
              `Pyramid_${shapes.length}`
            );
            const shape = {
              type: 'pyramid', points: newPoints, height,
              position: { x: (baseA.x + baseB.x) / 2, y: baseA.y + height / 2, z: (baseA.z + baseB.z) / 2 },
            };
            setShapes(prev => [...prev, shape]);
            saveShapeToDb(shape);
            resetDrawing();
            return;
          }
          break;
        }
      }

      setDrawState({ step: newStep, points: newPoints, toolType: activeTool });
      // Set real-time wireframe preview for shape tools
      updatePreview(activeTool, newPoints);
    } catch (e: any) {
      console.warn('[Sketch] tap failed:', e.message);
    }
  };

  const handleUndo = async () => {
    try {
      await rulerRef.current?.undoLastPoint();
      setDrawState(prev => ({
        ...prev,
        step: Math.max(0, prev.step - 1),
        points: prev.points.slice(0, -1),
      }));
    } catch {}
  };

  const handleCancel = async () => {
    try { await rulerRef.current?.clearCurrentShape?.(); } catch {}
    resetDrawing();
  };

  const handleDone = async () => {
    try {
      await rulerRef.current?.saveOpenShape();
      const shape = { type: 'polyline', points: drawState.points };
      setShapes(prev => [...prev, shape]);
      saveShapeToDb(shape);
    } catch {}
    resetDrawing();
  };

  const handleClose = async () => {
    try {
      await rulerRef.current?.closeShape();
      const shape = { type: 'polygon', points: drawState.points, closed: true };
      setShapes(prev => [...prev, shape]);
      saveShapeToDb(shape);
    } catch {}
    resetDrawing();
  };

  // ═══════════════════════════════════
  // POLYLINE CLOSE & FREEHAND
  // ═══════════════════════════════════

  const handleClosePolyline = async () => {
    if (activeTool !== 'polyline' || drawState.points.length < 2) return;
    const finalShape = {
      type: 'polyline',
      points: drawState.points,
      closed: true, // we could implement CSG polygon extrusion if closed
    };
    const shapeDict = await rulerRef.current?.closeShape?.();
    
    // We keep polyline in DB as a group of points and flush sketch shapes
    setShapes(prev => [...prev, finalShape]);
    saveShapeToDb(finalShape);
    
    setDrawState({ step: 0, points: [], toolType: 'polyline' });
    rulerRef.current?.clearShapePreview?.();
    rulerRef.current?.clearCurrentShape?.();
  };

  const handleFreehandPressIn = async () => {
    setIsDrawingFreehand(true);
    const color = SHAPE_COLORS[shapes.length % SHAPE_COLORS.length];
    await rulerRef.current?.startFreehandStroke?.(freehandThickness, color);
  };

  const handleFreehandPressOut = async () => {
    setIsDrawingFreehand(false);
    const label = `Freehand_${String(shapes.length + 1).padStart(2, '0')}`;
    const shapeData = await rulerRef.current?.stopFreehandStroke?.(label);
    if (shapeData) {
      const dbShape = {
         type: 'freehand',
         points: shapeData.sourcePoints || [],
         closed: false,
         height: freehandThickness,
      };
      setShapes(prev => [...prev, dbShape]);
      saveShapeToDb(dbShape);
      syncAllShapes();
    }
  };

  // ═══════════════════════════════════
  // SAVE & EXIT
  // ═══════════════════════════════════
  const handleSaveAndExit = async () => {
    if (projectData?.id) await syncAllShapes(projectData.id);
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    if (floorplanTimerRef.current) clearInterval(floorplanTimerRef.current);
    rulerRef.current?.stopRoomScan?.().catch(() => {});
    // Go back to project list, or navigate back if possible
    try {
      if (navigation?.goBack) navigation.goBack();
      else setPhase('project');
    } catch {
      setPhase('project');
    }
  };

  // ═══════════════════════════════════
  // SELECT MODE
  // ═══════════════════════════════════
  const handleToggleSelect = async () => {
    if (selectActive) {
      // Deactivate select
      setSelectActive(false);
      setMoveActive(false);
      try { await rulerRef.current?.deselectAllSketchShapes?.(); } catch {}
      setSelectedIds([]);
      return;
    }
    // Activate select — load shape list
    setSelectActive(true);
    setMoveActive(false);
    setActiveTool(null);
    setToolCategory(null);
    setExpandedPicker(null);
    resetDrawing();
    await refreshShapeList();
  };

  const refreshShapeList = async () => {
    try {
      const csgShapes = await rulerRef.current?.getSketchShapes?.() || [];
      const nativeShapes = await rulerRef.current?.getCurrentShapes?.() || [];
      const all = [
        ...csgShapes.map((s: any) => ({ ...s, _src: 'csg' })),
        ...nativeShapes.map((s: any, i: number) => ({ ...s, id: s.id || `shape_${i}`, _src: 'native' })),
      ];
      setSketchShapeList(all);
    } catch {}
  };

  const handleToggleShapeSelection = async (id: string) => {
    try {
      await rulerRef.current?.toggleSketchShapeSelection?.(id);
      setSelectedIds(prev => 
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      );
    } catch {}
  };

  const handleDeselectAll = async () => {
    try { await rulerRef.current?.deselectAllSketchShapes?.(); } catch {}
    setSelectedIds([]);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    Alert.alert('Smazat?', `Smazat ${selectedIds.length} objekt(ů)?`, [
      { text: 'Ne', style: 'cancel' },
      { text: 'Ano', style: 'destructive', onPress: async () => {
        try { await rulerRef.current?.deleteSelectedSketchShapes?.(); } catch {}
        setSelectedIds([]);
        await refreshShapeList();
      }},
    ]);
  };
  // ═══════════════════════════════════
  // BOOLEAN CSG & EXTRUSIONS
  // ═══════════════════════════════════

  const handleBooleanOp = async (op: 'union' | 'subtract' | 'intersect') => {
    if (selectedIds.length !== 2) {
      Alert.alert('Vyber 2 objekty', 'Boolean operace vyžaduje přesně 2 vybrané objekty.');
      return;
    }
    try {
      let result: any = null;
      if (op === 'union') {
        result = await rulerRef.current?.booleanUnion?.(selectedIds[0], selectedIds[1]);
      } else if (op === 'subtract') {
        result = await rulerRef.current?.booleanSubtract?.(selectedIds[0], selectedIds[1]);
      } else if (op === 'intersect') {
        result = await rulerRef.current?.booleanIntersect?.(selectedIds[0], selectedIds[1]);
      }
      if (result) {
        console.log(`[Sketch] Boolean ${op} → ${result.id}`);
        setSelectedIds([result.id]);
      } else {
        Alert.alert('Chyba', `Boolean ${op} selhal — zkontroluj, zda se objekty překrývají.`);
      }
      await refreshShapeList();
    } catch (e: any) {
      console.warn('[Sketch] Boolean failed:', e.message);
      Alert.alert('Chyba', e.message);
    }
  };

  // ═══════════════════════════════════
  // EXTRUDE
  // ═══════════════════════════════════

  const handleExtrude = async () => {
    if (selectedIds.length !== 1) {
      Alert.alert('Vyber 1 objekt', 'Extrude vyžaduje přesně 1 vybraný plochý objekt.');
      return;
    }
    // Find the shape's points
    const shape = sketchShapeList.find((s: any) => s.id === selectedIds[0]);
    if (!shape || !shape.sourcePoints || shape.sourcePoints.length < 3) {
      Alert.alert('Nelze extrudovat', 'Tento objekt nemá 2D body pro extrusi. Vyber plochý 2D tvar.');
      return;
    }
    // Prompt for height
    Alert.prompt('Výška Extrude', 'Zadej výšku extruse (v metrech):', [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'EXTRUDE', onPress: async (heightStr: string | undefined) => {
        const height = parseFloat(heightStr || '0.5') || 0.5;
        try {
          const result = await rulerRef.current?.extrudeSketchShape?.(
            shape.sourcePoints, height, `${shape.label || 'Shape'}_extruded`
          );
          if (result) {
            // Delete original flat shape
            await rulerRef.current?.deleteSketchShape?.(selectedIds[0]);
            setSelectedIds([result.id]);
            console.log(`[Sketch] Extruded → ${result.id}, h=${height}`);
          }
          await refreshShapeList();
        } catch (e: any) {
          Alert.alert('Chyba', e.message);
        }
      }},
    ], 'plain-text', '0.5');
  };

  // ═══════════════════════════════════
  // MOVE MODE
  // ═══════════════════════════════════
  const handleToggleMove = () => {
    if (selectedIds.length === 0) {
      Alert.alert('Vyber objekty', 'Nejdřív vyber objekty v SELECT módu.');
      return;
    }
    setMoveActive(!moveActive);
  };

  const applyTransform = async (axis: 'x' | 'y' | 'z', direction: 1 | -1) => {
    const delta = transformStep * direction;
    for (const id of selectedIds) {
      try {
        if (transformMode === 'move') {
          const dx = axis === 'x' ? delta : 0;
          const dy = axis === 'y' ? delta : 0;
          const dz = axis === 'z' ? delta : 0;
          await rulerRef.current?.moveSketchShape?.(id, dx, dy, dz);
        } else if (transformMode === 'rotate') {
          const deg = delta * 10; // step * 10 degrees
          const rx = axis === 'x' ? deg : 0;
          const ry = axis === 'y' ? deg : 0;
          const rz = axis === 'z' ? deg : 0;
          await rulerRef.current?.rotateSketchShape?.(id, rx, ry, rz);
        } else if (transformMode === 'scale') {
          const s = 1 + delta;
          const sx = axis === 'x' ? s : 1;
          const sy = axis === 'y' ? s : 1;
          const sz = axis === 'z' ? s : 1;
          await rulerRef.current?.scaleSketchShape?.(id, sx, sy, sz);
        }
      } catch {}
    }
  };

  const handleStartSelect = handleToggleSelect; // backwards compat

  // ═══════════════════════════════════
  // RENDER — single persistent AR view
  // ═══════════════════════════════════
  const isDrawing = drawState.step > 0;
  const isPolyline = activeTool === 'polyline' && drawState.step >= 2;
  const isSketchPhase = phase === 'sketch' || phase === 'selectMode';
  // Multi-step tools that need 3 taps (show step counter)
  const multiStepTools = ['box', 'cylinder', 'cone', 'pyramid', 'rect'];
  const isMultiStep = activeTool ? multiStepTools.includes(activeTool) : false;
  const totalSteps = activeTool === 'box' ? 4 : (isMultiStep || activeTool === 'ellipse' ? 3 : 2);
  const currentStep = drawState.step;

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      {/* VERSION TAG — remove after debug */}
      <Text style={{ position: 'absolute', top: insets.top + 4, left: 8, color: '#FF0000', fontSize: 11, fontWeight: '900', zIndex: 9999 }}>{BUILD_TAG}</Text>
      {/* ═══ PERSISTENT AR VIEW — never unmounts ═══ */}
      <ARRulerNativeView ref={rulerRef} style={{ flex: 1 }}
        showMesh={isSketchPhase ? showMesh : false}
        showWireframe={isSketchPhase ? showWire : false}
        showRoomPlan={isSketchPhase}
        drawingMode="free" />

      {/* ═══ LOGIN OVERLAY ═══ */}
      {phase === 'login' && (
        <View style={S.centerOverlay}>
          <View style={S.card}>
            <Text style={S.cardTitle}>AR Sketch</Text>
            <Text style={S.cardSub}>Sign in to start</Text>
            <Text style={S.label}>EMAIL</Text>
            <TextInput style={S.input} placeholder="email@example.com" placeholderTextColor="#444"
              keyboardType="email-address" autoCapitalize="none" value={loginEmail} onChangeText={setLoginEmail} />
            <Text style={S.label}>PASSWORD</Text>
            <TextInput style={S.input} placeholder="••••••••" placeholderTextColor="#444"
              secureTextEntry value={loginPassword} onChangeText={setLoginPassword} />
            {loginError && <Text style={S.error}>{loginError}</Text>}
            <TouchableOpacity style={S.greenBtn} onPress={handleLogin} disabled={loginLoading}>
              {loginLoading ? <ActivityIndicator color="#000" /> :
                <Text style={S.greenBtnText}>Sign In</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ═══ PROJECT SELECT OVERLAY ═══ */}
      {phase === 'project' && (
        <View style={S.centerOverlay}>
          <KeyboardAvoidingView behavior="padding">
            <View style={S.card}>
              <Text style={S.cardTitle}>AR Sketch</Text>
              <Text style={S.cardSub}>Create or select a project</Text>
              <Text style={S.label}>NEW PROJECT</Text>
              <TextInput style={S.input} placeholder="Project name" placeholderTextColor="#444"
                value={projectName} onChangeText={setProjectName} />
              <TouchableOpacity style={S.greenBtn} onPress={createProject}>
                <Text style={S.greenBtnText}>Create Project</Text>
              </TouchableOpacity>
              {userProjects.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Text style={S.label}>RECENT PROJECTS</Text>
                  <ScrollView style={{ maxHeight: 200 }}>
                    {userProjects.map((p: any) => (
                      <TouchableOpacity key={p.id} style={S.projectRow} onPress={() => loadProject(p)}>
                        <Text style={S.projectName}>{p.name}</Text>
                        <Text style={S.projectDate}>{new Date(p.created_at).toLocaleDateString()}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      )}

      {/* ═══ MAIN SKETCH OVERLAY ═══ */}
      {phase === 'sketch' && (
        <>

          {/* Top: project name + back */}
          <TouchableOpacity style={S.backBtn} onPress={handleSaveAndExit}>
            <Text style={S.backBtnText}>← {projectData?.name || 'Back'}</Text>
          </TouchableOpacity>

          {/* Status bar */}
          <View style={S.statusBar}>
            <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ color: activeTool ? '#fff' : '#888', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                {getStatusText()}
              </Text>
              {isDrawing && (
                <Text style={{ color: '#666', fontSize: 10, textAlign: 'center', marginTop: 2 }}>
                  {drawState.points.length} point{drawState.points.length !== 1 ? 's' : ''} placed
                </Text>
              )}
            </View>
          </View>

          {/* Shape count badge */}
          {shapes.length > 0 && (
            <View style={{ position: 'absolute', top: 8, right: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, zIndex: 10 }}>
              <Text style={{ color: '#aaa', fontSize: 11, fontWeight: '600' }}>{shapes.length} shapes</Text>
            </View>
          )}

          {/* FREEHAND TOOL - HOLD TO DRAW */}
          {activeTool === 'freehand' && (
             <View style={{ position: 'absolute', bottom: insets.bottom + 90, width: '100%', alignItems: 'center', pointerEvents: 'box-none', zIndex: 10 }}>
               <TouchableOpacity
                  onPressIn={handleFreehandPressIn}
                  onPressOut={handleFreehandPressOut}
                  activeOpacity={0.8}
                  style={{
                    backgroundColor: isDrawingFreehand ? '#4CAF50' : 'rgba(255,255,255,0.15)',
                    paddingHorizontal: 30, paddingVertical: 15,
                    borderRadius: 30, borderWidth: 1.5,
                    borderColor: isDrawingFreehand ? '#4CAF50' : '#fff',
                    borderStyle: isDrawingFreehand ? 'solid' : 'dashed',
                  }}
               >
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', textTransform: 'uppercase' }}>
                    {isDrawingFreehand ? 'Drawing...' : 'Hold to Draw'}
                  </Text>
               </TouchableOpacity>

               {/* THICKNESS SLIDER */}
               <View style={{ backgroundColor: 'rgba(0,0,0,0.85)', padding: 15, borderRadius: 16, width: '80%', marginTop: 15 }}>
                  <Text style={{ color: '#fff', fontSize: 12, marginBottom: 10, textAlign: 'center' }}>THICKNESS ({(freehandThickness*100).toFixed(0)}cm)</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <TouchableOpacity onPress={() => setFreehandThickness(Math.max(0.01, freehandThickness - 0.01))} style={{ padding: 10 }}><Text style={{ color: '#fff', fontSize: 20 }}>-</Text></TouchableOpacity>
                      <View style={{ height: 4, flex: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 20 }}>
                          <View style={{ height: 4, width: `${Math.min(100, (freehandThickness / 0.2) * 100)}%`, backgroundColor: '#4CAF50' }} />
                      </View>
                      <TouchableOpacity onPress={() => setFreehandThickness(Math.min(0.3, freehandThickness + 0.01))} style={{ padding: 10 }}><Text style={{ color: '#fff', fontSize: 20 }}>+</Text></TouchableOpacity>
                  </View>
                </View>
             </View>
          )}

          {/* POLYLINE CLOSE BUTTON */}
          {activeTool === 'polyline' && drawState.step >= 2 && (
             <View style={{ position: 'absolute', bottom: insets.bottom + 90, width: '100%', alignItems: 'center', pointerEvents: 'box-none', zIndex: 10 }}>
               <TouchableOpacity
                  onPress={handleClosePolyline}
                  style={{
                    backgroundColor: '#E91E63', paddingHorizontal: 20, paddingVertical: 12,
                    borderRadius: 24
                  }}
               >
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>[ END POLYLINE ]</Text>
               </TouchableOpacity>
             </View>
          )}

          {/* Bottom Controls */}
          <View style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            backgroundColor: 'rgba(10,10,10,0.95)', paddingBottom: insets.bottom + 8,
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 0,
          }}>

            {/* Tool Picker Expansion */}
            {expandedPicker && (
              <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
                  {(expandedPicker === '2d' ? TOOLS_2D : TOOLS_3D).map(tool => (
                    <TouchableOpacity key={tool.id}
                      style={{
                        paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                        backgroundColor: activeTool === tool.id ? (expandedPicker === '2d' ? '#4CAF50' : '#2196F3') : 'rgba(255,255,255,0.06)',
                        borderWidth: 1, borderColor: activeTool === tool.id ? 'transparent' : 'rgba(255,255,255,0.1)',
                        alignItems: 'center', minWidth: 64,
                      }}
                      onPress={() => handleSelectTool(tool.id, expandedPicker)}>
                      <Text style={{ fontSize: 20 }}>{tool.icon}</Text>
                      <Text style={{ color: activeTool === tool.id ? '#000' : '#aaa', fontSize: 9, fontWeight: '700', marginTop: 2 }}>{tool.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* ═══ SELECT PANEL — Object list with checkboxes ═══ */}
            {selectActive && !moveActive && (
              <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ color: '#FF9800', fontSize: 14, fontWeight: '800' }}>👆 SELECT ({selectedIds.length})</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity style={[S.smallBtn, { borderColor: '#888' }]} onPress={handleDeselectAll}>
                      <Text style={[S.smallBtnText, { color: '#888' }]}>ODZNAČIT</Text>
                    </TouchableOpacity>
                    {selectedIds.length > 0 && (
                      <TouchableOpacity style={[S.smallBtn, { borderColor: '#F44336' }]} onPress={handleDeleteSelected}>
                        <Text style={[S.smallBtnText, { color: '#F44336' }]}>🗑 SMAZAT</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* Boolean & Extrude action bar */}
                {selectedIds.length >= 1 && (
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    {selectedIds.length === 2 && (
                      <>
                        <TouchableOpacity style={[S.smallBtn, { borderColor: '#2196F3', backgroundColor: 'rgba(33,150,243,0.1)' }]}
                          onPress={() => handleBooleanOp('union')}>
                          <Text style={[S.smallBtnText, { color: '#2196F3' }]}>∪ UNION</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[S.smallBtn, { borderColor: '#FF5722', backgroundColor: 'rgba(255,87,34,0.1)' }]}
                          onPress={() => handleBooleanOp('subtract')}>
                          <Text style={[S.smallBtnText, { color: '#FF5722' }]}>− SUBTRACT</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[S.smallBtn, { borderColor: '#9C27B0', backgroundColor: 'rgba(156,39,176,0.1)' }]}
                          onPress={() => handleBooleanOp('intersect')}>
                          <Text style={[S.smallBtnText, { color: '#9C27B0' }]}>∩ INTERSECT</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {selectedIds.length === 1 && (
                      <TouchableOpacity style={[S.smallBtn, { borderColor: '#4CAF50', backgroundColor: 'rgba(76,175,80,0.1)' }]}
                        onPress={handleExtrude}>
                        <Text style={[S.smallBtnText, { color: '#4CAF50' }]}>↑ EXTRUDE</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                <ScrollView style={{ maxHeight: 140 }}>
                  {sketchShapeList.length === 0 && (
                    <Text style={{ color: '#555', textAlign: 'center', paddingVertical: 16, fontSize: 12 }}>Žádné objekty</Text>
                  )}
                  {sketchShapeList.map((s: any, i: number) => {
                    const isSelected = selectedIds.includes(s.id);
                    return (
                      <TouchableOpacity key={s.id || i}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 10,
                          paddingVertical: 8, paddingHorizontal: 8,
                          borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
                          backgroundColor: isSelected ? 'rgba(255,152,0,0.1)' : 'transparent',
                          borderRadius: 8,
                        }}
                        onPress={() => handleToggleShapeSelection(s.id)}>
                        <View style={{
                          width: 22, height: 22, borderRadius: 4,
                          backgroundColor: isSelected ? '#FF9800' : 'rgba(255,255,255,0.08)',
                          borderWidth: 1.5, borderColor: isSelected ? '#FF9800' : 'rgba(255,255,255,0.2)',
                          justifyContent: 'center', alignItems: 'center',
                        }}>
                          {isSelected && <Text style={{ color: '#000', fontSize: 14, fontWeight: '900' }}>✓</Text>}
                        </View>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color || SHAPE_COLORS[i % SHAPE_COLORS.length] }} />
                        <Text style={{ color: '#fff', fontSize: 13, flex: 1 }}>{s.label || s.name || `Shape_${i + 1}`}</Text>
                        <Text style={{ color: '#666', fontSize: 10 }}>{s.primitiveType || s.shape_type || 'mesh'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* ═══ MOVE PANEL — Transform controls ═══ */}
            {moveActive && (
              <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
                {/* Transform mode toggle */}
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                  {(['move', 'rotate', 'scale'] as TransformMode[]).map(mode => (
                    <TouchableOpacity key={mode}
                      style={{
                        flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                        backgroundColor: transformMode === mode ? (mode === 'move' ? '#9C27B0' : mode === 'rotate' ? '#FF9800' : '#2196F3') : 'rgba(255,255,255,0.06)',
                        borderWidth: 1, borderColor: transformMode === mode ? 'transparent' : 'rgba(255,255,255,0.1)',
                      }}
                      onPress={() => setTransformMode(mode)}>
                      <Text style={{ color: transformMode === mode ? '#fff' : '#888', fontSize: 11, fontWeight: '800' }}>
                        {mode === 'move' ? '✥ POSUN' : mode === 'rotate' ? '↻ ROTACE' : '⤡ SCALE'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Step size */}
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8, justifyContent: 'center' }}>
                  <Text style={{ color: '#666', fontSize: 10, alignSelf: 'center' }}>Krok:</Text>
                  {[0.01, 0.05, 0.1, 0.5, 1.0].map(step => (
                    <TouchableOpacity key={step}
                      style={{
                        paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
                        backgroundColor: transformStep === step ? '#9C27B0' : 'rgba(255,255,255,0.06)',
                        borderWidth: 1, borderColor: transformStep === step ? '#9C27B0' : 'rgba(255,255,255,0.1)',
                      }}
                      onPress={() => setTransformStep(step)}>
                      <Text style={{ color: transformStep === step ? '#fff' : '#aaa', fontSize: 10, fontWeight: '700' }}>
                        {transformMode === 'rotate' ? `${step * 10}°` : `${step}m`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* ±XYZ Grid */}
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(['x', 'y', 'z'] as const).map(axis => {
                    const colors = { x: '#F44336', y: '#4CAF50', z: '#2196F3' };
                    return (
                      <View key={axis} style={{ flex: 1, gap: 4 }}>
                        <Text style={{ color: colors[axis], fontSize: 11, fontWeight: '900', textAlign: 'center' }}>{axis.toUpperCase()}</Text>
                        <View style={{ flexDirection: 'row', gap: 3 }}>
                          <TouchableOpacity
                            style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: colors[axis] + '44', alignItems: 'center' }}
                            onPress={() => applyTransform(axis, -1)}>
                            <Text style={{ color: colors[axis], fontSize: 16, fontWeight: '900' }}>−</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: colors[axis] + '22', borderWidth: 1, borderColor: colors[axis] + '66', alignItems: 'center' }}
                            onPress={() => applyTransform(axis, 1)}>
                            <Text style={{ color: colors[axis], fontSize: 16, fontWeight: '900' }}>+</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
                <Text style={{ color: '#555', fontSize: 10, textAlign: 'center', marginTop: 6 }}>
                  {selectedIds.length} objekt(ů) • {transformMode === 'move' ? 'posun' : transformMode === 'rotate' ? 'rotace' : 'měřítko'}
                </Text>
              </View>
            )}

            {/* Main bottom bar — [2D] [3D] [SELECT] [MOVE] + TAP + actions */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, gap: 6 }}>
              {/* 2D Button */}
              <TouchableOpacity
                style={{
                  width: 48, height: 48, borderRadius: 14,
                  backgroundColor: toolCategory === '2d' ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.05)',
                  borderWidth: 2, borderColor: toolCategory === '2d' ? '#4CAF50' : 'rgba(255,255,255,0.12)',
                  justifyContent: 'center', alignItems: 'center',
                }}
                onPress={() => { setSelectActive(false); setMoveActive(false); setExpandedPicker(expandedPicker === '2d' ? null : '2d'); }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: toolCategory === '2d' ? '#4CAF50' : '#888' }}>2D</Text>
                <Text style={{ fontSize: 12 }}>▭</Text>
              </TouchableOpacity>

              {/* 3D Button */}
              <TouchableOpacity
                style={{
                  width: 48, height: 48, borderRadius: 14,
                  backgroundColor: toolCategory === '3d' ? 'rgba(33,150,243,0.15)' : 'rgba(255,255,255,0.05)',
                  borderWidth: 2, borderColor: toolCategory === '3d' ? '#2196F3' : 'rgba(255,255,255,0.12)',
                  justifyContent: 'center', alignItems: 'center',
                }}
                onPress={() => { setSelectActive(false); setMoveActive(false); setExpandedPicker(expandedPicker === '3d' ? null : '3d'); }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: toolCategory === '3d' ? '#2196F3' : '#888' }}>3D</Text>
                <Text style={{ fontSize: 12 }}>🧊</Text>
              </TouchableOpacity>

              {/* FREEHAND Button */}
              <TouchableOpacity
                style={{
                  width: 48, height: 48, borderRadius: 14,
                  backgroundColor: activeTool === 'freehand' ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.05)',
                  borderWidth: 2, borderColor: activeTool === 'freehand' ? '#4CAF50' : 'rgba(255,255,255,0.12)',
                  justifyContent: 'center', alignItems: 'center',
                }}
                onPress={() => { setSelectActive(false); setMoveActive(false); setToolCategory(null); setExpandedPicker(null); setActiveTool('freehand'); setDrawState({ step: 0, points: [], toolType: 'freehand' }); rulerRef.current?.clearCurrentShape?.(); }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: activeTool === 'freehand' ? '#4CAF50' : '#888' }}>FREE</Text>
                <Text style={{ fontSize: 12 }}>〰️</Text>
              </TouchableOpacity>

              {/* SELECT Button */}
              <TouchableOpacity
                style={{
                  width: 48, height: 48, borderRadius: 14,
                  backgroundColor: selectActive ? 'rgba(255,152,0,0.15)' : 'rgba(255,255,255,0.05)',
                  borderWidth: 2, borderColor: selectActive ? '#FF9800' : 'rgba(255,255,255,0.12)',
                  justifyContent: 'center', alignItems: 'center',
                }}
                onPress={handleToggleSelect}>
                <Text style={{ fontSize: 14 }}>👆</Text>
                <Text style={{ fontSize: 8, fontWeight: '800', color: selectActive ? '#FF9800' : '#888' }}>SEL</Text>
              </TouchableOpacity>

              {/* MOVE Button */}
              <TouchableOpacity
                style={{
                  width: 48, height: 48, borderRadius: 14,
                  backgroundColor: moveActive ? 'rgba(156,39,176,0.15)' : 'rgba(255,255,255,0.05)',
                  borderWidth: 2, borderColor: moveActive ? '#9C27B0' : 'rgba(255,255,255,0.12)',
                  justifyContent: 'center', alignItems: 'center',
                  opacity: selectedIds.length > 0 ? 1 : 0.4,
                }}
                onPress={handleToggleMove}>
                <Text style={{ fontSize: 14 }}>✥</Text>
                <Text style={{ fontSize: 8, fontWeight: '800', color: moveActive ? '#9C27B0' : '#888' }}>MOVE</Text>
              </TouchableOpacity>

              <View style={{ flex: 1 }} />

              {/* TAP button (drawing mode only) */}
              {activeTool && activeTool !== 'select' && !selectActive && !moveActive && (
                <TouchableOpacity
                  style={{
                    width: 58, height: 58, borderRadius: 29,
                    backgroundColor: toolCategory === '3d' ? '#2196F3' : '#4CAF50',
                    justifyContent: 'center', alignItems: 'center',
                    shadowColor: toolCategory === '3d' ? '#2196F3' : '#4CAF50',
                    shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
                    elevation: 8,
                  }}
                  onPress={handleTap}>
                  <Text style={{ color: '#000', fontSize: 10, fontWeight: '900' }}>TAP</Text>
                  <Text style={{ color: '#000', fontSize: 8, fontWeight: '600' }}>{isDrawing ? `${currentStep + 1}/${totalSteps}` : 'PLACE'}</Text>
                </TouchableOpacity>
              )}

              <View style={{ flex: 1 }} />

              {/* Context actions */}
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {isDrawing && (
                  <TouchableOpacity style={S.smallBtn} onPress={handleUndo}>
                    <Text style={S.smallBtnText}>↩</Text>
                  </TouchableOpacity>
                )}
                {isPolyline && (
                  <TouchableOpacity style={[S.smallBtn, { borderColor: '#FF9800' }]} onPress={handleClose}>
                    <Text style={[S.smallBtnText, { color: '#FF9800' }]}>⬡ CLOSE</Text>
                  </TouchableOpacity>
                )}
                {isPolyline && (
                  <TouchableOpacity style={[S.smallBtn, { borderColor: '#4CAF50' }]} onPress={handleDone}>
                    <Text style={[S.smallBtnText, { color: '#4CAF50' }]}>✓ SAVE</Text>
                  </TouchableOpacity>
                )}
                {isDrawing && (
                  <TouchableOpacity style={[S.smallBtn, { borderColor: '#F44336', backgroundColor: 'rgba(244,67,54,0.1)' }]} onPress={handleCancel}>
                    <Text style={[S.smallBtnText, { color: '#F44336' }]}>✕ CANCEL</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// ═══════════════════════════════════════
// STYLES
// ═══════════════════════════════════════
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  centerOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', padding: 20, zIndex: 30 },

  card: { backgroundColor: 'rgba(10,10,10,0.92)', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', width: '100%', maxWidth: 400 },
  cardTitle: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center' },
  cardSub: { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 16 },

  label: { fontSize: 10, color: '#888', fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  input: { backgroundColor: '#111', borderRadius: 10, padding: 14, color: '#fff', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 10 },
  error: { color: '#F44336', fontSize: 12, textAlign: 'center', marginBottom: 8 },

  greenBtn: { backgroundColor: '#4CAF50', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  greenBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },

  backBtn: { position: 'absolute', top: 50, left: 12, zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  backBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  smallBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.5)' },
  smallBtnText: { color: '#aaa', fontSize: 10, fontWeight: '700' },

  statusBar: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center', zIndex: 10 },

  crosshair: { position: 'absolute', top: '50%', left: '50%', width: 30, height: 30, marginLeft: -15, marginTop: -15, zIndex: 5 },
  crosshairH: { position: 'absolute', top: 14, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.4)' },
  crosshairV: { position: 'absolute', left: 14, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.4)' },
  crosshairDot: { position: 'absolute', top: 12, left: 12, width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50' },

  projectRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  projectName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  projectDate: { color: '#666', fontSize: 12 },
});

