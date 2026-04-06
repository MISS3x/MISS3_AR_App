import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, TextInput, ActivityIndicator, Switch, FlatList, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
// SegmentedControl removed — mode buttons are now inline with + button
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/theme';
import { ARRulerNativeView } from '../../modules/ar-ruler-native';
import { supabase } from '../lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';

// Drawing mode colors
const tronBlue = '#33CCFF';
const freeOrange = '#FF9800';
const wallPink = '#FF4D99';

export default function ARRulerScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const rulerRef = useRef<any>(null);

  const [pointCount, setPointCount] = useState(0);
  const [roomHeight, setRoomHeight] = useState<number | null>(null);
  const [floorDetected, setFloorDetected] = useState(false);
  const [prompt, setPrompt] = useState("Move phone to scan floor...");
  const [drawingMode, setDrawingMode] = useState<'floor' | 'free' | 'wall'>('floor');
  const [shapeCount, setShapeCount] = useState(0);
  const [showWire, setShowWire] = useState(true);
  const [showRoomPlan, setShowRoomPlan] = useState(true);

  // Auto-edge detection
  const [autoDetect, setAutoDetect] = useState(false);
  const [edgeThreshold, setEdgeThreshold] = useState(45);
  const [detectedEdgeCount, setDetectedEdgeCount] = useState(0);
  const [detectedPolylineCount, setDetectedPolylineCount] = useState(0);

  // Cut Room
  const [cutActive, setCutActive] = useState(false);
  const [cutType, setCutType] = useState<'horizontal' | 'vertical'>('horizontal');
  const [cutHeight, setCutHeight] = useState(0);
  const [cutRotation, setCutRotation] = useState(0);
  const [cutPointCount, setCutPointCount] = useState(0);

  // --- Phase 5: Project & Auto-Export State ---
  const [userProjects, setUserProjects] = useState<{ id: string, name: string }[]>([]);
  const [projectModalTab, setProjectModalTab] = useState<'new' | 'load'>('new');
  const [selectedLoadProjectId, setSelectedLoadProjectId] = useState<string | null>(null);

  // Auth
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Project
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [projectData, setProjectData] = useState<{ id: string; name: string } | null>(null);

  // Sync
  const [pendingCount, setPendingCount] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [webOperatorOnline, setWebOperatorOnline] = useState(false);
  // Upload Progress
  const [photosTaken, setPhotosTaken] = useState(0);
  const [photosUploaded, setPhotosUploaded] = useState(0);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [meshChunksTotal, setMeshChunksTotal] = useState(0);
  const [meshChunksUploaded, setMeshChunksUploaded] = useState(0);
  const [isUploadingMesh, setIsUploadingMesh] = useState(false);
  const [finalizationStep, setFinalizationStep] = useState('');
  const [finalizationProgress, setFinalizationProgress] = useState(0); // 0-100

  // Debug & Sync Controls
  const [chunkSizeMB, setChunkSizeMB] = useState(45); // 45MB Supabase limit
  const [showDebugPanel, setShowDebugPanel] = useState(true);
  // Room scan state
  const [isRoomScanning, setIsRoomScanning] = useState(false);
  const [isRoomFinalizing, setIsRoomFinalizing] = useState(false);
  const [scanSessionNumber, setScanSessionNumber] = useState(0); // counts scan sessions
  const [meshExportEnabled, setMeshExportEnabled] = useState(true); // toggle mesh export
  const [isPlacingAnchors, setIsPlacingAnchors] = useState(false);
  const [anchorType, setAnchorType] = useState<'point' | 'edge'>('edge');
  const [anchorCount, setAnchorCount] = useState(0);
  const anchorResolveRef = useRef<(() => void) | null>(null); // resolve when anchor placed
  const [isMatchingAnchors, setIsMatchingAnchors] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [previousAnchors, setPreviousAnchors] = useState<any[]>([]);
  const [sessionTransform, setSessionTransform] = useState<number[] | null>(null);
  // Per-category logs
  const [logsM, setLogsM] = useState<string[]>([]); // measurements
  const [logsB, setLogsB] = useState<string[]>([]); // bounding boxes
  const [logsMesh, setLogsMesh] = useState<string[]>([]); // meshes
  const [logsA, setLogsA] = useState<string[]>([]); // anchors (always on)
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  // ═══ MEMORY MONITORING ═══
  const [memoryStats, setMemoryStats] = useState<{
    availableMemoryMB: number; meshVertexCount: number; meshAnchorCount: number;
    meshSizeMB: number; meshPaused: boolean;
  } | null>(null);
  const [showMemoryAlert, setShowMemoryAlert] = useState(false);
  const [memoryAlertMessage, setMemoryAlertMessage] = useState('');
  const ts = () => new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const addLog = useCallback((msg: string) => {
    setDebugLogs(prev => [`[${ts()}] ${msg}`, ...prev].slice(0, 30));
  }, []);
  const addLogM = useCallback((msg: string) => { setLogsM(prev => [`[${ts()}] ${msg}`, ...prev].slice(0, 15)); }, []);
  const addLogB = useCallback((msg: string) => { setLogsB(prev => [`[${ts()}] ${msg}`, ...prev].slice(0, 15)); }, []);
  const addLogMesh = useCallback((msg: string) => { setLogsMesh(prev => [`[${ts()}] ${msg}`, ...prev].slice(0, 15)); }, []);
  const addLogA = useCallback((msg: string) => { setLogsA(prev => [`[${ts()}] ${msg}`, ...prev].slice(0, 15)); }, []);

  useEffect(() => {
    checkAuthAndShowFlow();
  }, []);

  const checkAuthAndShowFlow = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUserId(session.user.id);
      setUserEmail(session.user.email || null);
      // Only show project modal if no project is loaded yet
      if (!projectData) {
        setShowProjectModal(true); // Logged in → show project modal
      }
    } else {
      if (!projectData) {
        setShowLoginModal(true); // Not logged in → show login first
      }
    }
  };

  // --- Quick Login ---
  const handleQuickLogin = async () => {
    if (!loginEmail || !loginPassword) {
      setLoginError('Fill in email and password');
      return;
    }
    setLoginLoading(true);
    setLoginError(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });

    if (error) {
      setLoginError(error.message);
      setLoginLoading(false);
      return;
    }

    setUserId(data.user?.id || null);
    setUserEmail(data.user?.email || null);
    setLoginLoading(false);
    setShowLoginModal(false);
    setShowProjectModal(true); // After login → project modal
  };

  const handleSkipLogin = () => {
    setShowLoginModal(false);
    setShowProjectModal(true);
  };

  // --- Project ---
  useEffect(() => {
    if (showProjectModal && userId) {
      supabase.from('ar_projects').select('id, name')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .then(({ data }) => { if (data) setUserProjects(data); });
    }
  }, [showProjectModal, userId]);

  // --- AR Collaboration Real-time Sync ---
  const fetchRemoteData = async (projectId: string) => {
    try {
      const { data: modelsData } = await supabase
        .from('ar_placed_models')
        .select(`*, models_3d ( name )`)
        .eq('project_id', projectId);

      const { data: measurementsData } = await supabase
        .from('ar_measurements')
        .select('*')
        .eq('project_id', projectId);

      const allRemoteObjects: any[] = [];

      if (modelsData) {
        modelsData.forEach(d => {
          allRemoteObjects.push({
            type: 'model',
            x: d.position_x ?? 0,
            y: d.position_y ?? 0,
            z: d.position_z ?? 0,
            name: d.models_3d?.name ?? 'Model'
          });
        });
      }

      // Web draws shapes into ar_measurements — accept ANY type that has points
      if (measurementsData) {
        console.log(`[AR Collab] Got ${measurementsData.length} measurements from web`);
        measurementsData.forEach(d => {
          const pType = d.payload?.type;
          const pts = d.payload?.points;

          // Handle web primitives (cube, cylinder, sphere) — have position, not points
          if (['cube', 'cylinder', 'sphere'].includes(pType) && d.payload?.position) {
            allRemoteObjects.push({
              type: pType,
              position: d.payload.position,
              rotation: d.payload.rotation || { x: 0, y: 0, z: 0 },
              scale: d.payload.scale || { x: 1, y: 1, z: 1 }
            });
          } else if (pts && Array.isArray(pts) && pts.length >= 2) {
            // Map any type to polygon/polyline for native rendering
            const renderType = (pType === 'polygon' || pType === 'floor' || pType === 'wall') ? 'polygon' : 'polyline';
            allRemoteObjects.push({
              type: renderType,
              points: pts,
              extrusionHeight: d.payload.extrusionHeight || 0
            });
          }
        });
      }

      console.log(`[AR Collab] Sending ${allRemoteObjects.length} remote objects to native`);
      rulerRef.current?.loadRemoteObjects?.(allRemoteObjects);

      // Bounding boxes removed — no longer loading or rendering gizmos
    } catch (e) {
      console.warn("Error fetching remote data:", e);
    }
  };

  useEffect(() => {
    if (projectData?.id) {
      // 🟢 AR Collaboration: Listen for remote additions from the web operator
      fetchRemoteData(projectData.id);

      const sub = supabase.channel(`collab_${projectData.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ar_measurements', filter: `project_id=eq.${projectData.id}` }, () => fetchRemoteData(projectData.id))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ar_placed_models', filter: `project_id=eq.${projectData.id}` }, () => fetchRemoteData(projectData.id))
        .on('presence', { event: 'sync' }, () => {
          const newState = sub.presenceState()
          let isWebOnline = false
          for (const key in newState) {
            const presences = newState[key] as any[]
            if (presences.some(p => p.client === 'web')) {
              isWebOnline = true
              break
            }
          }
          setWebOperatorOnline(isWebOnline)
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            addLog(`🟢 AR Collab Sync Active (Web Data + Bounding Boxes)`);
            await sub.track({ online_at: new Date().toISOString(), client: 'ios' })
          }
        });

      return () => {
        supabase.removeChannel(sub);
      };
    }
  }, [projectData?.id]);

  const handleCreateProject = async () => {
    if (projectModalTab === 'new') {
      if (!projectNameInput.trim()) {
        Alert.alert("Name Required", "Enter a project name.");
        return;
      }
      const projectId = `proj_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const projectName = projectNameInput.trim();

      if (userId) {
        const { error } = await supabase.from('ar_projects').insert({
          id: projectId,
          name: projectName,
          user_id: userId,
          created_at: new Date().toISOString(),
        });
        if (error) console.log("Project insert error:", error.message);
      }

      setProjectData({ id: projectId, name: projectName });
    } else {
      if (!selectedLoadProjectId) {
        Alert.alert("Select Project", "Please select a project to load.");
        return;
      }
      const p = userProjects.find(up => up.id === selectedLoadProjectId);
      if (p) {
        setProjectData({ id: p.id, name: p.name });
        setShowProjectModal(false);
        addLog(`📂 Loading project: ${p.name}`);

        // Helper: load shapes after anchor is ready
        const loadShapesAfterAnchor = async () => {
          let loadedShapeCount = 0;
          try {
            setPrompt("Loading saved measurements...");
            addLog(`📐 Fetching measurements...`);
            const { data: measurements } = await supabase
              .from('ar_measurements')
              .select('*')
              .eq('project_id', p.id)
              .order('created_at', { ascending: true });

            if (measurements && measurements.length > 0) {
              const loadedCount = await rulerRef.current?.loadShapes(measurements);
              loadedShapeCount = measurements.length;
              addLog(`✅ Loaded ${loadedCount || measurements.length} shapes`);
              setShapeCount(measurements.length);
              setUploadedCount(measurements.length);
            } else {
              addLog(`📐 No saved measurements found`);
            }
          } catch (e: any) {
            addLog(`❌ Measurements load error: ${e.message}`);
          }
          setPrompt(`Project loaded! ${loadedShapeCount} shapes`);

          // 3. Load scene anchors
          try {
            const { data: anchorsData } = await supabase
              .from('ar_scene_anchors')
              .select('*')
              .eq('project_id', p.id);
            if (anchorsData && anchorsData.length > 0) {
              await rulerRef.current?.loadSceneAnchors(anchorsData);
              addLog(`📌 Loaded ${anchorsData.length} scene anchors`);
            }
          } catch (e: any) { addLog(`⚠️ Scene anchors: ${e.message}`); }
        };

        // 1. Load anchor map
        setPrompt("Downloading AR Anchor...");
        const { data, error } = await supabase.storage.from('mesh-scans').download(`${userId}/${p.id}_anchor.map`);
        if (data) {
          const fileUri = `${FileSystem.documentDirectory}temp_load_${Date.now()}.map`;
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = (reader.result as string).split(',')[1];
            await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
            try {
              await rulerRef.current?.loadWorldMap(fileUri);
              addLog(`✅ Anchor map loaded`);
              // Wait for ARKit to relocalize before placing shapes
              setPrompt("⏳ Waiting for relocalization...");
              await new Promise(r => setTimeout(r, 3000));
              setPrompt("Anchor localized! Loading data...");
            } catch (e) {
              console.log("Load map error:", e);
              addLog(`❌ Anchor load failed: ${e}`);
            }
            // Load shapes AFTER anchor relocalization
            await loadShapesAfterAnchor();
          };
          reader.readAsDataURL(data);
        } else {
          setPrompt("No anchor map found. Loading data without anchor...");
          addLog(`⚠️ No anchor map, loading shapes anyway`);
          // No anchor — load shapes immediately  
          await loadShapesAfterAnchor();
        }
      }
    }

    if (projectModalTab === 'new') {
      setShowProjectModal(false);
    }
  };

  const handleSkipProject = () => {
    setProjectData(null);
    setShowProjectModal(false);
  };

  // --- AR Events ---
  const handleUpdate = (event: any) => {
    const { nativeEvent } = event;
    if (nativeEvent.event === 'floor_auto_detected' || nativeEvent.event === 'floor_manual_set') {
      setFloorDetected(true);
      setPrompt("Floor detected! Tap corners to draw");
    } else if (nativeEvent.event === 'ceiling_set') {
      setRoomHeight(nativeEvent.roomHeight);
    } else if (nativeEvent.event === 'point_added') {
      setPointCount(nativeEvent.count);
      if (nativeEvent.count >= 3) setPrompt("Tap more corners or Close Shape");
      else if (nativeEvent.count === 2) setPrompt("2 pts — Save Line or add more");
      else if (nativeEvent.count === 1) setPrompt("1 pt — tap next corner");
    } else if (nativeEvent.event === 'point_removed') {
      setPointCount(nativeEvent.count);
      if (nativeEvent.count === 0) setPrompt("Tap corners to draw");
    } else if (nativeEvent.event === 'reset') {
      setPointCount(0);
      setRoomHeight(null);
      setFloorDetected(false);
      setShapeCount(0);
      setPrompt(drawingMode === 'floor' ? "Move phone to scan floor..." : drawingMode === 'free' ? "Free mode — any surface" : "Scan wall to begin");
    }
    // ═══ MEMORY EVENTS ═══
    else if (nativeEvent.event === 'memory_stats') {
      setMemoryStats({
        availableMemoryMB: nativeEvent.availableMemoryMB || 0,
        meshVertexCount: nativeEvent.meshVertexCount || 0,
        meshAnchorCount: nativeEvent.meshAnchorCount || 0,
        meshSizeMB: nativeEvent.meshSizeMB || 0,
        meshPaused: nativeEvent.meshPaused || false,
      });
    }
    else if (nativeEvent.event === 'memory_warning') {
      addLog(`⚠️ RAM LOW: ${Math.round(nativeEvent.availableMemoryMB)}MB free`);
    }
    else if (nativeEvent.event === 'mesh_auto_paused') {
      setShowMemoryAlert(true);
      setMemoryAlertMessage(nativeEvent.message || 'Mesh paused — low memory');
      addLog(`🛑 MESH PAUSED: ${nativeEvent.reason} — ${Math.round(nativeEvent.availableMemoryMB)}MB free, ${nativeEvent.meshVertexCount} vertices`);
    }
    else if (nativeEvent.event === 'mesh_resumed') {
      setShowMemoryAlert(false);
      addLog('✅ Mesh resumed');
    }
  };

  const handlePlaneState = (event: any) => {
    if (event.nativeEvent.status === 'ready' && !floorDetected) setFloorDetected(true);
  };

  const handleAddPoint = () => rulerRef.current?.addPoint();
  const handleSetCeiling = () => rulerRef.current?.setCeiling();

  // --- Smart Undo ---
  const handleUndo = async () => {
    if (pointCount > 0) {
      // Undo last point in current polygon
      rulerRef.current?.undoLastPoint();
    } else if (shapeCount > 0) {
      // Undo last saved shape — delete from Supabase
      try {
        const json = await AsyncStorage.getItem('@ar_measurements');
        if (json) {
          const records = JSON.parse(json);
          const lastRecord = records.pop(); // Remove last saved
          await AsyncStorage.setItem('@ar_measurements', JSON.stringify(records));

          if (lastRecord?.id && userId) {
            await supabase.from('ar_measurements').delete().eq('id', lastRecord.id);
            if (lastRecord.status === 'uploaded') setUploadedCount(prev => Math.max(0, prev - 1));
            else setPendingCount(prev => Math.max(0, prev - 1));
          }
        }
        setShapeCount(prev => Math.max(0, prev - 1));
        setPrompt("Last shape removed. Draw new shape.");
      } catch (e) { console.log("Undo shape error:", e); }
    }
  };

  // --- Reset with confirmation + selective delete ---
  const handleReset = () => {
    Alert.alert(
      '🗑 Reset Project Data',
      'What do you want to delete? Anchors are always kept.',
      [
        { text: '📐 Measurements Only', onPress: () => deleteCategory('measurements') },
        { text: '📦 Meshes Only', onPress: () => deleteCategory('meshes') },
        { text: '🏠 Bounding Boxes Only', onPress: () => deleteCategory('boxes') },
        { text: '🔥 DELETE ALL', style: 'destructive', onPress: () => deleteCategory('all') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const deleteCategory = async (category: 'measurements' | 'meshes' | 'boxes' | 'all') => {
    if (!projectData?.id || !userId) return;
    addLog(`🗑 Deleting: ${category}...`);
    try {
      if (category === 'measurements' || category === 'all') {
        await supabase.from('ar_measurements').delete().eq('project_id', projectData.id);
        await AsyncStorage.setItem('@ar_measurements', JSON.stringify([]));
        setPendingCount(0);
        setUploadedCount(0);
        setShapeCount(0);
        rulerRef.current?.reset(); // Clear visual shapes from AR
        addLogM(`🗑 All measurements deleted`);
        addLog(`✅ Measurements deleted`);
      }
      if (category === 'meshes' || category === 'all') {
        // Delete mesh chunks from storage
        const { data: meshFiles } = await supabase.from('ar_mesh_scans').select('file_path').eq('project_id', projectData.id);
        if (meshFiles) {
          for (const mf of meshFiles) {
            await supabase.storage.from('mesh-scans').remove([mf.file_path]);
          }
        }
        await supabase.from('ar_mesh_scans').delete().eq('project_id', projectData.id);
        // Reset mesh metadata on project
        await supabase.from('ar_projects').update({ mesh_url: null, mesh_vertices_count: 0, mesh_faces_count: 0, mesh_file_size: 0 }).eq('id', projectData.id);
        addLogMesh(`🗑 All mesh chunks deleted`);
        addLog(`✅ Meshes deleted`);
      }
      if (category === 'boxes' || category === 'all') {
        await supabase.from('ar_bounding_boxes').delete().eq('project_id', projectData.id);
        addLogB(`🗑 All bounding boxes deleted`);
        addLog(`✅ Bounding boxes deleted`);
      }
      if (category === 'all') {
        rulerRef.current?.reset();
      }
      setPrompt(`${category === 'all' ? 'All data' : category.charAt(0).toUpperCase() + category.slice(1)} deleted. Anchors preserved.`);
    } catch (e: any) {
      addLog(`❌ Delete error: ${e.message}`);
    }
  };

  // --- Close Shape → Auto-Save to DB ---
  const handleCloseShape = async () => {
    if (pointCount < 3) return;
    try {
      const shape = await rulerRef.current?.closeShape();
      if (!shape) return;
      const newCount = shapeCount + 1;
      setShapeCount(newCount);
      setPointCount(0);
      setPrompt(`Shape ${newCount} saved! Draw another or Export.`);
      await autoSaveShape(shape, newCount);
    } catch (e) { console.log(e); }
  };

  const handleSaveOpenShape = async () => {
    if (pointCount < 2) return;
    try {
      const shape = await rulerRef.current?.saveOpenShape();
      if (!shape) return;
      const newCount = shapeCount + 1;
      setShapeCount(newCount);
      setPointCount(0);
      const typeLabel = shape.type === 'line' ? 'Line' : 'Polyline';
      setPrompt(`${typeLabel} ${newCount} saved! (${shape.totalLength?.toFixed(2) || '?'}m)`);
      await autoSaveShape(shape, newCount);
    } catch (e) { console.log(e); }
  };

  const autoSaveShape = async (shape: any, shapeNum: number) => {
    if (!projectData) return;
    const shapePayload = {
      id: `shape_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      project_id: projectData.id,
      project_name: projectData.name,
      user_id: userId,
      shape_number: shapeNum,
      timestamp: new Date().toISOString(),
      data: shape,
    };
    // Local backup
    const existingJson = await AsyncStorage.getItem('@ar_measurements');
    const existing = existingJson ? JSON.parse(existingJson) : [];
    existing.push({ ...shapePayload, status: 'pending' });
    await AsyncStorage.setItem('@ar_measurements', JSON.stringify(existing));
    setPendingCount(prev => prev + 1);
    // Immediate Supabase sync
    if (userId) {
      const { error } = await supabase.from('ar_measurements').insert({
        id: shapePayload.id,
        project_id: projectData.id,
        user_id: userId,
        created_at: shapePayload.timestamp,
        shape_number: shapeNum,
        payload: shape,
      });
      if (!error) {
        const updatedJson = await AsyncStorage.getItem('@ar_measurements');
        if (updatedJson) {
          const records = JSON.parse(updatedJson);
          const idx = records.findIndex((r: any) => r.id === shapePayload.id);
          if (idx >= 0) records[idx].status = 'uploaded';
          await AsyncStorage.setItem('@ar_measurements', JSON.stringify(records));
          setPendingCount(prev => Math.max(0, prev - 1));
          setUploadedCount(prev => prev + 1);
        }
        addLog(`📐 Shape ${shapeNum} synced instantly`);
        // Bounding box sync removed
      } else {
        addLog(`⚠️ Shape sync failed: ${error.message}`);
      }
    }
  };

  const refreshSyncCounts = async () => {
    try {
      const json = await AsyncStorage.getItem('@ar_measurements');
      if (json) {
        const records = JSON.parse(json);
        setPendingCount(records.filter((r: any) => r.status === 'pending').length);
        setUploadedCount(records.filter((r: any) => r.status === 'uploaded').length);
      }
    } catch (e) { }
  };

  const syncMeasurements = async () => {
    if (isSyncing || !userId) return;
    setIsSyncing(true);
    try {
      const json = await AsyncStorage.getItem('@ar_measurements');
      if (!json) { setIsSyncing(false); return; }
      let records = JSON.parse(json);
      let count = 0;
      for (let i = 0; i < records.length; i++) {
        if (records[i].status === 'pending') {
          const { error } = await supabase.from('ar_measurements').insert({
            id: records[i].id,
            project_id: records[i].project_id,
            user_id: records[i].user_id || userId,
            created_at: records[i].timestamp,
            shape_number: records[i].shape_number,
            payload: records[i].data,
          });
          if (!error) { records[i].status = 'uploaded'; count++; }
        }
      }
      if (count > 0) await AsyncStorage.setItem('@ar_measurements', JSON.stringify(records));
      refreshSyncCounts();
    } catch (e) { console.log("Sync error:", e); }
    finally { setIsSyncing(false); }
  };

  const handleExport = async () => {
    try {
      const rawShapes = await rulerRef.current?.getCurrentShapes();
      let floorArea = 0, wallArea = 0, lines = 0;
      rawShapes?.forEach((s: any) => {
        if (s.type === 'wall') wallArea += s.area;
        else if (s.type === 'floor') floorArea += s.area;
        else lines++;
      });
      Alert.alert(
        "Export Options",
        `Shapes: ${rawShapes?.length || 0}\nFloor: ${floorArea.toFixed(2)} m²\nWalls: ${wallArea.toFixed(2)} m²\nLines: ${lines}`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Upload Mesh", onPress: handleExportMesh },
        ]
      );
    } catch (e) { console.log(e); }
  };

  const syncCADData = async () => {
    if (!userId || !projectData) return;
    try {
      const cadData = await (rulerRef.current as any)?.exportCADData();
      if (!cadData) return;

      if (cadData.bounding_boxes && cadData.bounding_boxes.length > 0) {
        const payload = cadData.bounding_boxes.map((box: any) => ({
          id: box.identifier,
          project_id: projectData.id,
          user_id: userId,
          class_name: box.class_name,
          position_x: box.position.x,
          position_y: box.position.y,
          position_z: box.position.z,
          width: box.dimensions.width,
          height: box.dimensions.height,
          depth: box.dimensions.depth,
          payload: box.transform
        }));
        await supabase.from('ar_bounding_boxes').upsert(payload, { onConflict: 'id' });
      }

      if (cadData.planes || cadData.trajectory) {
        const updatePayload: any = {};
        if (cadData.planes) updatePayload.ar_anchors_json = cadData.planes;
        if (cadData.trajectory) updatePayload.camera_trajectory = cadData.trajectory;

        await supabase.from('ar_projects')
          .update(updatePayload)
          .eq('id', projectData.id);
      }
    } catch (e) {
      console.log("CAD sync error:", e);
    }
  };

  const performAutoSave = async () => {
    if (!userId || !projectData || isSyncing) return;
    setIsSyncing(true);
    addLog(`⏱ AUTO-SYNC START (chunk=${chunkSizeMB}MB)`);
    try {
      // 0. Sync measurements (shapes)
      addLog(`📐 Syncing measurements...`);
      await syncMeasurements();
      addLog(`✅ Measurements synced`);

      // 1. Export mesh chunks (only if MESH toggle is ON)
      if (meshExportEnabled) {
        addLog(`📦 Exporting mesh chunks (max ${chunkSizeMB}MB each)...`);
        const chunks = await rulerRef.current?.exportMeshChunks(chunkSizeMB);
        if (chunks && chunks.length > 0 && !chunks[0].error) {
          addLog(`✅ Got ${chunks.length} chunks`);
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const sizeMB = (chunk.byteSize / 1048576).toFixed(2);
            addLog(`  📤 Chunk ${i + 1}/${chunks.length}: ${chunk.vertexCount}v ${chunk.faceCount}f ${sizeMB}MB`);
            const fileName = `${userId}/${projectData.id}_chunk_${i}.obj`;
            const fileUri = `${FileSystem.documentDirectory}temp_mesh_${Date.now()}_${i}.obj`;
            await FileSystem.writeAsStringAsync(fileUri, chunk.obj, { encoding: 'utf8' });
            const formData = new FormData();
            formData.append('file', { uri: fileUri, name: `chunk_${i}.obj`, type: 'model/obj' } as any);
            await supabase.storage.from('mesh-scans').upload(fileName, formData, { upsert: true });
            await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => { });
            addLog(`  ✅ Chunk ${i + 1} uploaded`);
          }
        } else {
          addLog(`⚠️ No mesh data: ${chunks?.[0]?.error || 'empty'}`);
        }
      } else {
        addLog(`📦 Mesh export DISABLED — skipped`);
      }

      // Bounding box sync removed — camera trajectory still synced via auto-sync

      // 3. Save world anchor
      addLog(`⚓ Saving AR Anchor Map...`);
      const mapUrl = await rulerRef.current?.saveWorldMap();
      if (mapUrl) {
        const mapFileName = `${userId}/${projectData.id}_anchor.map`;
        const formDataMap = new FormData();
        formDataMap.append('file', { uri: `file://${mapUrl}`, name: 'anchor.map', type: 'application/octet-stream' } as any);
        await supabase.storage.from('mesh-scans').upload(mapFileName, formDataMap, { upsert: true });
        await FileSystem.deleteAsync(mapUrl, { idempotent: true }).catch(() => { });
        addLog(`✅ Anchor map uploaded`);
      } else {
        addLog(`⚠️ No anchor map to save`);
      }
      addLog(`🎉 AUTO-SYNC COMPLETE`);
    } catch (e: any) {
      addLog(`❌ Auto-save error: ${e.message || e}`);
      console.log("Auto-save error:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  // --- Capture Detail (pause room scan → Object Capture → resume) ---
  const [isDetailCapturing, setIsDetailCapturing] = useState(false);

  const handleCaptureDetail = async () => {
    if (!projectData || !userId) {
      Alert.alert('Project Required', 'Create a project first.');
      return;
    }
    try {
      addLogB('📷 Pausing room scan for detail capture...');

      // 1. Get camera transform BEFORE pausing
      const transform = await rulerRef.current?.getCameraTransform();

      // 2. Pause room scan (tracking continues)
      await rulerRef.current?.pauseRoomScan();
      setIsDetailCapturing(true);

      // 3. Navigate to Object Capture with room context
      navigation.navigate('ObjectCapture', {
        projectId: projectData.id,
        roomCameraTransform: transform || [],
        returnToRoomScan: true,
      });
    } catch (e: any) {
      addLogB(`❌ Detail capture error: ${e.message}`);
    }
  };

  // Auto-resume room scan when returning from Object Capture
  useFocusEffect(
    useCallback(() => {
      if (isDetailCapturing) {
        (async () => {
          addLogB('▶ Resuming room scan after detail capture...');
          await rulerRef.current?.resumeRoomScan();
          setIsDetailCapturing(false);
          setPrompt('🏠 Room scan resumed — continue scanning!');
          addLogB('✅ Room scan resumed');
        })();
      }
    }, [isDetailCapturing])
  );
  // --- Room Scan Start/Stop Handlers ---
  const handleStartRoomScan = async () => {
    if (!userId) {
      Alert.alert('Login Required', 'Sign in to use RoomPlan.');
      return;
    }
    if (!projectData) {
      setShowProjectModal(true);
      return;
    }
    try {
      // --- Check for previous manual anchors (2nd+ scan) ---
      const newSessionNum = scanSessionNumber + 1;
      setScanSessionNumber(newSessionNum);

      if (projectData) {
        // Always check for previous manual anchors in DB (existing project or 2nd+ scan)
        const { data: prevAnchors } = await supabase
          .from('ar_scene_anchors')
          .select('*')
          .eq('project_id', projectData.id)
          .eq('type', 'manual')
          .order('created_at', { ascending: true });

        if (prevAnchors && prevAnchors.length >= 3) {
          setPreviousAnchors(prevAnchors);

          // Ask about matching
          const shouldMatch = await new Promise<boolean>((resolve) => {
            Alert.alert(
              `📍 ${prevAnchors.length} předchozích kotev`,
              'Chcete osátit předchozí kotvy pro zarovnání skenů?',
              [
                { text: 'Přeskočit', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Ano, osátit', onPress: () => resolve(true) },
              ],
            );
          });

          if (shouldMatch) {
            // Start matching mode
            await rulerRef.current?.startAnchorMatching(prevAnchors);
            setIsMatchingAnchors(true);
            setMatchCount(0);

            // Sequential matching: one anchor at a time
            for (let i = 0; i < prevAnchors.length && i < 6; i++) {
              const anchor = prevAnchors[i];
              const matched = await new Promise<boolean>((resolve) => {
                Alert.alert(
                  `📍 Kotva ${i + 1}/${Math.min(prevAnchors.length, 6)}`,
                  `Jdi k "${anchor.name}" a stiskni OK.\nPozice: [${(anchor.position_x as number).toFixed(1)}, ${(anchor.position_z as number).toFixed(1)}]`,
                  [
                    { text: 'Přeskočit', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'OK — Jsem tady', onPress: () => resolve(true) },
                  ],
                );
              });

              if (matched) {
                await rulerRef.current?.matchAnchor(i);
                setMatchCount((prev: number) => prev + 1);
                addLogB(`✅ Matched: ${anchor.name}`);
              }
            }

            // Compute transform if 3+ matched
            const mCount = await rulerRef.current?.getMatchedCount();
            if (mCount >= 3) {
              const transform = await rulerRef.current?.computeKabschTransform();
              if (transform) {
                setSessionTransform(transform);
                addLogB(`🎯 Kabsch transform computed! ${mCount} anchors matched`);

                // Save transform to project metadata
                await supabase.from('ar_projects').update({
                  session_transform: transform,
                }).eq('id', projectData.id);
              }
            } else {
              addLogB(`⚠️ Only ${mCount} anchors matched (need 3+), no transform`);
            }
            setIsMatchingAnchors(false);
          }
        }
      }

      // Ask about auto-photo BEFORE starting scan
      await new Promise<void>((resolve) => {
        Alert.alert(
          '📸 Automatické fotky',
          'Pořizovat fotky automaticky po 1 metru?\nFotky budou viditelné jako růžové body.',
          [
            {
              text: 'Ne',
              style: 'cancel',
              onPress: async () => {
                await rulerRef.current?.enableAutoPhoto(false, 1.0);
                resolve();
              },
            },
            {
              text: 'Ano',
              onPress: async () => {
                await rulerRef.current?.enableAutoPhoto(true, 1.0);
                addLogB('📸 Auto-photo enabled (1m grid)');
                resolve();
              },
            },
          ],
        );
      });

      await rulerRef.current?.startRoomScan();
      setIsRoomScanning(true);
      setPrompt('🏠 Room scan active — move slowly around the room...');
      addLogB('🏠 Room scan started');
    } catch (e: any) {
      addLogB(`❌ Start scan error: ${e.message}`);
    }
  };

  const handleStopRoomScan = async () => {
    try {
      setIsRoomScanning(false);
      setIsRoomFinalizing(true);
      setPrompt('⏳ Exporting data before stopping scan...');
      addLogB('🛑 Preparing to stop room scan...');

      // --- ANCHOR PLACEMENT FLOW (reactive UI — shows RED +ADD button) ---
      const placeAnchorsResult = await new Promise<boolean>((resolve) => {
        Alert.alert(
          '📍 Umísti referenční kotvy',
          'Zamiř křížkem a tapni červené + pro umístění.\nPřepínej Bod/Hrana. Min. 3 kotvy.',
          [
            { text: 'Přeskočit', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Ano, umístit', onPress: () => resolve(true) },
          ],
        );
      });

      if (placeAnchorsResult) {
        setIsPlacingAnchors(true);
        setAnchorCount(0);
        setPrompt('📍 Zamiř křížkem a tapni + pro umístění kotvy');

        // Wait for user to finish placing anchors (Hotovo button sets resolve)
        await new Promise<void>((resolve) => {
          anchorResolveRef.current = resolve;
        });

        // Save manual anchors to DB
        const anchors = await rulerRef.current?.getManualAnchors();
        if (anchors && anchors.length > 0) {
          const payload = anchors.map((a: any) => ({
            id: a.id,
            project_id: projectData!.id,
            user_id: userId,
            name: a.name,
            type: 'manual',
            position_x: a.position_x,
            position_y: a.position_y,
            position_z: a.position_z,
            scan_session_id: `session_${scanSessionNumber}`,
          }));
          await supabase.from('ar_scene_anchors').upsert(payload, { onConflict: 'id' });
          addLogB(`✅ ${anchors.length} manual anchors saved to DB`);
        }
        setIsPlacingAnchors(false);
      }

      // ===== EXPORT MESH + ANCHOR BEFORE STOP (stopRoomScan resets AR session!) =====

      // 1. Export mesh FIRST (before session reset wipes reconstruction data)
      let meshSaved = false;
      if (meshExportEnabled) {
        setFinalizationStep('Exporting mesh...');
        setFinalizationProgress(10);
        addLogB('📦 Exporting mesh BEFORE stop...');
        setPrompt('⏳ Capturing mesh...');
        try {
          const chunks = await rulerRef.current?.exportMeshChunks(chunkSizeMB);
          addLogB(`📦 exportMeshChunks returned: ${chunks?.length ?? 'null'} chunks`);
          if (chunks && chunks.length > 0 && !chunks[0].error) {
            setIsUploadingMesh(true);
            setMeshChunksTotal(chunks.length);
            setMeshChunksUploaded(0);
            let totalV = 0, totalF = 0, totalBytes = 0;
            const encoder = new TextEncoder();
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              totalV += chunk.vertexCount;
              totalF += chunk.faceCount;
              totalBytes += chunk.byteSize;
              const fileName = `${userId}/${projectData!.id}_chunk_${i}.obj`;
              const objBytes = encoder.encode(chunk.obj);
              setFinalizationStep(`Uploading mesh ${i+1}/${chunks.length}...`);
              setFinalizationProgress(10 + (i / chunks.length) * 30);
              addLogMesh(`⬆️ Chunk ${i+1}/${chunks.length}: ${chunk.vertexCount}v ${(chunk.byteSize/1024/1024).toFixed(1)}MB`);
              await supabase.storage.from('mesh-scans').upload(fileName, objBytes, {
                contentType: 'text/plain',
                upsert: true,
              });
              setMeshChunksUploaded(i + 1);
              addLogMesh(`✅ Chunk ${i+1} uploaded`);
            }
            for (let i = 0; i < 20; i++) {
              const liveFileName = `${userId}/${projectData!.id}_live_chunk_${i}.obj`;
              await supabase.storage.from('mesh-scans').remove([liveFileName]).catch(() => { });
            }
            const { data: urlData } = supabase.storage.from('mesh-scans').getPublicUrl(`${userId}/${projectData!.id}_chunk_0.obj`);
            await supabase.from('ar_projects').update({
              mesh_url: urlData?.publicUrl || "",
              mesh_vertices_count: totalV,
              mesh_faces_count: totalF,
              mesh_file_size: totalBytes,
            }).eq('id', projectData!.id);
            addLogB(`✅ Mesh saved: ${totalV}v ${totalF}f ${chunks.length} chunks (${(totalBytes/1024/1024).toFixed(1)}MB)`);
            setIsUploadingMesh(false);
            meshSaved = true;
          } else {
            addLogB(`⚠️ No mesh data: ${chunks?.[0]?.error || 'empty'}`);
          }
        } catch (meshErr: any) {
          addLogB(`❌ Mesh export error: ${meshErr.message}`);
          setIsUploadingMesh(false);
        }
      } else {
        addLogB('📦 Mesh export DISABLED — skipped');
      }

      // 2. Save anchor map BEFORE stop (world map is more complete before reset)
      try {
        addLogB('⚓ Saving anchor map...');
        const mapUrl = await rulerRef.current?.saveWorldMap();
        if (mapUrl) {
          const mapFileName = `${userId}/${projectData!.id}_anchor.map`;
          const formDataMap = new FormData();
          formDataMap.append('file', { uri: `file://${mapUrl}`, name: 'anchor.map', type: 'application/octet-stream' } as any);
          await supabase.storage.from('mesh-scans').upload(mapFileName, formDataMap, { upsert: true });
          await FileSystem.deleteAsync(mapUrl, { idempotent: true }).catch(() => { });
          addLogB('✅ Anchor map saved');
        } else {
          addLogB('⚠️ No anchor map available');
        }
      } catch (anchorErr: any) {
        addLogB(`⚠️ Anchor save: ${anchorErr.message}`);
      }

      // ===== NOW STOP SCAN (this resets the AR session) =====

      // 3. Stop RoomCaptureSession (triggers RoomBuilder finalization)
      setFinalizationStep('Stopping scan...');
      setFinalizationProgress(50);
      addLogB('🛑 Stopping RoomCaptureSession...');
      await rulerRef.current?.stopRoomScan();

      // 4. Wait for RoomBuilder ML finalization
      setFinalizationStep('ML finalization...');
      setFinalizationProgress(60);
      addLogB('🧠 RoomBuilder ML finalization in progress...');
      await new Promise(r => setTimeout(r, 4000));

      // 5. Send FINALIZED RoomPlan data (session-specific — accumulates across scans)
      setFinalizationStep('Saving RoomPlan...');
      setFinalizationProgress(70);
      const scanSessionId = `session_${Date.now()}`;
      addLogB('🏠 Exporting RoomPlan data...');
      const roomData = await rulerRef.current?.exportRoomPlanData();
      if (roomData && (roomData.wallCount > 0 || roomData.doorCount > 0 || roomData.windowCount > 0 || roomData.objectCount > 0)) {
        await supabase.from('ar_roomplan').upsert({
          id: `${projectData!.id}_roomplan_${scanSessionId}`,
          project_id: projectData!.id,
          user_id: userId,
          walls: roomData.walls,
          doors: roomData.doors,
          windows: roomData.windows,
          openings: roomData.openings,
          floors: roomData.floors,
          objects: roomData.objects,
          wall_count: roomData.wallCount,
          door_count: roomData.doorCount,
          window_count: roomData.windowCount,
          object_count: roomData.objectCount,
          is_finalized: true,
          inferred_ceiling_y: roomData.inferredCeilingY ?? null,
          inferred_floor_y: roomData.inferredFloorY ?? null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
        addLogB(`✅ RoomPlan [FINAL]: ${roomData.wallCount}W ${roomData.doorCount}D ${roomData.windowCount}Wi ${roomData.objectCount}O`);
      }

      // 3b. Per-element upsert (UUID-based, persistent)
      setFinalizationStep('Saving elements...');
      setFinalizationProgress(80);
      const sessionId = `session_${Date.now()}`;
      try {
        addLogB('📋 Exporting RoomPlan elements...');
        const elements = await rulerRef.current?.exportRoomPlanElements();
        if (elements && elements.length > 0) {
          const payload = elements.map((el: any) => ({
            id: el.id,
            project_id: projectData!.id,
            user_id: userId,
            category: el.category,
            subcategory: el.subcategory || null,
            transform: el.transform,
            dimensions: el.dimensions,
            is_finalized: true,
            scan_session_id: sessionId,
            updated_at: new Date().toISOString(),
          }));
          await supabase.from('ar_roomplan_elements').upsert(payload, { onConflict: 'id' });
          addLogB(`✅ Elements [FINAL]: ${elements.length} upserted`);
        }
      } catch (elErr: any) {
        addLogB(`⚠️ Elements upsert: ${elErr.message}`);
      }

      // 6. Upload auto-captured photos
      try {
        setFinalizationStep('Uploading auto-photos...');
        setFinalizationProgress(90);
        const autoPhotos = await rulerRef.current?.exportAutoPhotos();
        if (autoPhotos && autoPhotos.length > 0) {
          addLogB(`📸 Uploading ${autoPhotos.length} auto-photos...`);
          let uploaded = 0;
          for (const photo of autoPhotos) {
            try {
              const fileBase64 = await FileSystem.readAsStringAsync(
                photo.uri.replace('file://', ''),
                { encoding: FileSystem.EncodingType.Base64 }
              );
              const byteArray = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0));
              const fileName = `auto_${Date.now()}_${uploaded}.jpg`;
              const storagePath = `${userId}/${projectData!.id}/${fileName}`;

              const { data: uploadData, error: uploadErr } = await supabase.storage
                .from('ar-photos')
                .upload(storagePath, byteArray, {
                  contentType: 'image/jpeg',
                  cacheControl: '3600',
                  upsert: false,
                });

              if (!uploadErr && uploadData) {
                const { data: { publicUrl } } = supabase.storage
                  .from('ar-photos')
                  .getPublicUrl(storagePath);

                await supabase.from('ar_photos').insert({
                  id: `auto_${Date.now()}_${uploaded}`,
                  project_id: projectData!.id,
                  user_id: userId,
                  file_path: storagePath,
                  public_url: publicUrl,
                  transform: photo.transform,
                  is_auto: true,
                });
                uploaded++;
              }
            } catch (photoErr: any) {
              // Skip individual photo errors
            }
          }
          addLogB(`✅ Auto-photos: ${uploaded}/${autoPhotos.length} uploaded`);
          // Disable auto-photo after stop
          await rulerRef.current?.enableAutoPhoto(false, 1.0);
        }
      } catch (autoErr: any) {
        addLogB(`⚠️ Auto-photos: ${autoErr.message}`);
      }

      setFinalizationStep('');
      setFinalizationProgress(100);
      setIsRoomFinalizing(false);
      addLogB(`🎉 Scan finalization complete!`);
      setPrompt(`✅ Room scan complete! ${meshSaved ? 'Mesh + ' : ''}RoomPlan finalized.`);
    } catch (e: any) {
      setIsRoomFinalizing(false);
      addLogB(`❌ Stop scan error: ${e.message}`);
      setPrompt(`❌ Scan error: ${e.message}`);
    }
  };

  // 15s auto-sync timer for measurements + RoomPlan + mesh + anchors
  // --- Anchor Placement Handlers (called by RED +ADD button overlay) ---
  const handlePlaceAnchorTap = async () => {
    if (!rulerRef.current) return;
    try {
      await rulerRef.current.placeManualAnchor(anchorType);
    } catch {
      // Fallback for old native build without type parameter
      await rulerRef.current.placeManualAnchor();
    }
    const newCount = await rulerRef.current.getManualAnchorCount() || 0;
    setAnchorCount(newCount);
    addLogB(`📍 Placed ${anchorType} anchor ${newCount}`);
  };

  const handleFinishAnchors = () => {
    setIsPlacingAnchors(false);
    if (anchorResolveRef.current) {
      anchorResolveRef.current();
      anchorResolveRef.current = null;
    }
  };

  // 15s auto-sync timer for measurements + RoomPlan + mesh + anchors
  useEffect(() => {
    if (!projectData || !userId) return;
    const interval = setInterval(async () => {
      if (isSyncing) return;

      // 1. Measurements (always on)
      try {
        addLogM(`🔄 Auto-syncing...`);
        await syncMeasurements();
        addLogM(`✅ Synced`);
      } catch (e: any) { addLogM(`❌ ${e.message}`); }

      // 2. RoomPlan structured data (during scan)
      if (isRoomScanning || isRoomFinalizing) {
        try {
          const roomData = await rulerRef.current?.exportRoomPlanData();
          if (roomData && (roomData.wallCount > 0 || roomData.doorCount > 0 || roomData.windowCount > 0 || roomData.objectCount > 0)) {
            await supabase.from('ar_roomplan').upsert({
              id: `${projectData.id}_roomplan_live`,
              project_id: projectData.id,
              user_id: userId,
              walls: roomData.walls,
              doors: roomData.doors,
              windows: roomData.windows,
              openings: roomData.openings,
              floors: roomData.floors,
              objects: roomData.objects,
              wall_count: roomData.wallCount,
              door_count: roomData.doorCount,
              window_count: roomData.windowCount,
              object_count: roomData.objectCount,
              is_finalized: false,
              inferred_ceiling_y: roomData.inferredCeilingY ?? null,
              inferred_floor_y: roomData.inferredFloorY ?? null,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'id' });
            addLogB(`✅ RoomPlan: ${roomData.wallCount}W ${roomData.doorCount}D ${roomData.windowCount}Wi ${roomData.objectCount}O`);
          }

          // 2b. Per-element upsert (UUID-based merge — old elements stay, new ones added)
          const elements = await rulerRef.current?.exportRoomPlanElements();
          if (elements && elements.length > 0) {
            const payload = elements.map((el: any) => ({
              id: el.id,
              project_id: projectData.id,
              user_id: userId,
              category: el.category,
              subcategory: el.subcategory || null,
              transform: el.transform,
              dimensions: el.dimensions,
              is_finalized: false,
              scan_session_id: `live_${Date.now()}`,
              updated_at: new Date().toISOString(),
            }));
            await supabase.from('ar_roomplan_elements').upsert(payload, { onConflict: 'id' });
            addLogB(`✅ Elements: ${elements.length} upserted`);
          }
        } catch (rpErr: any) {
          addLogB(`❌ RoomPlan: ${rpErr.message}`);
        }

        // 3. Mesh chunks streaming (during scan only — respects mesh toggle)
        if (meshExportEnabled) {
          try {
            const chunks = await rulerRef.current?.exportMeshChunks(chunkSizeMB);
            if (chunks && chunks.length > 0 && !chunks[0].error) {
              for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const fileName = `${userId}/${projectData.id}_live_chunk_${i}.obj`;
                const fileUri = `${FileSystem.documentDirectory}temp_mesh_live_${i}.obj`;
                await FileSystem.writeAsStringAsync(fileUri, chunk.obj, { encoding: 'utf8' });
                const formData = new FormData();
                formData.append('file', { uri: fileUri, name: `chunk_${i}.obj`, type: 'model/obj' } as any);
                await supabase.storage.from('mesh-scans').upload(fileName, formData, { upsert: true });
                await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => { });
              }
              addLogB(`✅ Mesh: ${chunks.length} chunks streamed`);
            }
          } catch (meshErr: any) {
            addLogB(`⚠️ Mesh stream: ${meshErr.message}`);
          }
        } // end meshExportEnabled
      } else {
        addLogB(`✅ Idle (no scan)`);
      }

      // 4. Camera trajectory + AR planes (always on — separate from removed bounding boxes)
      try {
        const cadData = await rulerRef.current?.exportCADData();
        if (cadData && (cadData.trajectory || cadData.planes)) {
          const updatePayload: any = {};
          if (cadData.planes) updatePayload.ar_anchors_json = cadData.planes;
          if (cadData.trajectory) updatePayload.camera_trajectory = cadData.trajectory;
          await supabase.from('ar_projects').update(updatePayload).eq('id', projectData.id);
          addLogA(`📍 Trajectory synced`);
        }
      } catch (e: any) { addLogA(`⚠️ ${e.message}`); }

      // 5. Anchor map save (non-blocking — critical for session resume)
      try {
        const mapUrl = await rulerRef.current?.saveWorldMap();
        if (mapUrl) {
          const mapFileName = `${userId}/${projectData.id}_anchor.map`;
          const formDataMap = new FormData();
          formDataMap.append('file', { uri: `file://${mapUrl}`, name: 'anchor.map', type: 'application/octet-stream' } as any);
          await supabase.storage.from('mesh-scans').upload(mapFileName, formDataMap, { upsert: true });
          await FileSystem.deleteAsync(mapUrl, { idempotent: true }).catch(() => { });
          addLogA('⚓ Anchor saved');
        }
      } catch (anchorErr: any) { addLogA(`⚠️ Anchor: ${anchorErr.message}`); }

      // 6. Scene anchors sync (upsert named anchors to DB)
      try {
        const sceneAnchors = await rulerRef.current?.exportSceneAnchors();
        if (sceneAnchors && sceneAnchors.length > 0) {
          const payload = sceneAnchors.map((a: any) => ({
            id: a.id,
            project_id: projectData.id,
            user_id: userId,
            name: a.name,
            type: a.type,
            position_x: a.position_x,
            position_y: a.position_y,
            position_z: a.position_z,
            rotation_x: a.rotation_x,
            rotation_y: a.rotation_y,
            rotation_z: a.rotation_z,
            updated_at: new Date().toISOString(),
          }));
          await supabase.from('ar_scene_anchors').upsert(payload, { onConflict: 'id' });
          addLogA(`📌 ${sceneAnchors.length} scene anchors synced`);
        }
      } catch (e: any) { addLogA(`⚠️ Anchors: ${e.message}`); }

    }, 15000);
    return () => clearInterval(interval);
  }, [projectData, userId, isSyncing, isRoomScanning, isRoomFinalizing]);

  const handleExportMesh = async () => {
    if (!userId || !projectData) {
      Alert.alert("Login Required", "Sign in to upload mesh scans.");
      return;
    }
    setPrompt("Exporting meshes and anchor...");
    try {
      addLog(`📦 MANUAL EXPORT (chunk=${chunkSizeMB}MB)...`);
      const chunks = await rulerRef.current?.exportMeshChunks(chunkSizeMB);
      if (!chunks || chunks.length === 0 || chunks[0].error) {
        Alert.alert("Error", chunks?.[0]?.error || "Mesh export failed");
        setPrompt("Mesh export failed.");
        return;
      }

      let totalV = 0, totalF = 0, totalBytes = 0;
      for (let i = 0; i < chunks.length; i++) {
        setPrompt(`Uploading chunk ${i + 1}/${chunks.length}...`);
        const chunk = chunks[i];
        totalV += chunk.vertexCount;
        totalF += chunk.faceCount;
        totalBytes += chunk.byteSize;
        const fileName = `${userId}/${projectData.id}_chunk_${i}.obj`;
        const fileUri = `${FileSystem.documentDirectory}temp_mesh_${Date.now()}_${i}.obj`;
        await FileSystem.writeAsStringAsync(fileUri, chunk.obj, { encoding: 'utf8' });

        const formData = new FormData();
        formData.append('file', { uri: fileUri, name: `chunk_${i}.obj`, type: 'model/obj' } as any);
        const { error } = await supabase.storage.from('mesh-scans').upload(fileName, formData, { upsert: true });
        await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => { });
        if (error) throw error;

        const scanId = `mesh_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await supabase.from('ar_mesh_scans').insert({
          id: scanId,
          project_id: projectData.id,
          user_id: userId,
          file_path: fileName,
          file_size: chunk.byteSize,
          vertices_count: chunk.vertexCount,
          faces_count: chunk.faceCount,
          format: 'obj',
        });
      }

      // Bounding box sync removed

      setPrompt(`Saving AR Anchor Map...`);
      const mapUrl = await rulerRef.current?.saveWorldMap();
      let mapFileName = "";
      if (mapUrl) {
        mapFileName = `${userId}/${projectData.id}_anchor.map`;
        const formDataMap = new FormData();
        formDataMap.append('file', { uri: `file://${mapUrl}`, name: 'anchor.map', type: 'application/octet-stream' } as any);
        await supabase.storage.from('mesh-scans').upload(mapFileName, formDataMap, { upsert: true });
        await FileSystem.deleteAsync(mapUrl, { idempotent: true }).catch(() => { });
      }

      const { data: urlData } = supabase.storage.from('mesh-scans').getPublicUrl(`${userId}/${projectData.id}_chunk_0.obj`);
      await supabase.from('ar_projects').update({
        mesh_url: urlData?.publicUrl || "",
        mesh_vertices_count: totalV,
        mesh_faces_count: totalF,
        mesh_file_size: totalBytes
      }).eq('id', projectData.id);

      const sizeMB = (totalBytes / 1048576).toFixed(1);
      setPrompt(`✅ Success! ${totalV} verts, ${chunks.length} chunks`);
      Alert.alert("Mesh Uploaded!", `${totalV} vertices\n${totalF} faces\n${chunks.length} chunks\n${sizeMB} MB`);
    } catch (e: any) {
      console.log("Mesh export error:", e);
      Alert.alert("Error", e.message || "Unknown error");
      setPrompt("Mesh export error.");
    }
  };

  const tronBlue = '#33CCFF';
  const freeOrange = '#FF9800';

  // Auto-edge handlers
  const handleDetectEdges = async () => {
    try {
      const result = await rulerRef.current?.detectEdges(edgeThreshold);
      if (result?.error) { Alert.alert('Error', result.error); return; }
      setDetectedEdgeCount(result?.edgeCount || 0);
      setDetectedPolylineCount(result?.polylineCount || 0);
      setPrompt(`Detected ${result?.edgeCount || 0} edges, ${result?.polylineCount || 0} polylines`);
    } catch (e) { console.log(e); }
  };

  const handleConfirmEdges = async () => {
    try {
      const confirmed = await rulerRef.current?.confirmEdges();
      if (confirmed?.length) {
        for (const shape of confirmed) {
          const newCount = shapeCount + 1;
          setShapeCount(newCount);
          await autoSaveShape(shape, newCount);
        }
        setPrompt(`✅ ${confirmed.length} edge polylines saved!`);
      }
      setDetectedEdgeCount(0);
      setDetectedPolylineCount(0);
    } catch (e) { console.log(e); }
  };

  const handleClearEdges = async () => {
    try {
      await rulerRef.current?.clearEdges();
      setDetectedEdgeCount(0);
      setDetectedPolylineCount(0);
      setPrompt('Edges cleared.');
    } catch (e) { console.log(e); }
  };

  // Toggle auto-detect
  const toggleAutoDetect = () => {
    if (autoDetect) {
      // Turning off — show confirm/reject if edges exist
      setAutoDetect(false);
      if (detectedEdgeCount > 0) {
        Alert.alert(
          'Detected Edges',
          `${detectedPolylineCount} polylines found. Keep them?`,
          [
            { text: 'Reject', style: 'destructive', onPress: handleClearEdges },
            { text: 'Confirm', onPress: handleConfirmEdges },
          ]
        );
      }
    } else {
      setAutoDetect(true);
      handleDetectEdges();
    }
  };

  const handleTakePhoto = async () => {
    if (!userId || !projectData) {
      Alert.alert("Login Required", "Sign in to take photos.");
      return;
    }
    try {
      setIsUploadingPhoto(true);
      setPhotosTaken(prev => prev + 1);
      addLog(`📷 Taking photo #${photosTaken + 1}...`);
      setPrompt("Capturing photo...");
      const result = await rulerRef.current?.takePhoto();
      if (!result || !result.uri || !result.transform) {
        throw new Error("No photo captured");
      }
      addLog(`📷 Photo captured, reading file...`);

      const fileName = `${userId}/${projectData.id}_${Date.now()}.jpg`;

      // Read photo as base64 and upload as binary (FormData doesn't work reliably on RN)
      const photoBase64 = await FileSystem.readAsStringAsync(result.uri.replace('file://', ''), {
        encoding: FileSystem.EncodingType.Base64,
      });
      const byteArray = Uint8Array.from(atob(photoBase64), c => c.charCodeAt(0));
      addLog(`📷 Photo size: ${(byteArray.length / 1024).toFixed(0)}KB, uploading...`);

      const { error: uploadErr } = await supabase.storage
        .from('ar-photos')
        .upload(fileName, byteArray, {
          contentType: 'image/jpeg',
          upsert: false,
        });
      if (uploadErr) throw uploadErr;
      addLog(`📷 Photo uploaded to storage ✓`);

      const { data: publicUrlData } = supabase.storage.from('ar-photos').getPublicUrl(fileName);

      const photoId = `photo_${Date.now()}`;
      await supabase.from('ar_photos').insert({
        id: photoId,
        project_id: projectData.id,
        user_id: userId,
        file_path: fileName,
        public_url: publicUrlData.publicUrl,
        transform: result.transform
      });
      setPhotosUploaded(prev => prev + 1);
      addLog(`📷 Photo #${photosUploaded + 1} saved to DB ✅`);
      setPrompt("📷 Photo saved to map!");
    } catch (e: any) {
      console.log("Photo error:", e);
      addLog(`📷 ❌ Photo error: ${e.message}`);
      Alert.alert("Photo Error", e.message || "Failed to capture photo");
      setPrompt("Photo capture failed.");
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  return (
    <View style={styles.container}>
      <ARRulerNativeView
        ref={rulerRef}
        style={styles.arContainer}
        onUpdate={handleUpdate}
        onPlaneStateChange={handlePlaneState}
        drawingMode={drawingMode}
        meshColor="#00FF66"
        showWire={showWire}
        showRoomPlan={showRoomPlan}
      />

      {/* ═══ SCI-FI MEMORY HUD ═══ */}
      {memoryStats && (
        <View style={{
          position: 'absolute', top: 46, right: 8, width: 160,
          backgroundColor: 'rgba(10,10,30,0.85)', borderRadius: 10,
          borderWidth: 1, 
          borderColor: memoryStats.availableMemoryMB < 300 
            ? 'rgba(244,67,54,0.8)' 
            : memoryStats.availableMemoryMB < 500 
              ? 'rgba(255,152,0,0.6)' 
              : 'rgba(0,255,100,0.3)',
          padding: 8, gap: 6,
          shadowColor: memoryStats.availableMemoryMB < 300 ? '#F44336' : '#00FF66',
          shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
        }}>
          {/* RAM Bar */}
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 8, fontWeight: 'bold', letterSpacing: 1 }}>RAM</Text>
              <Text style={{ color: '#FFF', fontSize: 8, fontWeight: 'bold' }}>
                {Math.round(memoryStats.availableMemoryMB)}MB free
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
              <View style={{
                height: '100%', borderRadius: 3,
                width: `${Math.min(100, Math.max(5, (1 - memoryStats.availableMemoryMB / 1500) * 100))}%`,
                backgroundColor: memoryStats.availableMemoryMB < 200 ? '#F44336' 
                  : memoryStats.availableMemoryMB < 400 ? '#FF9800' 
                  : memoryStats.availableMemoryMB < 600 ? '#FFC107' 
                  : '#4CAF50',
              }} />
            </View>
          </View>

          {/* Mesh Bar */}
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 8, fontWeight: 'bold', letterSpacing: 1 }}>MESH</Text>
              <Text style={{ color: '#FFF', fontSize: 8 }}>
                {(memoryStats.meshVertexCount / 1000).toFixed(0)}k vtx
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
              <View style={{
                height: '100%', borderRadius: 3,
                width: `${Math.min(100, Math.max(5, memoryStats.meshSizeMB / 45 * 100))}%`,
                backgroundColor: memoryStats.meshSizeMB > 40 ? '#F44336' 
                  : memoryStats.meshSizeMB > 25 ? '#FF9800' 
                  : memoryStats.meshSizeMB > 15 ? '#FFC107' 
                  : '#00E676',
              }} />
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 7, textAlign: 'right', marginTop: 1 }}>
              {memoryStats.meshSizeMB.toFixed(1)} / 45 MB
            </Text>
          </View>

          {/* Status indicator */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <View style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: memoryStats.meshPaused ? '#F44336' 
                : memoryStats.availableMemoryMB < 400 ? '#FF9800' 
                : '#00E676',
              shadowColor: memoryStats.meshPaused ? '#F44336' : '#00E676',
              shadowOpacity: 1, shadowRadius: 4,
            }} />
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 7, fontWeight: 'bold', letterSpacing: 0.5 }}>
              {memoryStats.meshPaused ? '⏸ MESH PAUSED' 
                : memoryStats.availableMemoryMB < 400 ? '⚡ HIGH LOAD' 
                : `● ${memoryStats.meshAnchorCount} anchors`}
            </Text>
          </View>
        </View>
      )}

      {/* ═══ MEMORY ALERT MODAL ═══ */}
      {showMemoryAlert && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center',
          zIndex: 999,
        }}>
          <View style={{
            backgroundColor: '#1a1a2e', borderRadius: 16, padding: 24,
            width: '85%', borderWidth: 1, borderColor: '#F44336',
            shadowColor: '#F44336', shadowOpacity: 0.6, shadowRadius: 20,
          }}>
            <Text style={{ color: '#F44336', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
              ⚠️ MEMORY CRITICAL
            </Text>
            <Text style={{ color: '#FFF', fontSize: 14, textAlign: 'center', marginBottom: 4 }}>
              Mesh scan paused to prevent crash.
            </Text>
            {memoryStats && (
              <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 10, marginVertical: 10 }}>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, textAlign: 'center' }}>
                  🧠 RAM: {Math.round(memoryStats.availableMemoryMB)}MB free
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, textAlign: 'center' }}>
                  📐 Mesh: {(memoryStats.meshVertexCount / 1000).toFixed(0)}k vertices ({memoryStats.meshSizeMB.toFixed(1)}MB)
                </Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 14, alignItems: 'center',
                  shadowColor: '#4CAF50', shadowOpacity: 0.5, shadowRadius: 8 }}
                onPress={() => { setShowMemoryAlert(false); rulerRef.current?.resumeMesh?.(); }}
              >
                <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 15 }}>▶ Resume</Text>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 9 }}>Continue scanning</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#FF9800', borderRadius: 10, paddingVertical: 14, alignItems: 'center',
                  shadowColor: '#FF9800', shadowOpacity: 0.5, shadowRadius: 8 }}
                onPress={() => { setShowMemoryAlert(false); /* TODO: upload mesh then clear */ }}
              >
                <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 15 }}>☁ Upload</Text>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 9 }}>Save & free memory</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Header */}
      <View style={[styles.headerOverlay, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>

        <View style={{ flex: 1, paddingLeft: 8 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {projectData ? projectData.name : 'AR Ruler'}
          </Text>
          {projectData && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: webOperatorOnline ? '#4CAF50' : '#F44336', marginRight: 6, shadowColor: webOperatorOnline ? '#4CAF50' : '#F44336', shadowOpacity: 0.8, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } }} />
              <Text style={{ color: webOperatorOnline ? '#4CAF50' : '#F44336', fontSize: 10, fontWeight: 'bold' }}>
                {webOperatorOnline ? 'WEB OPERATOR ONLINE' : 'WEB OFFLINE'}
              </Text>
            </View>
          )}
        </View>
        {/* Top Right Controls — SYNC + DELETE ALL */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={() => setShowDebugPanel(!showDebugPanel)}
            style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: showDebugPanel ? 'rgba(0,255,102,0.2)' : 'rgba(0,0,0,0.6)', borderRadius: 16, borderWidth: 1, borderColor: showDebugPanel ? '#00FF66' : 'rgba(255,255,255,0.2)' }}
          >
            <Text style={{ color: showDebugPanel ? '#00FF66' : '#FFF', fontSize: 10, fontWeight: 'bold' }}>{showDebugPanel ? '▼ SYNC' : '▶ SYNC'}</Text>
          </TouchableOpacity>

          {shapeCount > 0 && (
            <TouchableOpacity
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#FF1744', alignItems: 'center', justifyContent: 'center' }}
              onPress={handleReset}
              activeOpacity={0.7}
            >
              <Text style={{ color: '#FFF', fontSize: 16, fontWeight: 'bold', lineHeight: 18 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Compact status bar — email + logout + stats */}
      <View style={{ position: 'absolute', right: 12, top: insets.top + 48, left: 12, zIndex: 100 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: userId ? '#0f0' : '#f66', fontSize: 8, fontFamily: 'monospace', flex: 1 }}>
            {userId ? `● ${userEmail}` : '○ Anon'} | S:{shapeCount} P:{pendingCount} ✓:{uploadedCount}
          </Text>
          {userId && (
            <TouchableOpacity
              onPress={async () => { await supabase.auth.signOut(); setUserId(null); setProjectData(null); }}
              style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}
            >
              <Text style={{ color: '#f66', fontSize: 8, fontFamily: 'monospace' }}>LOGOUT</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ═══ UPLOAD PROGRESS ROWS ═══ */}
      <View style={{ position: 'absolute', right: 12, top: insets.top + 62, left: 12, zIndex: 99 }}>
        {/* Photo upload row */}
        {photosTaken > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isUploadingPhoto ? '#FF69B4' : '#E040FB', shadowColor: '#E040FB', shadowOpacity: isUploadingPhoto ? 0.8 : 0.3, shadowRadius: 4 }} />
            <Text style={{ color: '#E040FB', fontSize: 7, fontFamily: 'monospace', width: 60 }}>
              📷 {photosUploaded}/{photosTaken}
            </Text>
            <View style={{ flex: 1, height: 3, backgroundColor: 'rgba(224,64,251,0.15)', borderRadius: 2 }}>
              <View style={{ width: `${photosTaken > 0 ? (photosUploaded / photosTaken) * 100 : 0}%`, height: 3, backgroundColor: '#E040FB', borderRadius: 2 }} />
            </View>
            {isUploadingPhoto && <Text style={{ color: '#FF69B4', fontSize: 7, fontFamily: 'monospace' }}>⬆</Text>}
          </View>
        )}

        {/* Mesh upload row */}
        {(isUploadingMesh || meshChunksTotal > 0) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isUploadingMesh ? '#FF9800' : '#4CAF50', shadowColor: isUploadingMesh ? '#FF9800' : '#4CAF50', shadowOpacity: 0.6, shadowRadius: 4 }} />
            <Text style={{ color: '#FF9800', fontSize: 7, fontFamily: 'monospace', width: 60 }}>
              📐 {meshChunksUploaded}/{meshChunksTotal}
            </Text>
            <View style={{ flex: 1, height: 3, backgroundColor: 'rgba(255,152,0,0.15)', borderRadius: 2 }}>
              <View style={{ width: `${meshChunksTotal > 0 ? (meshChunksUploaded / meshChunksTotal) * 100 : 0}%`, height: 3, backgroundColor: meshChunksUploaded === meshChunksTotal ? '#4CAF50' : '#FF9800', borderRadius: 2 }} />
            </View>
            {isUploadingMesh && <Text style={{ color: '#FF9800', fontSize: 7, fontFamily: 'monospace' }}>⬆</Text>}
          </View>
        )}

        {/* Finalization progress row */}
        {isRoomFinalizing && finalizationStep !== '' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3, gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFD600', shadowColor: '#FFD600', shadowOpacity: 0.8, shadowRadius: 4 }} />
            <Text style={{ color: '#FFD600', fontSize: 7, fontFamily: 'monospace', flex: 1 }} numberOfLines={1}>
              ⚙ {finalizationStep}
            </Text>
            <View style={{ width: 60, height: 3, backgroundColor: 'rgba(255,214,0,0.15)', borderRadius: 2 }}>
              <View style={{ width: `${finalizationProgress}%`, height: 3, backgroundColor: '#FFD600', borderRadius: 2 }} />
            </View>
            <Text style={{ color: '#FFD600', fontSize: 7, fontFamily: 'monospace' }}>{Math.round(finalizationProgress)}%</Text>
          </View>
        )}
      </View>

      {/* Tool buttons — right side: DELETE ALL + WIRE + ROOM + SCAN */}
      <View style={{ position: 'absolute', right: 12, bottom: insets.bottom + 20, zIndex: 15, gap: 6, alignItems: 'center' }} pointerEvents="box-none">

        <TouchableOpacity
          style={[styles.circleBtn, { borderColor: isUploadingPhoto ? '#FF69B4' : '#E0E0E0', backgroundColor: isUploadingPhoto ? '#FF69B4' : '#E0E0E0' }]}
          onPress={handleTakePhoto}
          activeOpacity={0.7}
        >
          <Text style={[styles.circleBtnText, { color: '#000', fontSize: 24, marginTop: -4 }]}>📷</Text>
          {photosTaken > 0 && (
            <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: '#E040FB', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
              <Text style={{ color: '#FFF', fontSize: 8, fontWeight: 'bold' }}>{photosTaken}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.circleBtn, showWire && { borderColor: tronBlue, backgroundColor: tronBlue }]}
          onPress={() => setShowWire(!showWire)}
          activeOpacity={0.7}
        >
          <Text style={[styles.circleBtnText, showWire && { color: '#000' }]}>WIRE</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.circleBtn, meshExportEnabled && { borderColor: '#FF9800', backgroundColor: '#FF9800' }]}
          onPress={() => setMeshExportEnabled(!meshExportEnabled)}
          activeOpacity={0.7}
        >
          <Text style={[styles.circleBtnText, meshExportEnabled && { color: '#000' }]}>MESH</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.circleBtn, showRoomPlan && { borderColor: '#AB47BC', backgroundColor: '#AB47BC' }]}
          onPress={() => setShowRoomPlan(!showRoomPlan)}
          activeOpacity={0.7}
        >
          <Text style={[styles.circleBtnText, showRoomPlan && { color: '#FFF' }]}>ROOM</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.circleBtn,
          isRoomScanning ? { borderColor: '#FF1744', backgroundColor: '#FF1744' } :
            isRoomFinalizing ? { borderColor: '#FFD600', backgroundColor: '#FFD600' } :
              { borderColor: '#4CAF50', backgroundColor: '#222' }
          ]}
          onPress={isRoomScanning ? handleStopRoomScan : handleStartRoomScan}
          disabled={isRoomFinalizing}
          activeOpacity={0.7}
        >
          {isRoomFinalizing ? (
            <View style={{ alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#000" />
              <Text style={{ color: '#000', fontSize: 6, fontWeight: 'bold', marginTop: 1 }}>{Math.round(finalizationProgress)}%</Text>
            </View>
          ) : isRoomScanning ? (
            <Text style={[styles.circleBtnText, { color: '#FFF' }]}>STOP</Text>
          ) : (
            <Text style={[styles.circleBtnText, { color: '#4CAF50' }]}>SCAN</Text>
          )}
        </TouchableOpacity>

        {/* Capture Detail button — only visible during scanning */}
        {isRoomScanning && (
          <TouchableOpacity
            style={[styles.circleBtn, { borderColor: '#E040FB', backgroundColor: '#222', width: 52, height: 52 }]}
            onPress={handleCaptureDetail}
            activeOpacity={0.7}
          >
            <Text style={[styles.circleBtnText, { color: '#E040FB', fontSize: 8 }]}>📷{"\n"}DETAIL</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Cut Room controls — only when CUT=ON */}
      {cutActive && (
        <View style={{ position: 'absolute', left: 12, right: 70, top: '58%', zIndex: 25, backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: 'rgba(255,77,0,0.4)' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: '#FF4D00', fontSize: 10, fontWeight: 'bold' }}>✂ CUT SECTION</Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9 }}>{cutPointCount} pts</Text>
          </View>
          {/* H / V toggle */}
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
            <TouchableOpacity
              onPress={async () => { setCutType('horizontal'); await rulerRef.current?.setCutActive(true, 'horizontal'); }}
              style={{ flex: 1, padding: 6, borderRadius: 6, alignItems: 'center', backgroundColor: cutType === 'horizontal' ? 'rgba(255,77,0,0.3)' : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: cutType === 'horizontal' ? '#FF4D00' : 'rgba(255,255,255,0.1)' }}
            >
              <Text style={{ color: cutType === 'horizontal' ? '#FF4D00' : '#888', fontSize: 10, fontWeight: 'bold' }}>HORIZONTAL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => { setCutType('vertical'); await rulerRef.current?.setCutActive(true, 'vertical'); }}
              style={{ flex: 1, padding: 6, borderRadius: 6, alignItems: 'center', backgroundColor: cutType === 'vertical' ? 'rgba(255,77,0,0.3)' : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: cutType === 'vertical' ? '#FF4D00' : 'rgba(255,255,255,0.1)' }}
            >
              <Text style={{ color: cutType === 'vertical' ? '#FF4D00' : '#888', fontSize: 10, fontWeight: 'bold' }}>VERTICAL</Text>
            </TouchableOpacity>
          </View>
          {/* Height control */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Text style={{ color: '#FF4D00', fontSize: 9, width: 50 }}>HEIGHT</Text>
            <TouchableOpacity onPress={async () => { const h = cutHeight - 0.1; setCutHeight(h); await rulerRef.current?.setCutHeight(h); }} style={{ backgroundColor: 'rgba(255,77,0,0.2)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4 }}>
              <Text style={{ color: '#FF4D00', fontSize: 14, fontWeight: 'bold' }}>↓</Text>
            </TouchableOpacity>
            <Text style={{ color: '#FFF', fontSize: 11, flex: 1, textAlign: 'center' }}>{cutHeight.toFixed(2)}m</Text>
            <TouchableOpacity onPress={async () => { const h = cutHeight + 0.1; setCutHeight(h); await rulerRef.current?.setCutHeight(h); }} style={{ backgroundColor: 'rgba(255,77,0,0.2)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4 }}>
              <Text style={{ color: '#FF4D00', fontSize: 14, fontWeight: 'bold' }}>↑</Text>
            </TouchableOpacity>
          </View>
          {/* Rotation control (vertical only) */}
          {cutType === 'vertical' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Text style={{ color: '#FF4D00', fontSize: 9, width: 50 }}>ROTATE</Text>
              <TouchableOpacity onPress={async () => { const r = cutRotation - 15; setCutRotation(r); await rulerRef.current?.setCutRotation(r); }} style={{ backgroundColor: 'rgba(255,77,0,0.2)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4 }}>
                <Text style={{ color: '#FF4D00', fontSize: 14, fontWeight: 'bold' }}>↶</Text>
              </TouchableOpacity>
              <Text style={{ color: '#FFF', fontSize: 11, flex: 1, textAlign: 'center' }}>{cutRotation}°</Text>
              <TouchableOpacity onPress={async () => { const r = cutRotation + 15; setCutRotation(r); await rulerRef.current?.setCutRotation(r); }} style={{ backgroundColor: 'rgba(255,77,0,0.2)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4 }}>
                <Text style={{ color: '#FF4D00', fontSize: 14, fontWeight: 'bold' }}>↷</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Save cut */}
          <TouchableOpacity
            onPress={async () => {
              try {
                const result = await rulerRef.current?.getCutResult();
                if (!result || !result.polyline?.length) { Alert.alert('No cut', 'Move the plane to intersect the mesh.'); return; }
                if (userId && projectData?.id) {
                  const cutId = `cut_${Date.now()}`;
                  await supabase.from('ar_cuts').insert({
                    id: cutId,
                    project_id: projectData.id,
                    user_id: userId,
                    cut_type: result.cutType,
                    plane_height: result.planeHeight,
                    plane_rotation: result.planeRotation,
                    polyline: result.polyline,
                    total_length: result.totalLength,
                    segment_count: result.segmentCount,
                  });
                  setPrompt(`✂ Cut saved! ${result.pointCount} points, ${result.totalLength.toFixed(2)}m`);
                } else {
                  Alert.alert('Not logged in', 'Log in to save cuts.');
                }
              } catch (e: any) { Alert.alert('Error', e.message); }
            }}
            style={{ backgroundColor: '#FF4D00', padding: 8, borderRadius: 8, alignItems: 'center', marginTop: 4 }}
          >
            <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>💾 SAVE CUT</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Mode button — left side, cyclic button + context buttons above */}
      <View style={{ position: 'absolute', left: 12, bottom: insets.bottom + 20, zIndex: 15, gap: 6, alignItems: 'center' }} pointerEvents="box-none">
        {/* CLOSE / SAVE OPEN — shown when enough points, same circle size */}
        {pointCount >= 3 && (
          <>
            <TouchableOpacity
              style={[styles.circleBtn, { borderColor: tronBlue, backgroundColor: tronBlue }]}
              onPress={handleCloseShape}
              activeOpacity={0.7}
            >
              <Text style={[styles.circleBtnText, { color: '#000', fontSize: 9 }]}>CLOSE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.circleBtn, { borderColor: '#FFD700', backgroundColor: '#FFD700' }]}
              onPress={handleSaveOpenShape}
              activeOpacity={0.7}
            >
              <Text style={[styles.circleBtnText, { color: '#000', fontSize: 8 }]}>SAVE{"\n"}OPEN</Text>
            </TouchableOpacity>
          </>
        )}
        {pointCount === 2 && (
          <TouchableOpacity
            style={[styles.circleBtn, { borderColor: '#FFD700', backgroundColor: '#FFD700' }]}
            onPress={handleSaveOpenShape}
            activeOpacity={0.7}
          >
            <Text style={[styles.circleBtnText, { color: '#000', fontSize: 8 }]}>SAVE{"\n"}LINE</Text>
          </TouchableOpacity>
        )}

        {/* Cyclic mode button — FLOOR → WALL → FREE, fully colored */}
        <TouchableOpacity
          style={[styles.circleBtn, {
            borderColor: drawingMode === 'free' ? freeOrange : drawingMode === 'wall' ? wallPink : tronBlue,
            backgroundColor: drawingMode === 'free' ? freeOrange : drawingMode === 'wall' ? wallPink : tronBlue,
          }]}
          onPress={() => {
            const modes: Array<'floor' | 'wall' | 'free'> = ['floor', 'wall', 'free'];
            const idx = modes.indexOf(drawingMode);
            const next = modes[(idx + 1) % modes.length];
            setDrawingMode(next);
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.circleBtnText, { color: '#000', fontWeight: 'bold' }]}>
            {drawingMode.toUpperCase()}
          </Text>
        </TouchableOpacity>
      </View>

      {/* + Add point — center bottom */}
      <View style={{ position: 'absolute', bottom: insets.bottom + 20, left: 0, right: 0, alignItems: 'center', zIndex: 15 }} pointerEvents="box-none">
        {/* Hint text above buttons */}
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, marginBottom: 6, fontWeight: '500' }}>
          {pointCount === 0 ? (floorDetected || drawingMode !== 'floor' ? 'Tap + to add first corner' : 'Scanning floor...') :
            pointCount < 3 ? `${pointCount} pts — tap more corners` :
              `${pointCount} pts — CLOSE or SAVE OPEN`}
        </Text>

        {/* UNDO circle above + button — only when drawing (pointCount > 0) */}
        {pointCount > 0 && (
          <TouchableOpacity
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#333', borderWidth: 2, borderColor: '#555', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}
            onPress={handleUndo}
            activeOpacity={0.7}
          >
            <Text style={{ color: '#FFF', fontSize: 20 }}>↩</Text>
          </TouchableOpacity>
        )}

        {/* + button — same 56px circle */}
        <TouchableOpacity
          style={[styles.circleBtn, {
            width: 64, height: 64, borderRadius: 32,
            borderColor: drawingMode === 'free' ? freeOrange : drawingMode === 'wall' ? wallPink : tronBlue,
            backgroundColor: drawingMode === 'free' ? freeOrange : drawingMode === 'wall' ? wallPink : tronBlue,
          }]}
          onPress={handleAddPoint}
          activeOpacity={0.7}
        >
          <Text style={{ color: '#000', fontSize: 36, lineHeight: 40, fontWeight: '300', marginTop: -2 }}>+</Text>
        </TouchableOpacity>
      </View>

      {/* ===== ANCHOR PLACEMENT OVERLAY — RED +ADD button when isPlacingAnchors ===== */}
      {isPlacingAnchors && (
        <View style={{ position: 'absolute', bottom: insets.bottom + 20, left: 0, right: 0, alignItems: 'center', zIndex: 20 }} pointerEvents="box-none">
          {/* Anchor count + status */}
          <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold', marginBottom: 8, textShadowColor: '#000', textShadowRadius: 4 }}>
            📍 Kotvy: {anchorCount}{anchorCount >= 3 ? ' ✅' : ` (min. 3)`}
          </Text>

          {/* Bod / Hrana toggle */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <TouchableOpacity
              style={{
                paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
                backgroundColor: anchorType === 'point' ? '#FF1744' : 'rgba(255,255,255,0.15)',
                borderWidth: 2, borderColor: anchorType === 'point' ? '#FF1744' : 'rgba(255,255,255,0.3)',
              }}
              onPress={() => setAnchorType('point')}
            >
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>⚫ Bod</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
                backgroundColor: anchorType === 'edge' ? '#FF1744' : 'rgba(255,255,255,0.15)',
                borderWidth: 2, borderColor: anchorType === 'edge' ? '#FF1744' : 'rgba(255,255,255,0.3)',
              }}
              onPress={() => setAnchorType('edge')}
            >
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: 'bold' }}>│ Hrana</Text>
            </TouchableOpacity>
          </View>

          {/* RED + button — place anchor at crosshair */}
          <TouchableOpacity
            style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: '#FF1744', borderWidth: 3, borderColor: '#FF1744',
              alignItems: 'center', justifyContent: 'center',
              shadowColor: '#FF1744', shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
            }}
            onPress={handlePlaceAnchorTap}
            activeOpacity={0.7}
          >
            <Text style={{ color: '#FFF', fontSize: 36, lineHeight: 40, fontWeight: '300', marginTop: -2 }}>+</Text>
          </TouchableOpacity>

          {/* Hotovo button — only when >= 3 anchors */}
          {anchorCount >= 3 && (
            <TouchableOpacity
              style={{
                marginTop: 10, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20,
                backgroundColor: '#4CAF50', borderWidth: 2, borderColor: '#4CAF50',
              }}
              onPress={handleFinishAnchors}
              activeOpacity={0.7}
            >
              <Text style={{ color: '#FFF', fontSize: 14, fontWeight: 'bold' }}>Hotovo ✅</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ===== SYNC LOG — full-width, collapsible ===== */}
      {!showDebugPanel && (
        <View style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 90, zIndex: 98, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', gap: 8 }}>
          {logsM.length > 0 && <Text style={{ color: '#33CCFF', fontSize: 7, fontFamily: 'monospace', flex: 1 }} numberOfLines={1}>📐 {logsM[0]?.replace(/\[.*?\]\s*/, '')}</Text>}
          {logsB.length > 0 && <Text style={{ color: '#4CAF50', fontSize: 7, fontFamily: 'monospace', flex: 1 }} numberOfLines={1}>🏠 {logsB[0]?.replace(/\[.*?\]\s*/, '')}</Text>}
        </View>
      )}

      {showDebugPanel && (
        <ScrollView style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 90, maxHeight: 380, backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 10, padding: 8, zIndex: 99, borderWidth: 1, borderColor: 'rgba(0,255,100,0.2)' }}>

          {/* 1. MEASUREMENTS */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#33CCFF' }} />
            <Text style={{ color: '#33CCFF', fontSize: 9, fontWeight: 'bold', fontFamily: 'monospace', flex: 1 }}>MEASUREMENTS (15s)</Text>
          </View>
          {logsM.slice(0, 2).map((l, i) => (
            <Text key={`m${i}`} style={{ color: l.includes('❌') ? '#f66' : '#8cf', fontSize: 7, fontFamily: 'monospace', paddingLeft: 14, marginBottom: 1 }}>{l}</Text>
          ))}

          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 3 }} />

          {/* 2. CAD + ROOMPLAN */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50' }} />
            <Text style={{ color: '#4CAF50', fontSize: 9, fontWeight: 'bold', fontFamily: 'monospace', flex: 1 }}>CAD + ROOMPLAN (15s)</Text>
          </View>
          {logsB.slice(0, 2).map((l, i) => (
            <Text key={`b${i}`} style={{ color: l.includes('❌') ? '#f66' : '#8f8', fontSize: 7, fontFamily: 'monospace', paddingLeft: 14, marginBottom: 1 }}>{l}</Text>
          ))}

          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 3 }} />

          {/* 3. ANCHORS */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#9C27B0' }} />
            <Text style={{ color: '#CE93D8', fontSize: 9, fontWeight: 'bold', fontFamily: 'monospace' }}>ANCHORS (always)</Text>
          </View>
          {logsA.slice(0, 2).map((l, i) => (
            <Text key={`a${i}`} style={{ color: l.includes('❌') ? '#f66' : '#c8f', fontSize: 7, fontFamily: 'monospace', paddingLeft: 14, marginBottom: 1 }}>{l}</Text>
          ))}

          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 3 }} />

          {/* 4. MESHES */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF9800' }} />
            <Text style={{ color: '#FF9800', fontSize: 9, fontWeight: 'bold', fontFamily: 'monospace', flex: 1 }}>MESHES ({chunkSizeMB}MB chunks)</Text>
          </View>
          {logsMesh.slice(0, 2).map((l, i) => (
            <Text key={`mesh${i}`} style={{ color: l.includes('❌') ? '#f66' : '#fc8', fontSize: 7, fontFamily: 'monospace', paddingLeft: 14, marginBottom: 1 }}>{l}</Text>
          ))}
        </ScrollView>
      )}

      {/* ===== LOGIN MODAL ===== */}
      <Modal visible={showLoginModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🔐 Sign In</Text>
            <Text style={styles.modalSubtitle}>Sign in to save projects & sync to cloud</Text>

            {loginError && <Text style={styles.loginError}>{loginError}</Text>}

            <TextInput
              style={styles.modalInput}
              placeholder="Email"
              placeholderTextColor="#666"
              value={loginEmail}
              onChangeText={setLoginEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Password"
              placeholderTextColor="#666"
              value={loginPassword}
              onChangeText={setLoginPassword}
              secureTextEntry
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalBtnSkip} onPress={handleSkipLogin}>
                <Text style={styles.modalBtnSkipText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtnCreate, { backgroundColor: tronBlue }]} onPress={handleQuickLogin} disabled={loginLoading}>
                {loginLoading
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={[styles.modalBtnCreateText, { color: '#000' }]}>Sign In</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ===== PROJECT MODAL ===== */}
      <Modal visible={showProjectModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.modalTitle}>📁 Project Setup</Text>
            </View>

            {/* TABS */}
            {userId && (
              <View style={styles.tabContainer}>
                <TouchableOpacity style={[styles.tabBtn, projectModalTab === 'new' && styles.tabBtnActive]} onPress={() => setProjectModalTab('new')}>
                  <Text style={[styles.tabText, projectModalTab === 'new' && styles.tabTextActive]}>New Project</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tabBtn, projectModalTab === 'load' && styles.tabBtnActive]} onPress={() => setProjectModalTab('load')}>
                  <Text style={[styles.tabText, projectModalTab === 'load' && styles.tabTextActive]}>Load Existing</Text>
                </TouchableOpacity>
              </View>
            )}

            {projectModalTab === 'new' || !userId ? (
              <>
                <Text style={styles.modalSubtitle}>
                  {userId ? "Create a new project to save your room scan." : "Free mode — data won't sync without account."}
                </Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Project Name..."
                  placeholderTextColor="#666"
                  value={projectNameInput}
                  onChangeText={setProjectNameInput}
                  autoFocus={true}
                />
              </>
            ) : (
              <View style={styles.projectListContainer}>
                <Text style={styles.modalSubtitle}>Select a project to resume (restores AR Anchor):</Text>
                {userProjects.length === 0 ? (
                  <Text style={{ color: '#888', fontStyle: 'italic', marginBottom: 16 }}>No projects found.</Text>
                ) : (
                  <View style={{ maxHeight: 150, marginBottom: 16 }}>
                    <FlatList
                      data={userProjects}
                      keyExtractor={item => item.id}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={[styles.projectListItem, selectedLoadProjectId === item.id && styles.projectListItemSelected]}
                          onPress={() => setSelectedLoadProjectId(item.id)}
                        >
                          <Text style={{ color: selectedLoadProjectId === item.id ? '#000' : '#FFF', fontWeight: 'bold' }}>{item.name}</Text>
                        </TouchableOpacity>
                      )}
                    />
                  </View>
                )}
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalBtnSkip} onPress={handleSkipProject}>
                <Text style={styles.modalBtnSkipText}>Free Mode</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtnCreate, { backgroundColor: projectModalTab === 'load' ? '#33CCFF' : '#4CAF50' }]} onPress={handleCreateProject}>
                <Text style={styles.modalBtnCreateText}>{projectModalTab === 'load' ? 'Load' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  arContainer: { flex: 1 },

  debugWindow: { position: 'absolute', left: 12, backgroundColor: 'rgba(0,0,0,0.75)', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#333', zIndex: 999 },
  debugTitle: { color: '#0f0', fontSize: 11, fontWeight: 'bold', marginBottom: 2 },
  debugText: { color: '#AAA', fontSize: 10, marginBottom: 4 },
  syncBtn: { backgroundColor: '#007AFF', padding: 4, borderRadius: 4, alignItems: 'center' },
  syncBtnText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },

  headerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm, zIndex: 10 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 20, color: '#FFF' },
  headerTitle: { flex: 1, fontFamily: typography.fontFamily.semiBold, fontSize: typography.fontSize.md, color: '#FFF' },
  actionButton: { paddingHorizontal: spacing.sm, paddingVertical: 10, borderRadius: borderRadius.sm, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  actionButtonText: { color: '#FFF', fontFamily: typography.fontFamily.bold, fontSize: 12, letterSpacing: 1 },

  modeSelectorContainer: { position: 'absolute', left: spacing.md, right: spacing.md, zIndex: 11 },
  segmentedControl: { height: 36, borderRadius: 18 },

  promptOverlay: { position: 'absolute', top: 70, left: spacing.md, right: spacing.md, alignItems: 'center', zIndex: 12, pointerEvents: 'none' },
  promptText: { backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 30, fontFamily: typography.fontFamily.semiBold, fontSize: 13, ...shadows.md, overflow: 'hidden' },

  bottomPanel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(5,10,20,0.92)', borderTopWidth: 1, borderTopColor: 'rgba(51,204,255,0.2)', flexDirection: 'row', justifyContent: 'space-evenly', paddingTop: spacing.lg, zIndex: 10 },
  measureBox: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  measureValue: { color: '#FFF', fontSize: 28, fontFamily: typography.fontFamily.bold },
  measureUnit: { fontSize: 16, color: '#33CCFF' },
  measureLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: typography.fontFamily.medium, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },
  measureDivider: { width: 1, backgroundColor: 'rgba(51,204,255,0.2)', height: '70%' },
  exportButton: { paddingHorizontal: spacing.md, paddingVertical: 12, backgroundColor: '#2196F3', borderRadius: borderRadius.md, justifyContent: 'center', alignItems: 'center' },

  ceilingBtn: { marginTop: 4, backgroundColor: 'rgba(51,204,255,0.4)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  ceilingBtnText: { color: '#FFF', fontSize: 9, fontWeight: 'bold' },

  centerAddButtonContainer: { position: 'absolute', bottom: 150, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 20 },
  wireToggle: { position: 'absolute', right: 12, top: '45%', backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 12, zIndex: 25, alignItems: 'center' },
  wireToggleActive: { borderColor: '#33CCFF', backgroundColor: 'rgba(51,204,255,0.15)' },
  wireToggleText: { color: '#666', fontFamily: typography.fontFamily.bold, fontSize: 11, letterSpacing: 1, textAlign: 'center' },
  modeButton: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  modeButtonActive: { borderColor: '#33CCFF', backgroundColor: 'rgba(51,204,255,0.2)' },
  modeButtonText: { color: '#666', fontFamily: typography.fontFamily.bold, fontSize: 10, letterSpacing: 1, textAlign: 'center' },
  // Unified circle button — all buttons same size
  circleBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#222', borderWidth: 2, borderColor: '#555', alignItems: 'center', justifyContent: 'center' },
  circleBtnText: { color: '#666', fontFamily: typography.fontFamily.bold, fontSize: 11, letterSpacing: 1, textAlign: 'center' },
  addPointButton: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 3, alignItems: 'center', justifyContent: 'center', ...shadows.lg },
  addPointText: { fontSize: 36, lineHeight: 40, fontWeight: '300', marginTop: -2 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-start', paddingTop: 120, alignItems: 'center' },
  modalContent: { backgroundColor: '#111827', borderRadius: 16, padding: 24, width: '85%', borderWidth: 1, borderColor: 'rgba(51,204,255,0.3)' },
  modalTitle: { color: '#FFF', fontSize: 20, fontFamily: typography.fontFamily.bold, marginBottom: 6 },
  modalSubtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 16, lineHeight: 18 },
  modalInput: { backgroundColor: 'rgba(255,255,255,0.08)', color: '#FFF', borderRadius: 10, padding: 12, fontSize: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', marginBottom: 12 },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalBtnSkip: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center' },
  modalBtnSkipText: { color: '#888', fontWeight: 'bold', fontSize: 14 },
  modalBtnCreate: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  modalBtnCreateText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  loginError: { color: '#FF5555', fontSize: 12, marginBottom: 8, fontWeight: '600' },

  tabContainer: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 4, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  tabBtnActive: { backgroundColor: 'rgba(51,204,255,0.2)' },
  tabText: { color: '#888', fontSize: 13, fontFamily: typography.fontFamily.semiBold },
  tabTextActive: { color: '#33CCFF' },
  projectListContainer: { width: '100%' },
  projectListItem: { padding: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: 'transparent' },
  projectListItemSelected: { backgroundColor: '#33CCFF', borderColor: '#FFF' },

  toggleContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  toggleTitle: { color: '#FFF', fontSize: 13, fontFamily: typography.fontFamily.semiBold, marginBottom: 2 },
  toggleDesc: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: typography.fontFamily.regular },
});
