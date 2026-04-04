// ============================================================
// AR Tape — Lightweight measurement calculator in AR
// Points snap to ANY detected mesh surface (floor, wall, ceiling)
// ============================================================
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Alert, ScrollView,
  StyleSheet, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';

const ARRulerNativeView = Platform.OS === 'ios'
  ? require('../../modules/ar-ruler-native').ARRulerNativeView
  : View;

type MeasureType = 'length' | 'area' | 'volume' | 'count';
type Operation = '+' | '-' | '×' | '÷';

interface SubMeasurement {
  operation: Operation | null; // null = first in group
  value: number;
  unit: string;
  pointCount: number;
  points: { x: number; y: number; z: number }[]; // 3D positions
}

interface MeasurementGroup {
  name: string;
  measure_type: MeasureType;
  subs: SubMeasurement[];
  total: number;
  unit: string;
}

const TYPE_META: Record<MeasureType, { icon: string; label: string; unit: string; prefix: string }> = {
  length: { icon: '📏', label: 'Délka', unit: 'm', prefix: 'Délka' },
  area: { icon: '⬜', label: 'Plocha', unit: 'm²', prefix: 'Plocha' },
  volume: { icon: '📦', label: 'Objem', unit: 'm³', prefix: 'Objem' },
  count: { icon: '🔢', label: 'Počet', unit: 'ks', prefix: 'Počet' },
};

export default function ARTapeScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const rulerRef = useRef<any>(null);

  // Auth
  const [userId, setUserId] = useState<string | null>(null);

  // Phase: project | pickType | measuring | afterClose
  const [phase, setPhase] = useState<'project' | 'pickType' | 'measuring' | 'afterClose'>('project');

  // Project
  const [projectNameInput, setProjectNameInput] = useState('');
  const [projectData, setProjectData] = useState<{ id: string; name: string } | null>(null);
  const [existingProjects, setExistingProjects] = useState<any[]>([]);

  // Current measurement group
  const [groupName, setGroupName] = useState('');
  const [groupType, setGroupType] = useState<MeasureType>('area');
  const [wallMode, setWallMode] = useState(false);
  const [heightInput, setHeightInput] = useState('');
  const [countInput, setCountInput] = useState('');
  const [heightMode, setHeightMode] = useState<'none' | 'keyboard' | 'ar'>('none');
  const [heightPoints, setHeightPoints] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(0);

  // Sub-measurements within current group
  const [subs, setSubs] = useState<SubMeasurement[]>([]);
  const [currentOp, setCurrentOp] = useState<Operation | null>(null); // null for first

  // Live AR
  const [pointCount, setPointCount] = useState(0);
  const [liveLength, setLiveLength] = useState(0);
  const [liveArea, setLiveArea] = useState(0);
  const [isClosed, setIsClosed] = useState(false);
  const [lastSubValue, setLastSubValue] = useState(0);

  // Completed groups (history)
  const [groups, setGroups] = useState<MeasurementGroup[]>([]);

  // 3D point collection for spatial recording
  const [collectedPoints, setCollectedPoints] = useState<{ name: string; points: { x: number; y: number; z: number }[] }[]>([]);

  // Progressive save: track current tape item ID in DB
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);

  // Background floor plan
  const [floorplanId, setFloorplanId] = useState<string | null>(null);
  const floorplanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Init
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUserId(data.user.id);
        const { data: projects } = await supabase
          .from('ar_projects').select('id, name, created_at')
          .eq('user_id', data.user.id).eq('tool_type', 'tape')
          .order('created_at', { ascending: false });
        if (projects) setExistingProjects(projects);
      }
    })();
  }, []);

  // Auto-name: Plocha_01, Délka_02 etc
  const generateAutoName = (type: MeasureType) => {
    const prefix = TYPE_META[type].prefix;
    let n = 1;
    for (const g of groups) {
      if (g.name.startsWith(prefix + '_')) {
        const num = parseInt(g.name.split('_').pop() || '0');
        if (num >= n) n = num + 1;
      }
    }
    return `${prefix}_${String(n).padStart(2, '0')}`;
  };

  const startBackgroundFloorPlan = async (projId: string, uid: string) => {
    try {
      // Start RoomPlan silently (same native function as Room Scanner)
      await rulerRef.current?.startRoomScan();

      // Create or find existing floorplan record
      const { data: existing } = await supabase.from('ar_tape_floorplan')
        .select('id').eq('project_id', projId).eq('is_live', true).limit(1).single();

      let fpId = existing?.id;
      if (!fpId) {
        // Let DB generate UUID
        const { data: inserted, error: fpErr } = await supabase.from('ar_tape_floorplan').insert({
          project_id: projId, user_id: uid, is_live: true,
        }).select('id').single();
        if (fpErr) {
          console.warn('[Tape] INSERT ar_tape_floorplan FAILED:', fpErr.message);
          return;
        }
        fpId = inserted?.id;
      }
      setFloorplanId(fpId);

      // 15s auto-sync floor plan data
      if (floorplanTimerRef.current) clearInterval(floorplanTimerRef.current);
      floorplanTimerRef.current = setInterval(async () => {
        try {
          const rpData = await rulerRef.current?.exportRoomPlanData();
          console.log('[Tape] 📡 exportRoomPlanData returned:', JSON.stringify(rpData).substring(0, 200));
          const wallCount = rpData?.walls?.length || 0;
          console.log('[Tape] wallCount=', wallCount, 'fpId=', fpId);
          if (rpData && fpId && wallCount > 0) {
            const { error: updErr } = await supabase.from('ar_tape_floorplan').update({
              walls: rpData.walls || [],
              floors: rpData.floors || [],
              doors: rpData.doors || [],
              windows: rpData.windows || [],
              updated_at: new Date().toISOString(),
            }).eq('id', fpId);
            if (updErr) console.warn('[Tape] UPDATE floorplan FAILED:', updErr.message);
            else console.log('[Tape] ✅ Floorplan synced:', wallCount, 'walls');
          } else if (wallCount === 0) {
            console.log('[Tape] ⏳ No walls detected yet — RoomPlan still scanning');
          }
        } catch (e: any) {
          console.warn('[Tape] Floorplan sync error:', e.message);
        }
      }, 15000);
    } catch (e: any) {
      console.warn('[Tape] Background floorplan start failed:', e.message);
    }
  };

  // Cleanup: stop background floor plan on unmount
  useEffect(() => {
    return () => {
      if (floorplanTimerRef.current) clearInterval(floorplanTimerRef.current);
      // Stop room scan silently
      rulerRef.current?.stopRoomScan?.().catch(() => {});
    };
  }, []);

  // Create project
  const handleCreateProject = async () => {
    if (!projectNameInput.trim() || !userId) return;
    const id = `tape_${Date.now()}`;
    await supabase.from('ar_projects').insert({
      id, name: projectNameInput.trim(), user_id: userId, tool_type: 'tape',
    });
    setProjectData({ id, name: projectNameInput.trim() });
    setPhase('pickType');
    // Silently start background floor plan
    startBackgroundFloorPlan(id, userId);
  };

  const handleLoadProject = async (proj: any) => {
    setProjectData({ id: proj.id, name: proj.name });
    const { data } = await supabase.from('ar_tape_items').select('*')
      .eq('project_id', proj.id).order('sort_order', { ascending: true });
    if (data) {
      // Reconstruct groups from flat items
      const loadedGroups: MeasurementGroup[] = [];
      for (const d of data) {
        loadedGroups.push({
          name: d.name, measure_type: d.measure_type,
          subs: [], total: d.value, unit: d.unit,
        });
      }
      setGroups(loadedGroups);
    }
    setPhase('pickType');
    // Silently start background floor plan
    if (userId) startBackgroundFloorPlan(proj.id, userId);
  };

  // Start measuring
  const handleStartMeasuring = () => {
    setPointCount(0); setLiveLength(0); setLiveArea(0); setIsClosed(false);
    setPhase('measuring');
  };

  // Add point (or height measurement point in AR height mode)
  const handleAddPoint = async () => {
    if (!rulerRef.current) return;

    // AR height mode — intercept + button for height measurement
    const needsHeight = (groupType === 'area' && wallMode) || groupType === 'volume';
    if (needsHeight && heightMode === 'ar' && heightPoints < 2) {
      try {
        await rulerRef.current.addPoint();
        const hp = heightPoints + 1;
        setHeightPoints(hp);
        if (hp >= 2) {
          // Get distance between last 2 points as height
          const shapes = await rulerRef.current.getCurrentShapes();
          if (shapes?.length > 0) {
            const s = shapes[shapes.length - 1];
            const h = s.totalLength || 0;
            setMeasuredHeight(h);
            setHeightInput(h.toFixed(3));
          }
          // Undo the 2 height points so they don't interfere with shape
          await rulerRef.current.undoLastPoint?.();
          await rulerRef.current.undoLastPoint?.();
        }
      } catch (e: any) { console.warn('[Tape] height point', e.message); }
      return;
    }

    try {
      await rulerRef.current.addPoint();
      const nc = pointCount + 1;
      setPointCount(nc);
      if (nc >= 2) {
        const shapes = await rulerRef.current.getCurrentShapes();
        if (shapes?.length > 0) {
          const s = shapes[shapes.length - 1];
          setLiveLength(s.totalLength || 0);
          setLiveArea(s.area || 0);
        }
      }
    } catch (e: any) { console.warn('[Tape]', e.message); }
  };

  // Close polygon → auto-save → show operation picker
  const handleClose = async () => {
    if (!rulerRef.current || pointCount < 3) return;
    try {
      const result = await rulerRef.current.closeShape();
      if (result) {
        const area = result.area || 0;
        const length = result.totalLength || result.perimeter || 0;
        setLiveArea(area);
        setLiveLength(length);
        setIsClosed(true);
        // Auto-chain: close → save → operation picker (pass values directly to avoid state timing)
        await handleFinishSub({ closedArea: area, closedLength: length, alreadyClosed: true });
      }
    } catch (e: any) { console.warn('[Tape]', e.message); }
  };

  // Save open shape (for length) — returns totalLength
  const handleSaveOpen = async (): Promise<number> => {
    if (!rulerRef.current) return 0;
    try {
      const result = await rulerRef.current.saveOpenShape();
      const len = result?.totalLength || 0;
      setLiveLength(len);
      return len;
    } catch (e: any) { console.warn('[Tape]', e.message); return 0; }
  };

  // Finish current sub-measurement → go to afterClose
  const handleFinishSub = async (overrides?: { closedArea?: number; closedLength?: number; alreadyClosed?: boolean }) => {
    let value = 0;
    const closed = overrides?.alreadyClosed || isClosed;

    // Always get FRESH values from native to avoid stale React state
    let freshLength = overrides?.closedLength ?? 0;
    let freshArea = overrides?.closedArea ?? 0;
    if (!freshLength || !freshArea) {
      try {
        const shapes = await rulerRef.current?.getCurrentShapes();
        if (shapes?.length > 0) {
          const s = shapes[shapes.length - 1];
          if (!freshLength) freshLength = s.totalLength || s.perimeter || 0;
          if (!freshArea) freshArea = s.area || 0;
        }
      } catch {}
    }

    if (groupType === 'length') {
      // Save as open shape in native, get final length
      if (pointCount >= 2) {
        const savedLen = await handleSaveOpen();
        if (savedLen > 0) freshLength = savedLen;
      }
      value = freshLength;
    } else if (groupType === 'area') {
      if (wallMode) {
        const h = heightMode === 'ar' ? measuredHeight : parseFloat(heightInput);
        if (isNaN(h) || h <= 0) { Alert.alert('Výška', 'Zadejte nebo změřte výšku stěny.'); return; }
        value = freshLength * h;
        // Extrude wall in AR
        try {
          const shapes = await rulerRef.current?.getCurrentShapes();
          const pts = shapes?.[shapes.length - 1]?.points || [];
          await rulerRef.current?.extrudeWall(pts, h, `${fmt(value)} m²`);
        } catch {}
      } else {
        if (!closed) { Alert.alert('Uzavřete', 'Musíte uzavřít polygon (CLOSE).'); return; }
        value = freshArea;
        // Show area surface
        try {
          const shapes = await rulerRef.current?.getCurrentShapes();
          const pts = shapes?.[shapes.length - 1]?.points || [];
          await rulerRef.current?.showAreaSurface(pts, `${fmt(value)} m²`);
        } catch {}
      }
    } else if (groupType === 'volume') {
      if (!closed) { Alert.alert('Uzavřete', 'Musíte uzavřít polygon (CLOSE).'); return; }
      const h = heightMode === 'ar' ? measuredHeight : parseFloat(heightInput);
      if (isNaN(h) || h <= 0) { Alert.alert('Výška', 'Zadejte nebo změřte výšku.'); return; }
      value = freshArea * h;
    }

    setLastSubValue(value);

    // Collect 3D points from native shape for spatial recording
    let shapePoints: { x: number; y: number; z: number }[] = [];
    try {
      const shapes = await rulerRef.current?.getCurrentShapes();
      if (shapes?.length > 0) {
        const lastShape = shapes[shapes.length - 1];
        shapePoints = (lastShape.points || []).map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
      }
    } catch {}

    const sub: SubMeasurement = {
      operation: subs.length === 0 ? null : currentOp,
      value, unit: TYPE_META[groupType].unit, pointCount,
      points: shapePoints,
    };
    const newSubs = [...subs, sub];
    setSubs(newSubs);

    // Accumulate named points for DB save
    const subIndex = subs.length + 1;
    const subName = `${groupName} — S${subIndex}`;
    setCollectedPoints(prev => [...prev, { name: subName, points: shapePoints }]);

    // ── Progressive DB save ──
    if (projectData && userId) {
      const runningTotal = computeSubTotal(newSubs);
      const unit = TYPE_META[groupType].unit;
      const allPointsSoFar = [...collectedPoints, { name: subName, points: shapePoints }].flatMap(cp => cp.points);

      if (!currentItemId) {
        // FIRST sub → INSERT new tape_item (let DB generate UUID)
        const { data: inserted, error: insertErr } = await supabase.from('ar_tape_items').insert({
          project_id: projectData.id, user_id: userId,
          name: groupName || generateAutoName(groupType),
          measure_type: groupType,
          operation: '+', value: runningTotal, unit,
          points: allPointsSoFar,
          perimeter: null, area: null, height: null,
          sort_order: groups.length, is_closed: false,
        }).select('id').single();

        if (insertErr) {
          console.warn('[Tape] INSERT ar_tape_items FAILED:', insertErr.message);
        } else if (inserted) {
          const itemId = inserted.id;
          setCurrentItemId(itemId);

          for (let i = 0; i < shapePoints.length; i++) {
            const p = shapePoints[i];
            const { error: ptErr } = await supabase.from('ar_tape_points').insert({
              project_id: projectData.id, tape_item_id: itemId, user_id: userId,
              name: `${subName} — Bod ${i + 1}`, point_index: i,
              position_x: p.x, position_y: p.y, position_z: p.z,
            });
            if (ptErr) console.warn('[Tape] INSERT point FAILED:', ptErr.message);
          }
        }
      } else {
        // Subsequent subs → UPDATE existing tape_item with running total
        const { error: updErr } = await supabase.from('ar_tape_items').update({
          value: runningTotal, points: allPointsSoFar,
        }).eq('id', currentItemId);
        if (updErr) console.warn('[Tape] UPDATE ar_tape_items FAILED:', updErr.message);

        const prevPointCount = collectedPoints.flatMap(cp => cp.points).length;
        for (let i = 0; i < shapePoints.length; i++) {
          const p = shapePoints[i];
          const { error: ptErr } = await supabase.from('ar_tape_points').insert({
            project_id: projectData.id, tape_item_id: currentItemId, user_id: userId,
            name: `${subName} — Bod ${i + 1}`, point_index: prevPointCount + i,
            position_x: p.x, position_y: p.y, position_z: p.z,
          });
          if (ptErr) console.warn('[Tape] INSERT point FAILED:', ptErr.message);
        }
      }
    }

    setPhase('afterClose');
  };

  // Compute running sub-total
  const computeSubTotal = (subList: SubMeasurement[]) => {
    let result = 0;
    for (const s of subList) {
      if (s.operation === null || s.operation === '+') result += s.value;
      else if (s.operation === '-') result -= s.value;
      else if (s.operation === '×') result = result === 0 ? s.value : result * s.value;
      else if (s.operation === '÷') result = s.value !== 0 ? result / s.value : result;
    }
    return result;
  };

  // Continue with operation → next sub-measurement
  const handlePickOperation = (op: Operation) => {
    setCurrentOp(op);
    setPointCount(0); setLiveLength(0); setLiveArea(0); setIsClosed(false); setHeightInput(''); setHeightPoints(0); setMeasuredHeight(0); setCountInput('');
    setPhase('measuring');
  };

  // CELKEM — finalize measurement group
  const handleFinalize = async () => {
    const total = computeSubTotal(subs);
    const unit = TYPE_META[groupType].unit;
    const group: MeasurementGroup = {
      name: groupName, measure_type: groupType,
      subs: [...subs], total, unit,
    };
    setGroups(prev => [...prev, group]);

    // Final DB update — data already saved progressively, just finalize
    if (projectData && userId && currentItemId) {
      const allPoints = collectedPoints.flatMap(cp => cp.points);
      await supabase.from('ar_tape_items').update({
        value: total, points: allPoints, is_closed: true,
        name: groupName || generateAutoName(groupType),
      }).eq('id', currentItemId);
    }

    // Reset for next
    setSubs([]); setCurrentOp(null); setLastSubValue(0);
    setGroupName(''); setGroupType('area'); setWallMode(false); setHeightInput(''); setHeightMode('none');
    setCollectedPoints([]); setCurrentItemId(null);
    setPhase('pickType');
  };

  // Cancel current sub only
  const handleCancelSub = () => {
    setPointCount(0); setLiveLength(0); setLiveArea(0); setIsClosed(false);
    if (subs.length === 0) {
      // No subs yet — go back to pickType
      setPhase('pickType');
    } else {
      // Go back to afterClose (pick another operation or finalize)
      setPhase('afterClose');
    }
  };

  const fmt = (v: number) => v.toFixed(v < 10 ? 3 : 2);
  const subTotal = computeSubTotal(subs);

  // ═══════════════════════════════════
  // PHASE: PROJECT
  // ═══════════════════════════════════
  if (phase === 'project') {
    return (
      <KeyboardAvoidingView style={[S.container, { paddingTop: insets.top + 8 }]} behavior="padding">
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={S.bigTitle}>📏 AR Tape</Text>
          <Text style={S.subtitle}>Measurement Calculator</Text>

          <View style={S.card}>
            <Text style={S.label}>NOVÝ PROJEKT</Text>
            <TextInput style={S.input} placeholder="Název projektu..."
              placeholderTextColor="#555" value={projectNameInput}
              onChangeText={setProjectNameInput} autoFocus />
            <TouchableOpacity style={S.greenBtn} onPress={handleCreateProject}>
              <Text style={S.greenBtnText}>Vytvořit</Text>
            </TouchableOpacity>
          </View>

          {existingProjects.length > 0 && (
            <View style={S.card}>
              <Text style={S.label}>NAČÍST EXISTUJÍCÍ</Text>
              {existingProjects.map(p => (
                <TouchableOpacity key={p.id} style={S.projectRow} onPress={() => handleLoadProject(p)}>
                  <Text style={S.projectName}>{p.name}</Text>
                  <Text style={S.projectDate}>{new Date(p.created_at).toLocaleDateString('cs-CZ')}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity style={{ padding: 16, alignItems: 'center' }} onPress={() => navigation.goBack()}>
            <Text style={{ color: '#666' }}>← Zpět</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ═══════════════════════════════════
  // PHASE: MEASURING / AFTERCLOSE / PICKTYPE
  // All three share ONE persistent ARRulerNativeView so tracking never resets
  // ═══════════════════════════════════
  const canFinish = (groupType === 'length' && pointCount >= 2) ||
    (groupType === 'area' && wallMode && liveLength > 0) ||
    (groupType === 'area' && !wallMode && isClosed) ||
    (groupType === 'volume' && isClosed);

  const needsClose = pointCount >= 3 && (groupType === 'area' && !wallMode || groupType === 'volume') && !isClosed;

  if (phase === 'pickType' || phase === 'measuring' || phase === 'afterClose') {
    // COUNT type — calculator input (no AR points)
    if (groupType === 'count') {
      return (
        <View style={[S.container, { paddingTop: insets.top }]}>
          <View style={{ flex: 1 }}>
            <ARRulerNativeView ref={rulerRef} style={{ flex: 1 }}
              showMesh={false} showWireframe={false} showRoomPlan={true} drawingMode="free" />

            {/* Back / Save */}
            <TouchableOpacity
              style={{ position: 'absolute', top: 8, left: 12, zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>← Uložit</Text>
            </TouchableOpacity>

            {/* Status */}
            <View style={S.statusBar}>
              <Text style={S.statusName}>{groupName}</Text>
              <Text style={S.statusType}>
                {TYPE_META[groupType].icon} {TYPE_META[groupType].label}
                {subs.length > 0 && currentOp ? ` ${currentOp}` : ''}
              </Text>
            </View>

            {/* Sub-total if subs exist */}
            {subs.length > 0 && (
              <View style={S.subTotalBadge}>
                <Text style={S.subTotalText}>Průběžně: {fmt(subTotal)} {TYPE_META[groupType].unit}</Text>
              </View>
            )}

            {/* Centered calculator card */}
            <View style={S.centerOpOverlay} pointerEvents="box-none">
              <KeyboardAvoidingView behavior="padding">
                <View style={S.centerOpCard}>
                  <Text style={[S.label, { textAlign: 'center', marginBottom: 12, fontSize: 11 }]}>ZADEJ POČET</Text>
                  <TextInput
                    style={[S.input, { textAlign: 'center', fontSize: 32, fontWeight: '700', marginBottom: 16 }]}
                    placeholder="0"
                    placeholderTextColor="#555"
                    keyboardType="numeric"
                    value={countInput}
                    onChangeText={setCountInput}
                    autoFocus
                  />
                  <TouchableOpacity
                    style={[S.greenBtn, { opacity: countInput.trim() ? 1 : 0.4 }]}
                    onPress={() => {
                      const val = parseFloat(countInput);
                      if (isNaN(val)) { Alert.alert('Chyba', 'Zadejte číslo.'); return; }
                      const sub: SubMeasurement = {
                        operation: subs.length === 0 ? null : currentOp,
                        value: val, unit: 'ks', pointCount: 0, points: [],
                      };
                      setSubs(prev => [...prev, sub]);
                      setCountInput('');
                      setPhase('afterClose');
                    }}
                    disabled={!countInput.trim()}
                  >
                    <Text style={S.greenBtnText}>✅ ULOŽIT</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={{ marginTop: 12, padding: 8 }} onPress={handleCancelSub}>
                    <Text style={{ color: '#F44336', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>✕ Zrušit</Text>
                  </TouchableOpacity>
                </View>
              </KeyboardAvoidingView>
            </View>
          </View>
        </View>
      );
    }

    // AR measurement types (length, area, volume) AND afterClose — single persistent AR view
    return (
      <View style={[S.container, { paddingTop: insets.top }]}>
        <View style={{ flex: 1 }}>
          <ARRulerNativeView ref={rulerRef} style={{ flex: 1 }}
            showMesh={false} showWireframe={false} showRoomPlan={true} drawingMode="free" />

          {/* Back / Save */}
          <TouchableOpacity
            style={{ position: 'absolute', top: 8, left: 12, zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>← Uložit</Text>
          </TouchableOpacity>

          {/* Status */}
          <View style={S.statusBar}>
            <Text style={S.statusName}>{groupName}</Text>
            <Text style={S.statusType}>
              {TYPE_META[groupType].icon} {TYPE_META[groupType].label}
              {wallMode ? ' (stěna)' : ''}
              {subs.length > 0 && currentOp ? ` ${currentOp}` : ''}
            </Text>
          </View>

          {/* ── PICK TYPE OVERLAY (shows form on top of live AR) ── */}
          {phase === 'pickType' && (
            <KeyboardAvoidingView style={S.setupOverlay} behavior="padding" pointerEvents="box-none">
              <ScrollView contentContainerStyle={{ justifyContent: 'center', flexGrow: 1 }} keyboardShouldPersistTaps="handled">
                <View style={S.setupCard}>
                  <Text style={S.setupTitle}>📏 Nové měření</Text>

                  <Text style={S.label}>TYP</Text>
                  <View style={S.row}>
                    {(['length', 'area', 'volume', 'count'] as MeasureType[]).map(t => (
                      <TouchableOpacity key={t}
                        style={[S.chip, groupType === t && S.chipActive]}
                        onPress={() => {
                          setGroupType(t); setWallMode(false);
                          setGroupName(generateAutoName(t));
                        }}
                      >
                        <Text style={[S.chipText, groupType === t && S.chipTextActive]}>
                          {TYPE_META[t].icon} {TYPE_META[t].label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {groupType === 'area' && (
                    <TouchableOpacity
                      style={[S.chip, wallMode && S.chipActive, { marginTop: 8, alignSelf: 'flex-start' }]}
                      onPress={() => setWallMode(!wallMode)}
                    >
                      <Text style={[S.chipText, wallMode && S.chipTextActive]}>🧱 Stěna (délka × výška)</Text>
                    </TouchableOpacity>
                  )}

                  <Text style={[S.label, { marginTop: 14 }]}>NÁZEV</Text>
                  <TextInput style={S.input} value={groupName} onChangeText={setGroupName}
                    placeholder="auto" placeholderTextColor="#555" />

                  <TouchableOpacity style={[S.greenBtn, { marginTop: 14 }]} onPress={() => {
                    if (!groupName) setGroupName(generateAutoName(groupType));
                    setSubs([]); setCurrentOp(null); setCountInput('');
                    handleStartMeasuring();
                  }}>
                    <Text style={S.greenBtnText}>▶ {groupType === 'count' ? 'Počítat' : 'Měřit'}</Text>
                  </TouchableOpacity>
                </View>

                {/* Completed groups list */}
                {groups.length > 0 && (
                  <View style={[S.card, { marginTop: 12, marginHorizontal: 0 }]}>
                    <Text style={S.label}>HOTOVÁ MĚŘENÍ ({groups.length})</Text>
                    {groups.map((g, i) => (
                      <View key={i} style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', paddingBottom: 8 }}>
                        <View style={S.logRow}>
                          <Text style={S.logType}>{TYPE_META[g.measure_type]?.icon}</Text>
                          <Text style={S.logName} numberOfLines={1}>{g.name}</Text>
                          <Text style={[S.logValue, { fontSize: 14, fontWeight: 'bold' }]}>{fmt(g.total)} {g.unit}</Text>
                        </View>
                        {g.subs.length > 0 && g.subs.map((sub, si) => (
                          <View key={si} style={{ flexDirection: 'row', paddingLeft: 28, paddingVertical: 2 }}>
                            <Text style={{ color: '#666', fontSize: 10, width: 20, fontFamily: 'monospace' }}>
                              {sub.operation || ' '}
                            </Text>
                            <Text style={{ color: '#AAA', fontSize: 10, flex: 1 }}>
                              {fmt(sub.value)} {sub.unit}
                              {sub.points?.length > 0 && ` (${sub.points.length} bodů)`}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>

              <TouchableOpacity style={{ padding: 12, alignItems: 'center' }} onPress={() => navigation.goBack()}>
                <Text style={{ color: '#666' }}>← Zpět</Text>
              </TouchableOpacity>
            </KeyboardAvoidingView>
          )}

          {/* ── MEASURING OVERLAYS ── */}
          {phase === 'measuring' && (
            <>
              {/* Live value */}
              <View style={S.liveBox}>
                {groupType === 'length' && <Text style={S.liveVal}>{fmt(liveLength)} m</Text>}
                {groupType === 'area' && wallMode && <Text style={S.liveVal}>{fmt(liveLength)} m × h</Text>}
                {groupType === 'area' && !wallMode && (
                  <Text style={S.liveVal}>{isClosed ? `${fmt(liveArea)} m²` : `${pointCount} bodů`}</Text>
                )}
                {groupType === 'volume' && (
                  <Text style={S.liveVal}>{isClosed ? `${fmt(liveArea)} m² × h` : `${pointCount} bodů`}</Text>
                )}
              </View>

              {/* Crosshair */}
              <View style={S.crosshair} pointerEvents="none">
                <View style={S.crosshairH} />
                <View style={S.crosshairV} />
                <View style={S.crosshairDot} />
              </View>

              {/* Sub-total if subs exist */}
              {subs.length > 0 && (
                <View style={S.subTotalBadge}>
                  <Text style={S.subTotalText}>Průběžně: {fmt(subTotal)} {TYPE_META[groupType].unit}</Text>
                </View>
              )}
            </>
          )}

          {/* ── AFTER CLOSE OVERLAYS ── */}
          {phase === 'afterClose' && (
            <>
              {/* Result display — top */}
              <View style={S.resultOverlay}>
                <Text style={S.resultTitle}>{groupName}</Text>
                {subs.map((s, i) => (
                  <View key={i} style={S.subRow}>
                    <Text style={S.subOp}>{s.operation ?? '='}</Text>
                    <Text style={S.subVal}>{fmt(s.value)} {s.unit}</Text>
                    <Text style={S.subPts}>({s.pointCount} bodů)</Text>
                  </View>
                ))}
                <View style={S.subTotalLine}>
                  <Text style={S.subTotalLabel}>Mezivýpočet:</Text>
                  <Text style={S.subTotalVal}>{fmt(computeSubTotal(subs))} {TYPE_META[groupType].unit}</Text>
                </View>
              </View>

              {/* Center Screen: Operation picker */}
              <View style={S.centerOpOverlay} pointerEvents="box-none">
                <View style={S.centerOpCard}>
                  <Text style={[S.label, { textAlign: 'center', marginBottom: 12, fontSize: 11 }]}>DALŠÍ OPERACE</Text>
                  <View style={S.opRow}>
                    {(['+', '-', '×', '÷'] as Operation[]).map(op => (
                      <TouchableOpacity key={op}
                        style={[S.circleBtn, { borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.15)' }]}
                        onPress={() => handlePickOperation(op)}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 24, fontWeight: '700', color: '#FF9800' }}>{op}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={[S.greenBtn, { marginTop: 16 }]} onPress={handleFinalize}>
                    <Text style={S.greenBtnText}>🏁 Ukončit měření</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </View>

        {/* ── MEASURING BOTTOM CONTROLS ── */}
        {phase === 'measuring' && (
          <>
            {/* Height input if needed */}
            {((groupType === 'area' && wallMode) || groupType === 'volume') && (
              <View style={S.heightBar}>
                {heightMode === 'none' ? (
                  <View style={{ flexDirection: 'row', gap: 10, flex: 1, alignItems: 'center' }}>
                    <Text style={{ color: '#aaa', fontSize: 12 }}>Výška:</Text>
                    <TouchableOpacity
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: 'rgba(76,175,80,0.25)', alignItems: 'center', borderWidth: 1, borderColor: '#4CAF50' }}
                      onPress={() => { setHeightMode('ar'); setHeightPoints(0); setMeasuredHeight(0); }}
                    >
                      <Text style={{ color: '#4CAF50', fontSize: 13, fontWeight: '700' }}>📏 Změřit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', borderWidth: 1, borderColor: '#666' }}
                      onPress={() => setHeightMode('keyboard')}
                    >
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>⌨️ Zadat</Text>
                    </TouchableOpacity>
                  </View>
                ) : heightMode === 'keyboard' ? (
                  <>
                    <TouchableOpacity onPress={() => setHeightMode('none')} style={{ marginRight: 8 }}>
                      <Text style={{ color: '#888', fontSize: 11 }}>← zpět</Text>
                    </TouchableOpacity>
                    <Text style={{ color: '#aaa', fontSize: 13 }}>Výška (m):</Text>
                    <TextInput style={S.heightInput} placeholder="2.5" placeholderTextColor="#555"
                      keyboardType="numeric" value={heightInput} onChangeText={setHeightInput} autoFocus />
                  </>
                ) : (
                  <>
                    <TouchableOpacity onPress={() => { setHeightMode('none'); setHeightPoints(0); setMeasuredHeight(0); }} style={{ marginRight: 8 }}>
                      <Text style={{ color: '#888', fontSize: 11 }}>← zpět</Text>
                    </TouchableOpacity>
                    <Text style={{ color: '#aaa', fontSize: 13, flex: 1 }}>
                      {heightPoints === 0 ? '📏 Klikni + pro spodní bod' :
                       heightPoints === 1 ? '📏 Klikni + pro horní bod' :
                       `✅ Výška: ${measuredHeight.toFixed(3)} m`}
                    </Text>
                    {heightPoints >= 2 && (
                      <TouchableOpacity
                        style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(255,152,0,0.3)' }}
                        onPress={() => { setHeightPoints(0); setMeasuredHeight(0); }}
                      >
                        <Text style={{ color: '#FF9800', fontSize: 11, fontWeight: '700' }}>ZNOVU</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            )}

            {/* Cancel ✕ */}
            <View style={{ position: 'absolute', left: 24, bottom: insets.bottom + 130, zIndex: 15 }} pointerEvents="box-none">
              <TouchableOpacity
                style={[S.circleBtn, { width: 40, height: 40, borderRadius: 20, borderColor: '#F44336', backgroundColor: 'rgba(244,67,54,0.15)' }]}
                onPress={handleCancelSub}
                activeOpacity={0.7}
              >
                <Text style={{ color: '#F44336', fontSize: 18, fontWeight: 'bold' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Undo ↩ */}
            {pointCount > 0 && (
              <View style={{ position: 'absolute', left: 24, bottom: insets.bottom + 30, zIndex: 15 }} pointerEvents="box-none">
                <TouchableOpacity
                  style={[S.circleBtn, { width: 48, height: 48, borderRadius: 24, borderColor: '#555', backgroundColor: '#333' }]}
                  onPress={() => rulerRef.current?.undoLastPoint?.()}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: '#FFF', fontSize: 22 }}>↩</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* CLOSE */}
            {needsClose && (
              <View style={{ position: 'absolute', right: 24, bottom: insets.bottom + 30, zIndex: 15 }} pointerEvents="box-none">
                <TouchableOpacity
                  style={[S.circleBtn, { borderColor: '#AB47BC', backgroundColor: '#AB47BC' }]}
                  onPress={handleClose}
                  activeOpacity={0.7}
                >
                  <Text style={[S.circleBtnText, { color: '#FFF', fontSize: 9 }]}>CLOSE</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* SAVE */}
            {canFinish && (
              <View style={{ position: 'absolute', right: 24, bottom: insets.bottom + (needsClose ? 95 : 30), zIndex: 15 }} pointerEvents="box-none">
                <TouchableOpacity
                  style={[S.circleBtn, { borderColor: '#4CAF50', backgroundColor: '#4CAF50' }]}
                  onPress={() => handleFinishSub()}
                  activeOpacity={0.7}
                >
                  <Text style={[S.circleBtnText, { color: '#000', fontSize: 9 }]}>ULOŽIT</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* + ADD button */}
            <View style={{ position: 'absolute', bottom: insets.bottom + 20, left: 0, right: 0, alignItems: 'center', zIndex: 15 }} pointerEvents="box-none">
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, marginBottom: 16, fontWeight: '500' }}>
                {pointCount === 0 ? 'Přidej první bod' :
                 pointCount === 1 ? 'Bod 1 umístěn ✓ — přidej další' :
                 pointCount < 3 ? `${pointCount} body — přidej další` :
                 `${pointCount} bodů — CLOSE nebo ULOŽIT`}
              </Text>
              <TouchableOpacity
                style={[S.circleBtn, {
                  width: 100, height: 100, borderRadius: 50,
                  borderColor: '#4CAF50', backgroundColor: '#4CAF50',
                }]}
                onPress={handleAddPoint}
                activeOpacity={0.7}
              >
                <Text style={{ color: '#000', fontSize: 52, lineHeight: 58, fontWeight: '300', marginTop: -2 }}>+</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    );
  }

  return null;
}

// ═══════════════════════════════════════
// STYLES
// ═══════════════════════════════════════
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  // Project
  bigTitle: { fontSize: 28, fontWeight: '700', color: '#fff', textAlign: 'center', marginTop: 8, marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 20 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20, marginHorizontal: 20, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  label: { fontSize: 10, color: '#888', fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  input: { backgroundColor: '#111', borderRadius: 10, padding: 14, color: '#fff', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  greenBtn: { backgroundColor: '#4CAF50', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  greenBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  projectRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  projectName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  projectDate: { color: '#666', fontSize: 12 },

  // Setup overlay
  arBg: { ...StyleSheet.absoluteFillObject, opacity: 0.25 },
  setupOverlay: { flex: 1, paddingHorizontal: 16 },
  setupCard: { backgroundColor: 'rgba(10,10,10,0.92)', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  setupTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 14 },

  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: '#111' },
  chipActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  chipText: { fontSize: 12, color: '#aaa', fontWeight: '600' },
  chipTextActive: { color: '#000' },

  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  logType: { fontSize: 14, marginRight: 8 },
  logName: { flex: 1, fontSize: 13, color: '#fff', fontWeight: '500' },
  logValue: { fontSize: 14, fontWeight: '700', color: '#4CAF50' },

  // Measuring — circular buttons (matching room scanner)
  circleBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#222', borderWidth: 2, borderColor: '#555', alignItems: 'center', justifyContent: 'center' },
  circleBtnText: { color: '#666', fontWeight: '700', fontSize: 11, letterSpacing: 1, textAlign: 'center' },

  statusBar: { position: 'absolute', top: 8, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  statusName: { fontSize: 15, fontWeight: '600', color: '#fff' },
  statusType: { fontSize: 13, color: '#4CAF50', fontWeight: '600' },
  liveBox: { position: 'absolute', top: 56, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 8 },
  liveVal: { fontSize: 32, fontWeight: '700', color: '#4CAF50' },

  crosshair: { position: 'absolute', top: '50%', left: '50%', width: 40, height: 40, marginLeft: -20, marginTop: -20, alignItems: 'center', justifyContent: 'center' },
  crosshairH: { position: 'absolute', width: 40, height: 2, backgroundColor: 'rgba(76,175,80,0.9)' },
  crosshairV: { position: 'absolute', width: 2, height: 40, backgroundColor: 'rgba(76,175,80,0.9)' },
  crosshairDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50' },

  subTotalBadge: { position: 'absolute', bottom: 100, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  subTotalText: { fontSize: 14, color: '#FF9800', fontWeight: '600' },

  heightBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.85)', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  heightInput: { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 10, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', fontSize: 16 },

  // After close — center screen overlay
  centerOpOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  centerOpCard: { backgroundColor: 'rgba(10,10,10,0.92)', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', minWidth: 280 },
  opRow: { flexDirection: 'row', justifyContent: 'center', gap: 16 },

  resultOverlay: { position: 'absolute', top: 8, left: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.88)', borderRadius: 14, padding: 16, zIndex: 10 },
  resultTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 10 },
  subRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  subOp: { fontSize: 18, fontWeight: '700', color: '#FF9800', width: 28, textAlign: 'center' },
  subVal: { fontSize: 16, fontWeight: '600', color: '#fff', flex: 1 },
  subPts: { fontSize: 11, color: '#666' },
  subTotalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderColor: 'rgba(76,175,80,0.3)' },
  subTotalLabel: { fontSize: 12, color: '#888', fontWeight: '600' },
  subTotalVal: { fontSize: 22, fontWeight: '700', color: '#4CAF50' },
});
