// AR Sketch — SketchUp-style 3D drawing in AR
// Full implementation with tool palette, mesh reading, extrusion, cuts, auto-save
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Modal,
  TextInput, ActivityIndicator, ScrollView, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ARRulerNativeView } from '../../modules/ar-ruler-native';
import { supabase } from '../lib/supabase';

// ═══════════════════════════════════
// TYPES & CONSTANTS
// ═══════════════════════════════════
type Tool = 'line' | 'rect' | 'polygon' | 'freeform' | 'extrude' | 'cut' | 'edgeSnap';
type Phase = 'login' | 'project' | 'sketch' | 'extrudeHeight' | 'cutMode';

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'line',     icon: '📏', label: 'Line' },
  { id: 'rect',     icon: '▭',  label: 'Rect' },
  { id: 'polygon',  icon: '⬡',  label: 'Polygon' },
  { id: 'freeform', icon: '✏️', label: 'Free' },
  { id: 'extrude',  icon: '⬆️', label: 'Extrude' },
  { id: 'cut',      icon: '✂️', label: 'Cut' },
  { id: 'edgeSnap', icon: '🧲', label: 'Snap' },
];

const SHAPE_COLORS = [
  '#FF4136', '#FF851B', '#FFDC00', '#2ECC40', '#0074D9',
  '#B10DC9', '#FF6B6B', '#01FF70', '#7FDBFF', '#F012BE',
];

const AUTO_SAVE_INTERVAL = 15000; // 15s

export default function ARSketchScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const rulerRef = useRef<any>(null);

  // Phase
  const [phase, setPhase] = useState<Phase>('login');

  // Auth
  const [userId, setUserId] = useState<string | null>(null);

  // Login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Project
  const [projectName, setProjectName] = useState('');
  const [projectData, setProjectData] = useState<{ id: string; name: string } | null>(null);
  const [userProjects, setUserProjects] = useState<any[]>([]);

  // Drawing state
  const [activeTool, setActiveTool] = useState<Tool>('polygon');
  const [pointCount, setPointCount] = useState(0);
  const [isClosed, setIsClosed] = useState(false);
  const [shapeCount, setShapeCount] = useState(0);
  const [shapes, setShapes] = useState<any[]>([]); // local shape list

  // Mesh controls
  const [showMesh, setShowMesh] = useState(true);
  const [showWire, setShowWire] = useState(false);

  // Extrude
  const [extrudeHeight, setExtrudeHeight] = useState('');
  const [extrudePoints, setExtrudePoints] = useState<any[]>([]);

  // Cut
  const [cutType, setCutType] = useState<'horizontal' | 'vertical'>('horizontal');
  const [cutHeight, setCutHeight] = useState(0);
  const [cutRotation, setCutRotation] = useState(0);

  // Edge detection
  const [edgeCount, setEdgeCount] = useState(0);

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
      name: projectName.trim(), user_id: userId, tool_type: 'sketch',
    }).select('id, name').single();
    if (error) { Alert.alert('Error', error.message); return; }
    setProjectData(data);
    setPhase('sketch');
    startAutoSave(data.id);
    startBackgroundFloorPlan(data.id, userId);
  };

  const loadProject = async (proj: any) => {
    setProjectData({ id: proj.id, name: proj.name });

    // Load existing shapes from DB
    const { data: dbShapes } = await supabase.from('ar_sketch_shapes')
      .select('*')
      .eq('project_id', proj.id)
      .order('sort_order', { ascending: true });

    if (dbShapes && dbShapes.length > 0) {
      setShapes(dbShapes);
      setShapeCount(dbShapes.length);

      // Load shapes into native view
      const nativeShapes = dbShapes
        .filter((s: any) => s.points?.length >= 2)
        .map((s: any) => ({
          type: s.shape_type === 'line' ? 'line' : 'floor',
          points: s.points,
          closed: s.is_closed,
        }));

      try {
        await rulerRef.current?.loadShapes(nativeShapes);
      } catch (e) {
        console.warn('[Sketch] loadShapes failed:', e);
      }
    }

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
          const rpData = await rulerRef.current?.getRoomPlanData();
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
  // AUTO-SAVE SHAPES
  // ═══════════════════════════════════
  const startAutoSave = (projId: string) => {
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    autoSaveRef.current = setInterval(() => saveShapes(projId), AUTO_SAVE_INTERVAL);
  };

  const saveShapes = async (projId?: string) => {
    const pid = projId || projectData?.id;
    if (!pid || !userId) return;

    try {
      const nativeShapes = await rulerRef.current?.getCurrentShapes();
      if (!nativeShapes || nativeShapes.length === 0) return;

      // Snapshot
      await supabase.from('ar_sketch_snapshots').insert({
        project_id: pid, user_id: userId,
        shapes_json: nativeShapes,
      });

      // Upsert individual shapes
      for (let i = 0; i < nativeShapes.length; i++) {
        const s = nativeShapes[i];
        const color = SHAPE_COLORS[i % SHAPE_COLORS.length];
        const shapeType = s.closed ? (s.extrusionHeight ? 'extrusion' : 'polygon') : 'line';

        await supabase.from('ar_sketch_shapes').upsert({
          project_id: pid,
          user_id: userId,
          shape_type: shapeType,
          name: s.label || `Shape_${String(i + 1).padStart(2, '0')}`,
          points: s.points || [],
          is_closed: s.closed || false,
          height: s.extrusionHeight || null,
          area: s.area || null,
          perimeter: s.perimeter || null,
          color: color,
          sort_order: i,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
      }

      setShapeCount(nativeShapes.length);
      console.log('[Sketch] Auto-saved', nativeShapes.length, 'shapes');
    } catch (e: any) {
      console.warn('[Sketch] Auto-save failed:', e.message);
    }
  };

  // ═══════════════════════════════════
  // DRAWING ACTIONS
  // ═══════════════════════════════════
  const handleAddPoint = async () => {
    try {
      await rulerRef.current?.addPoint();
      setPointCount(prev => prev + 1);

      // For rect tool: auto-close at 4 points
      if (activeTool === 'rect' && pointCount + 1 >= 4) {
        handleCloseShape();
      }
    } catch (e: any) {
      console.warn('[Sketch] addPoint failed:', e.message);
    }
  };

  const handleCloseShape = async () => {
    try {
      const result = await rulerRef.current?.closeShape();
      if (result) {
        setIsClosed(true);
        setShapeCount(prev => prev + 1);
        setShapes(prev => [...prev, { ...result, color: SHAPE_COLORS[prev.length % SHAPE_COLORS.length] }]);

        // Auto-save immediately after closing
        if (projectData?.id) saveShapes(projectData.id);
      }
      // Reset for next shape
      setPointCount(0);
      setIsClosed(false);
    } catch (e: any) {
      console.warn('[Sketch] closeShape failed:', e.message);
    }
  };

  const handleSaveOpen = async () => {
    try {
      const result = await rulerRef.current?.saveOpenShape();
      if (result) {
        setShapeCount(prev => prev + 1);
        setShapes(prev => [...prev, { ...result, color: SHAPE_COLORS[prev.length % SHAPE_COLORS.length] }]);
        if (projectData?.id) saveShapes(projectData.id);
      }
      setPointCount(0);
    } catch (e: any) {
      console.warn('[Sketch] saveOpenShape failed:', e.message);
    }
  };

  const handleUndo = async () => {
    try {
      await rulerRef.current?.undoLastPoint();
      setPointCount(prev => Math.max(0, prev - 1));
    } catch {}
  };

  const handleReset = async () => {
    Alert.alert('Reset', 'Clear all shapes?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => {
        await rulerRef.current?.reset();
        setPointCount(0);
        setShapeCount(0);
        setShapes([]);
        setIsClosed(false);
      }},
    ]);
  };

  // ═══════════════════════════════════
  // EXTRUDE
  // ═══════════════════════════════════
  const handleStartExtrude = () => {
    if (shapeCount === 0) {
      Alert.alert('No shapes', 'Draw a closed polygon first, then extrude it.');
      return;
    }
    setPhase('extrudeHeight');
  };

  const handleApplyExtrude = async () => {
    const h = parseFloat(extrudeHeight);
    if (isNaN(h) || h <= 0) { Alert.alert('Error', 'Enter valid height'); return; }

    try {
      // Get the last closed shape's points
      const nativeShapes = await rulerRef.current?.getCurrentShapes();
      const lastClosed = nativeShapes?.filter((s: any) => s.closed).pop();
      if (!lastClosed) { Alert.alert('Error', 'No closed shape to extrude'); return; }

      await rulerRef.current?.extrudeWall(lastClosed.points, h, `Extrusion_${shapeCount}`);
      setPhase('sketch');
      setExtrudeHeight('');

      if (projectData?.id) saveShapes(projectData.id);
    } catch (e: any) {
      console.warn('[Sketch] extrude failed:', e.message);
      Alert.alert('Error', 'Extrusion failed: ' + e.message);
    }
  };

  // ═══════════════════════════════════
  // CUT
  // ═══════════════════════════════════
  const handleStartCut = async () => {
    try {
      await rulerRef.current?.setCutActive(true, cutType);
      setPhase('cutMode');
    } catch (e: any) {
      console.warn('[Sketch] setCutActive failed:', e.message);
    }
  };

  const handleApplyCut = async () => {
    try {
      const result = await rulerRef.current?.getCutResult();
      if (result) {
        setShapes(prev => [...prev, { ...result, shape_type: 'cut', color: '#F44336' }]);
        if (projectData?.id) saveShapes(projectData.id);
      }
      await rulerRef.current?.clearCut();
      setPhase('sketch');
    } catch (e: any) {
      console.warn('[Sketch] getCutResult failed:', e.message);
    }
  };

  const handleCancelCut = async () => {
    await rulerRef.current?.clearCut();
    setPhase('sketch');
  };

  // ═══════════════════════════════════
  // EDGE DETECTION
  // ═══════════════════════════════════
  const handleEdgeSnap = async () => {
    try {
      const result = await rulerRef.current?.detectEdges(45);
      setEdgeCount(result?.edgeCount || 0);
      if (result?.edgeCount > 0) {
        Alert.alert(
          `${result.edgeCount} edges detected`,
          'Confirm edges as shapes?',
          [
            { text: 'Cancel', onPress: () => rulerRef.current?.clearEdges() },
            { text: 'Confirm', onPress: async () => {
              await rulerRef.current?.confirmEdges();
              if (projectData?.id) saveShapes(projectData.id);
            }},
          ]
        );
      } else {
        Alert.alert('No edges', 'No mesh edges detected. Move closer to surfaces.');
      }
    } catch (e: any) {
      console.warn('[Sketch] detectEdges failed:', e.message);
    }
  };

  // ═══════════════════════════════════
  // SAVE & EXIT
  // ═══════════════════════════════════
  const handleSaveAndExit = async () => {
    if (projectData?.id) {
      await saveShapes(projectData.id);
    }
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    if (floorplanTimerRef.current) clearInterval(floorplanTimerRef.current);
    rulerRef.current?.stopRoomScan?.().catch(() => {});
    navigation.goBack();
  };

  // ═══════════════════════════════════
  // TOOL SELECTION
  // ═══════════════════════════════════
  const selectTool = (tool: Tool) => {
    if (tool === 'extrude') { handleStartExtrude(); return; }
    if (tool === 'cut') { handleStartCut(); return; }
    if (tool === 'edgeSnap') { handleEdgeSnap(); return; }
    setActiveTool(tool);
    // Reset current drawing
    setPointCount(0);
    setIsClosed(false);
  };

  const getDrawingMode = (): 'floor' | 'free' | 'wall' => {
    switch (activeTool) {
      case 'line': case 'freeform': return 'free';
      case 'rect': case 'polygon': return 'floor';
      default: return 'free';
    }
  };

  // ═══════════════════════════════════
  // RENDER: LOGIN
  // ═══════════════════════════════════
  if (phase === 'login') {
    return (
      <View style={[S.container, { paddingTop: insets.top }]}>
        <KeyboardAvoidingView style={S.centerOverlay} behavior="padding">
          <View style={S.card}>
            <Text style={S.cardTitle}>✏️ AR Sketch</Text>
            <Text style={S.cardSub}>Login to start</Text>
            {loginError && <Text style={S.error}>{loginError}</Text>}
            <TextInput style={S.input} placeholder="Email" placeholderTextColor="#555"
              value={loginEmail} onChangeText={setLoginEmail} keyboardType="email-address" autoCapitalize="none" />
            <TextInput style={S.input} placeholder="Password" placeholderTextColor="#555"
              value={loginPassword} onChangeText={setLoginPassword} secureTextEntry />
            <TouchableOpacity style={S.greenBtn} onPress={handleLogin} disabled={loginLoading}>
              {loginLoading ? <ActivityIndicator color="#000" /> : <Text style={S.greenBtnText}>Login</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ═══════════════════════════════════
  // RENDER: PROJECT SELECT
  // ═══════════════════════════════════
  if (phase === 'project') {
    return (
      <View style={[S.container, { paddingTop: insets.top }]}>
        <View style={S.arBg}>
          <ARRulerNativeView ref={rulerRef} style={{ flex: 1 }}
            showMesh={true} showWireframe={false} showRoomPlan={true} drawingMode="free" />
        </View>
        <KeyboardAvoidingView style={S.centerOverlay} behavior="padding">
          <ScrollView style={{ maxHeight: '80%' }} contentContainerStyle={{ padding: 20 }}>
            <View style={S.card}>
              <Text style={S.cardTitle}>✏️ AR Sketch</Text>
              <Text style={S.cardSub}>Create or load a project</Text>

              <Text style={[S.label, { marginTop: 16 }]}>NEW PROJECT</Text>
              <TextInput style={S.input} placeholder="Project name..."
                placeholderTextColor="#555" value={projectName} onChangeText={setProjectName} />
              <TouchableOpacity style={[S.greenBtn, { opacity: projectName.trim() ? 1 : 0.4 }]}
                onPress={createProject} disabled={!projectName.trim()}>
                <Text style={S.greenBtnText}>✏️ Create & Start</Text>
              </TouchableOpacity>

              {userProjects.length > 0 && (
                <>
                  <Text style={[S.label, { marginTop: 20 }]}>LOAD EXISTING</Text>
                  {userProjects.map(p => (
                    <TouchableOpacity key={p.id} style={S.projectRow} onPress={() => loadProject(p)}>
                      <Text style={S.projectName}>{p.name}</Text>
                      <Text style={S.projectDate}>{new Date(p.created_at).toLocaleDateString()}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <TouchableOpacity style={S.backBtn} onPress={() => navigation.goBack()}>
          <Text style={S.backBtnText}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ═══════════════════════════════════
  // RENDER: EXTRUDE HEIGHT INPUT
  // ═══════════════════════════════════
  if (phase === 'extrudeHeight') {
    return (
      <View style={[S.container, { paddingTop: insets.top }]}>
        <View style={{ flex: 1 }}>
          <ARRulerNativeView ref={rulerRef} style={{ flex: 1 }}
            showMesh={showMesh} showWireframe={showWire} showRoomPlan={true} drawingMode={getDrawingMode()} />
        </View>
        <View style={S.centerOverlay} pointerEvents="box-none">
          <KeyboardAvoidingView behavior="padding">
            <View style={S.card}>
              <Text style={S.cardTitle}>⬆️ Extrude Height</Text>
              <TextInput style={[S.input, { textAlign: 'center', fontSize: 28, fontWeight: '700' }]}
                placeholder="2.5" placeholderTextColor="#555" keyboardType="numeric"
                value={extrudeHeight} onChangeText={setExtrudeHeight} autoFocus />
              <Text style={{ color: '#888', textAlign: 'center', fontSize: 12, marginBottom: 12 }}>meters</Text>
              <TouchableOpacity style={S.greenBtn} onPress={handleApplyExtrude}>
                <Text style={S.greenBtnText}>⬆️ Apply Extrusion</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ marginTop: 10, padding: 8 }} onPress={() => setPhase('sketch')}>
                <Text style={{ color: '#F44336', textAlign: 'center', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
    );
  }

  // ═══════════════════════════════════
  // RENDER: CUT MODE
  // ═══════════════════════════════════
  if (phase === 'cutMode') {
    return (
      <View style={[S.container, { paddingTop: insets.top }]}>
        <View style={{ flex: 1 }}>
          <ARRulerNativeView ref={rulerRef} style={{ flex: 1 }}
            showMesh={showMesh} showWireframe={showWire} showRoomPlan={true} drawingMode="free" />
        </View>

        <TouchableOpacity style={S.backBtn} onPress={handleCancelCut}>
          <Text style={S.backBtnText}>← Cancel Cut</Text>
        </TouchableOpacity>

        {/* Cut controls at bottom */}
        <View style={[S.toolBar, { bottom: insets.bottom + 20 }]}>
          <View style={{ alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>✂️ Cut Mode — {cutType}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={[S.toolBtn, cutType === 'horizontal' && S.toolBtnActive]}
                onPress={() => { setCutType('horizontal'); rulerRef.current?.setCutActive(true, 'horizontal'); }}>
                <Text style={S.toolBtnText}>Horizontal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.toolBtn, cutType === 'vertical' && S.toolBtnActive]}
                onPress={() => { setCutType('vertical'); rulerRef.current?.setCutActive(true, 'vertical'); }}>
                <Text style={S.toolBtnText}>Vertical</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={S.greenBtn} onPress={handleApplyCut}>
              <Text style={S.greenBtnText}>✂️ Apply Cut</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ═══════════════════════════════════
  // RENDER: MAIN SKETCH MODE
  // ═══════════════════════════════════
  const canClose = pointCount >= 3 && (activeTool === 'polygon' || activeTool === 'rect');
  const canSave = pointCount >= 2 && (activeTool === 'line' || activeTool === 'freeform');

  return (
    <View style={[S.container, { paddingTop: insets.top }]}>
      <View style={{ flex: 1 }}>
        <ARRulerNativeView ref={rulerRef} style={{ flex: 1 }}
          showMesh={showMesh} showWireframe={showWire} showRoomPlan={true} drawingMode={getDrawingMode()} />

        {/* Back / Save */}
        <TouchableOpacity style={S.backBtn} onPress={handleSaveAndExit}>
          <Text style={S.backBtnText}>← Save</Text>
        </TouchableOpacity>

        {/* Project + shape info */}
        <View style={S.statusBar}>
          <Text style={S.statusName}>{projectData?.name || 'AR Sketch'}</Text>
          <Text style={S.statusType}>
            {TOOLS.find(t => t.id === activeTool)?.icon} {activeTool.toUpperCase()}
            {' · '}{shapeCount} shapes · {pointCount} pts
          </Text>
        </View>

        {/* Crosshair */}
        <View style={S.crosshair} pointerEvents="none">
          <View style={S.crosshairH} />
          <View style={S.crosshairV} />
          <View style={S.crosshairDot} />
        </View>

        {/* Mesh toggle — top right */}
        <View style={{ position: 'absolute', top: 8, right: 12, zIndex: 20, flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity
            style={[S.smallBtn, showMesh && { backgroundColor: '#4CAF50', borderColor: '#4CAF50' }]}
            onPress={() => setShowMesh(!showMesh)}>
            <Text style={[S.smallBtnText, showMesh && { color: '#000' }]}>MESH</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.smallBtn, showWire && { backgroundColor: '#2196F3', borderColor: '#2196F3' }]}
            onPress={() => setShowWire(!showWire)}>
            <Text style={[S.smallBtnText, showWire && { color: '#000' }]}>WIRE</Text>
          </TouchableOpacity>
        </View>

        {/* Shape list — right side */}
        {shapes.length > 0 && (
          <View style={S.shapeList}>
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', marginBottom: 4, letterSpacing: 1 }}>SHAPES</Text>
            {shapes.slice(-5).map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color || '#fff' }} />
                <Text style={{ color: '#aaa', fontSize: 9 }}>{s.name || s.shape_type || `Shape ${i + 1}`}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Bottom Controls ── */}

      {/* Undo — left */}
      {pointCount > 0 && (
        <View style={{ position: 'absolute', left: 20, bottom: insets.bottom + 100, zIndex: 15 }}>
          <TouchableOpacity style={[S.circleBtn, { borderColor: '#555', backgroundColor: '#333' }]}
            onPress={handleUndo}>
            <Text style={{ color: '#FFF', fontSize: 20 }}>↩</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Reset — left bottom */}
      <View style={{ position: 'absolute', left: 20, bottom: insets.bottom + 40, zIndex: 15 }}>
        <TouchableOpacity style={[S.circleBtn, { width: 36, height: 36, borderRadius: 18, borderColor: '#F44336', backgroundColor: 'rgba(244,67,54,0.15)' }]}
          onPress={handleReset}>
          <Text style={{ color: '#F44336', fontSize: 14, fontWeight: 'bold' }}>🗑</Text>
        </TouchableOpacity>
      </View>

      {/* CLOSE shape — right */}
      {canClose && (
        <View style={{ position: 'absolute', right: 20, bottom: insets.bottom + 100, zIndex: 15 }}>
          <TouchableOpacity style={[S.circleBtn, { borderColor: '#AB47BC', backgroundColor: '#AB47BC' }]}
            onPress={handleCloseShape}>
            <Text style={[S.circleBtnText, { color: '#FFF', fontSize: 9 }]}>CLOSE</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* SAVE open shape — right */}
      {canSave && (
        <View style={{ position: 'absolute', right: 20, bottom: insets.bottom + 40, zIndex: 15 }}>
          <TouchableOpacity style={[S.circleBtn, { borderColor: '#4CAF50', backgroundColor: '#4CAF50' }]}
            onPress={handleSaveOpen}>
            <Text style={[S.circleBtnText, { color: '#000', fontSize: 9 }]}>SAVE</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* + ADD POINT — center */}
      <View style={{ position: 'absolute', bottom: insets.bottom + 85, left: 0, right: 0, alignItems: 'center', zIndex: 15 }} pointerEvents="box-none">
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, marginBottom: 8, fontWeight: '500' }}>
          {pointCount === 0 ? 'Tap + to add first point' :
           pointCount === 1 ? '1 point — add more' :
           canClose ? `${pointCount} pts — CLOSE or add more` :
           `${pointCount} pts — SAVE or add more`}
        </Text>
        <TouchableOpacity
          style={[S.circleBtn, { width: 80, height: 80, borderRadius: 40, borderColor: '#4CAF50', backgroundColor: '#4CAF50' }]}
          onPress={handleAddPoint} activeOpacity={0.7}>
          <Text style={{ color: '#000', fontSize: 42, lineHeight: 48, fontWeight: '300', marginTop: -2 }}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Tool Palette — bottom bar */}
      <View style={[S.toolBar, { bottom: insets.bottom }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 8, gap: 6, alignItems: 'center' }}>
          {TOOLS.map(tool => (
            <TouchableOpacity key={tool.id}
              style={[S.toolBtn, activeTool === tool.id && S.toolBtnActive]}
              onPress={() => selectTool(tool.id)}>
              <Text style={{ fontSize: 18 }}>{tool.icon}</Text>
              <Text style={[S.toolBtnLabel, activeTool === tool.id && { color: '#000' }]}>{tool.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════
// STYLES
// ═══════════════════════════════════════
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  // Overlays
  arBg: { ...StyleSheet.absoluteFillObject, opacity: 0.25 },
  centerOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', padding: 20 },

  // Cards
  card: { backgroundColor: 'rgba(10,10,10,0.92)', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', width: '100%', maxWidth: 400 },
  cardTitle: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center' },
  cardSub: { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 16 },

  // Inputs
  label: { fontSize: 10, color: '#888', fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  input: { backgroundColor: '#111', borderRadius: 10, padding: 14, color: '#fff', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 10 },
  error: { color: '#F44336', fontSize: 12, textAlign: 'center', marginBottom: 8 },

  // Buttons
  greenBtn: { backgroundColor: '#4CAF50', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  greenBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },

  backBtn: { position: 'absolute', top: 8, left: 12, zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  backBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  smallBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.5)' },
  smallBtnText: { color: '#aaa', fontSize: 10, fontWeight: '700' },

  // Status
  statusBar: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  statusName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  statusType: { color: '#888', fontSize: 11, fontWeight: '500' },

  // Crosshair
  crosshair: { position: 'absolute', top: '50%', left: '50%', width: 30, height: 30, marginLeft: -15, marginTop: -15, zIndex: 5 },
  crosshairH: { position: 'absolute', top: 14, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.4)' },
  crosshairV: { position: 'absolute', left: 14, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.4)' },
  crosshairDot: { position: 'absolute', top: 12, left: 12, width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50' },

  // Circle buttons
  circleBtn: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  circleBtnText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  // Tool palette
  toolBar: { position: 'absolute', left: 0, right: 0, height: 70, zIndex: 20 },
  toolBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', minWidth: 56 },
  toolBtnActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  toolBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  toolBtnLabel: { color: '#aaa', fontSize: 8, fontWeight: '700', marginTop: 2 },

  // Projects
  projectRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  projectName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  projectDate: { color: '#666', fontSize: 12 },

  // Shape list
  shapeList: { position: 'absolute', right: 8, top: 50, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: 8, zIndex: 10, maxWidth: 120 },
});
