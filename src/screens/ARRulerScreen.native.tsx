import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, TextInput, ActivityIndicator, Switch, FlatList, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// SegmentedControl removed — mode buttons are now inline with + button
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/theme';
import { ARRulerNativeView } from '../../modules/ar-ruler-native';
import { supabase } from '../lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';

// Drawing mode colors
const tronBlue = '#33CCFF';
const levelsGreen = '#00E666';
const wallPink = '#FF4D99';

export default function ARRulerScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const rulerRef = useRef<any>(null);
  
  const [pointCount, setPointCount] = useState(0);
  const [roomHeight, setRoomHeight] = useState<number | null>(null);
  const [floorDetected, setFloorDetected] = useState(false);
  const [prompt, setPrompt] = useState("Move phone to scan floor...");
  const [drawingMode, setDrawingMode] = useState<'floor' | 'levels' | 'wall'>('floor');
  const [shapeCount, setShapeCount] = useState(0);
  const [showWire, setShowWire] = useState(true);
  
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
  const [autoExportMesh, setAutoExportMesh] = useState<boolean>(true);

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

  // Debug
  const [chunkSizeMB, setChunkSizeMB] = useState(10);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(true);
  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDebugLogs(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 30));
  }, []);

  useEffect(() => {
    checkAuthAndShowFlow();
  }, []);

  const checkAuthAndShowFlow = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUserId(session.user.id);
      setUserEmail(session.user.email || null);
      setShowProjectModal(true); // Logged in → show project modal
    } else {
      setShowLoginModal(true); // Not logged in → show login first
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
                setPrompt("Anchor localized! Resuming project.");
             } catch (e) {
                console.log("Load map error:", e);
                setPrompt("Failed to inject tracking anchor.");
             }
           };
           reader.readAsDataURL(data);
        } else {
           setPrompt("No anchor map found. Start fresh.");
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
      setPrompt(drawingMode === 'floor' ? "Move phone to scan floor..." : drawingMode === 'levels' ? "Levels mode — free height" : "Scan wall to begin");
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

  // --- Reset + Clean Supabase ---
  const handleReset = async () => {
    rulerRef.current?.reset();
    if (projectData?.id && userId) {
      try {
        await supabase.from('ar_measurements').delete().eq('project_id', projectData.id);
        await AsyncStorage.setItem('@ar_measurements', JSON.stringify([]));
        setPendingCount(0);
        setUploadedCount(0);
      } catch (e) { console.log("Reset cleanup error:", e); }
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
    } catch (e) {}
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
      
      if (cadData.planes) {
        await supabase.from('ar_projects')
          .update({ ar_anchors_json: cadData.planes })
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

      // 1. Export mesh chunks
      addLog(`📦 Exporting mesh chunks (max ${chunkSizeMB}MB each)...`);
      const chunks = await rulerRef.current?.exportMeshChunks(chunkSizeMB);
      if (chunks && chunks.length > 0 && !chunks[0].error) {
        addLog(`✅ Got ${chunks.length} chunks`);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const sizeMB = (chunk.byteSize / 1048576).toFixed(2);
          addLog(`  📤 Chunk ${i+1}/${chunks.length}: ${chunk.vertexCount}v ${chunk.faceCount}f ${sizeMB}MB`);
          const fileName = `${userId}/${projectData.id}_chunk_${i}.obj`;
          const fileUri = `${FileSystem.documentDirectory}temp_mesh_${Date.now()}_${i}.obj`;
          await FileSystem.writeAsStringAsync(fileUri, chunk.obj, { encoding: 'utf8' });
          const formData = new FormData();
          formData.append('file', { uri: fileUri, name: `chunk_${i}.obj`, type: 'model/obj' } as any);
          await supabase.storage.from('mesh-scans').upload(fileName, formData, { upsert: true });
          await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
          addLog(`  ✅ Chunk ${i+1} uploaded`);
        }
      } else {
        addLog(`⚠️ No mesh data: ${chunks?.[0]?.error || 'empty'}`);
      }

      // 2. Sync CAD data (bounding boxes, planes)
      addLog(`🏠 Syncing CAD data (boxes, planes)...`);
      await syncCADData();
      addLog(`✅ CAD data synced`);

      // 3. Save world anchor
      addLog(`⚓ Saving AR Anchor Map...`);
      const mapUrl = await rulerRef.current?.saveWorldMap();
      if (mapUrl) {
        const mapFileName = `${userId}/${projectData.id}_anchor.map`;
        const formDataMap = new FormData();
        formDataMap.append('file', { uri: `file://${mapUrl}`, name: 'anchor.map', type: 'application/octet-stream' } as any);
        await supabase.storage.from('mesh-scans').upload(mapFileName, formDataMap, { upsert: true });
        await FileSystem.deleteAsync(mapUrl, { idempotent: true }).catch(() => {});
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

  useEffect(() => {
    if (!autoExportMesh || !projectData || !userId) return;
    const interval = setInterval(() => {
      performAutoSave();
    }, 60000);
    return () => clearInterval(interval);
  }, [autoExportMesh, projectData, userId]);

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
        setPrompt(`Uploading chunk ${i+1}/${chunks.length}...`);
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
        await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
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
      
      setPrompt(`Syncing CAD Intelligence...`);
      await syncCADData();
      
      setPrompt(`Saving AR Anchor Map...`);
      const mapUrl = await rulerRef.current?.saveWorldMap();
      let mapFileName = "";
      if (mapUrl) {
        mapFileName = `${userId}/${projectData.id}_anchor.map`;
        const formDataMap = new FormData();
        formDataMap.append('file', { uri: `file://${mapUrl}`, name: 'anchor.map', type: 'application/octet-stream' } as any);
        await supabase.storage.from('mesh-scans').upload(mapFileName, formDataMap, { upsert: true });
        await FileSystem.deleteAsync(mapUrl, { idempotent: true }).catch(() => {});
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
  const levelsGreen = '#00E666';

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
      />
      
      {/* Header */}
      <View style={[styles.headerOverlay, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {projectData ? projectData.name : 'AR Ruler'}
        </Text>
        <TouchableOpacity style={styles.actionButton} onPress={handleUndo}>
          <Text style={styles.actionButtonText}>UNDO</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={handleReset}>
           <Text style={styles.actionButtonText}>RESET</Text>
        </TouchableOpacity>
      </View>

      {/* Login badge — right below header */}
      <View style={[styles.debugWindow, { top: insets.top + 36 }]}>
        <Text style={styles.debugTitle}>
          {userId ? `🟢 ${userEmail || 'Logged In'}` : '🔴 Anonymous'}
        </Text>
        <Text style={styles.debugText}>Shapes: {shapeCount} | Pending: {pendingCount} | Synced: {uploadedCount}</Text>
      </View>
      


      {/* Tool buttons — right side vertical (symmetric with FLOOR/FREE/WALL on left) */}
      <View style={{ position: 'absolute', right: 12, bottom: insets.bottom + 100, zIndex: 15, gap: 6 }} pointerEvents="box-none">
         <TouchableOpacity 
           style={[styles.modeButton, showWire && { ...styles.modeButtonActive, borderColor: tronBlue, backgroundColor: 'rgba(51,204,255,0.15)' }]}
           onPress={() => setShowWire(!showWire)}
           activeOpacity={0.7}
         >
            <Text style={[styles.modeButtonText, showWire && { color: tronBlue }]}>WIRE</Text>
         </TouchableOpacity>

         <TouchableOpacity 
           style={[styles.modeButton, { borderColor: '#4CAF50' }]}
           onPress={handleExportMesh}
           activeOpacity={0.7}
         >
            <Text style={[styles.modeButtonText, { color: '#4CAF50' }]}>EXPORT{"\n"}MESH</Text>
         </TouchableOpacity>

         <TouchableOpacity 
           style={[styles.modeButton, cutActive && { ...styles.modeButtonActive, borderColor: '#FF4D00', backgroundColor: 'rgba(255,77,0,0.15)' }]}
           onPress={async () => {
             if (cutActive) {
               await rulerRef.current?.clearCut();
               setCutActive(false);
               setCutPointCount(0);
               setPrompt('Cut cleared.');
             } else {
               setCutActive(true);
               await rulerRef.current?.setCutActive(true, cutType);
               setPrompt(`Cut ${cutType} — adjust with controls`);
             }
           }}
           activeOpacity={0.7}
         >
            <Text style={[styles.modeButtonText, cutActive && { color: '#FF4D00' }]}>CUT{"\n"}{cutActive ? 'ON' : 'OFF'}</Text>
         </TouchableOpacity>
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

      {/* Mode buttons — left side vertical */}
      <View style={{ position: 'absolute', left: 12, bottom: insets.bottom + 100, zIndex: 15, gap: 6 }} pointerEvents="box-none">
         <TouchableOpacity 
           style={[styles.modeButton, drawingMode === 'floor' && styles.modeButtonActive]} 
           onPress={() => { setDrawingMode('floor'); setPrompt(floorDetected ? 'Floor mode — locked Y' : 'Move phone to scan floor...'); }}
           activeOpacity={0.7}
         >
            <Text style={[styles.modeButtonText, drawingMode === 'floor' && { color: tronBlue }]}>FLOOR</Text>
         </TouchableOpacity>

         <TouchableOpacity 
           style={[styles.modeButton, drawingMode === 'levels' && { ...styles.modeButtonActive, borderColor: levelsGreen, backgroundColor: 'rgba(0,230,102,0.15)' }]} 
           onPress={() => { setDrawingMode('levels'); setPrompt('Free mode — any surface'); }}
           activeOpacity={0.7}
         >
            <Text style={[styles.modeButtonText, drawingMode === 'levels' && { color: levelsGreen }]}>FREE</Text>
         </TouchableOpacity>

         <TouchableOpacity 
           style={[styles.modeButton, drawingMode === 'wall' && { ...styles.modeButtonActive, borderColor: wallPink, backgroundColor: 'rgba(255,77,153,0.15)' }]} 
           onPress={() => { setDrawingMode('wall'); setPrompt('Wall mode — vertical surfaces'); }}
           activeOpacity={0.7}
         >
            <Text style={[styles.modeButtonText, drawingMode === 'wall' && { color: wallPink }]}>WALL</Text>
         </TouchableOpacity>

      </View>

      {/* + Add point — center bottom */}
      <View style={{ position: 'absolute', bottom: insets.bottom + 100, left: 0, right: 0, alignItems: 'center', zIndex: 15 }} pointerEvents="box-none">
         <TouchableOpacity style={[styles.addPointButton, { borderColor: drawingMode === 'levels' ? levelsGreen : drawingMode === 'wall' ? wallPink : tronBlue }]} onPress={handleAddPoint} activeOpacity={0.7}>
            <Text style={[styles.addPointText, { color: drawingMode === 'levels' ? levelsGreen : drawingMode === 'wall' ? wallPink : tronBlue }]}>+</Text>
         </TouchableOpacity>
      </View>
      


      {/* Bottom */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + spacing.lg }]}>
         {/* Prompt / Message row */}
         <View style={{ flex: 1, paddingHorizontal: spacing.sm, justifyContent: 'center' }}>
            <Text style={[styles.promptText, { color: floorDetected || drawingMode !== 'floor' ? tronBlue : '#FFD700', fontSize: 11, textAlign: 'center' }]} numberOfLines={2}>
              {prompt}
            </Text>
         </View>
         {pointCount >= 3 ? (
             <View style={{ flexDirection: 'row', flex: 1, gap: 6, marginHorizontal: spacing.sm, alignItems: 'center' }}>
               <TouchableOpacity 
                  style={[styles.exportButton, { flex: 1, backgroundColor: tronBlue }]}
                  onPress={handleCloseShape}
               >
                  <Text style={[styles.actionButtonText, { color: '#000' }]}>CLOSE</Text>
               </TouchableOpacity>
               <TouchableOpacity 
                  style={[styles.exportButton, { flex: 1, backgroundColor: '#FFD700' }]}
                  onPress={handleSaveOpenShape}
               >
                  <Text style={[styles.actionButtonText, { color: '#000' }]}>SAVE OPEN</Text>
               </TouchableOpacity>
             </View>
         ) : pointCount === 2 ? (
             <TouchableOpacity 
                style={[styles.exportButton, { flex: 1, marginHorizontal: spacing.md, backgroundColor: '#FFD700' }]}
                onPress={handleSaveOpenShape}
             >
                <Text style={[styles.actionButtonText, { color: '#000' }]}>SAVE LINE</Text>
             </TouchableOpacity>
         ) : (
             <View style={styles.measureBox}>
                 <Text style={styles.measureValue}>{pointCount}<Text style={styles.measureUnit}> pts</Text></Text>
                 <Text style={styles.measureLabel}>Corners</Text>
             </View>
         )}
         <View style={styles.measureDivider} />
      </View>

      {/* ===== DEBUG LOG PANEL ===== */}
      <TouchableOpacity
        style={{ position: 'absolute', right: 12, top: insets.top + 50, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}
        onPress={() => setShowDebugPanel(!showDebugPanel)}
      >
        <Text style={{ color: '#0f0', fontSize: 10, fontFamily: 'monospace' }}>{showDebugPanel ? '⚙ HIDE' : '⚙ LOG'}</Text>
      </TouchableOpacity>

      {showDebugPanel && (
        <View style={{ position: 'absolute', right: 12, top: insets.top + 80, width: 260, maxHeight: 300, backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 10, padding: 8, zIndex: 99, borderWidth: 1, borderColor: 'rgba(0,255,100,0.3)' }}>
          {/* Chunk Size Control */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 4 }}>
            <Text style={{ color: '#0f0', fontSize: 10, fontFamily: 'monospace', flex: 1 }}>CHUNK: {chunkSizeMB}MB</Text>
            <TouchableOpacity
              onPress={() => setChunkSizeMB(Math.max(1, chunkSizeMB - 5))}
              style={{ backgroundColor: 'rgba(255,100,100,0.3)', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 }}
            >
              <Text style={{ color: '#f66', fontSize: 12, fontWeight: 'bold' }}>-5</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setChunkSizeMB(Math.max(1, chunkSizeMB - 1))}
              style={{ backgroundColor: 'rgba(255,100,100,0.2)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}
            >
              <Text style={{ color: '#f99', fontSize: 12 }}>-1</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setChunkSizeMB(Math.min(50, chunkSizeMB + 1))}
              style={{ backgroundColor: 'rgba(100,255,100,0.2)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}
            >
              <Text style={{ color: '#9f9', fontSize: 12 }}>+1</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setChunkSizeMB(Math.min(50, chunkSizeMB + 5))}
              style={{ backgroundColor: 'rgba(100,255,100,0.3)', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 }}
            >
              <Text style={{ color: '#6f6', fontSize: 12, fontWeight: 'bold' }}>+5</Text>
            </TouchableOpacity>
          </View>
          {/* Auto-sync PAUSE/PLAY */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 4 }}>
            <TouchableOpacity
              onPress={() => setAutoExportMesh(!autoExportMesh)}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: autoExportMesh ? 'rgba(100,255,100,0.15)' : 'rgba(255,100,100,0.15)', borderRadius: 6, paddingVertical: 6, borderWidth: 1, borderColor: autoExportMesh ? 'rgba(0,255,100,0.4)' : 'rgba(255,100,100,0.4)' }}
            >
              <Text style={{ fontSize: 16 }}>{autoExportMesh ? '⏸' : '▶️'}</Text>
              <Text style={{ color: autoExportMesh ? '#6f6' : '#f66', fontSize: 11, fontWeight: 'bold', fontFamily: 'monospace' }}>
                {autoExportMesh ? 'PAUSE' : 'PLAY'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { addLog('🔄 MANUAL SYNC triggered'); performAutoSave(); }}
              disabled={isSyncing || !userId || !projectData}
              style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: isSyncing ? 'rgba(255,255,0,0.15)' : 'rgba(0,150,255,0.2)', borderRadius: 6, borderWidth: 1, borderColor: isSyncing ? 'rgba(255,255,0,0.4)' : 'rgba(0,150,255,0.4)' }}
            >
              <Text style={{ color: isSyncing ? '#ff0' : '#09f', fontSize: 11, fontWeight: 'bold', fontFamily: 'monospace' }}>
                {isSyncing ? '🔄' : 'SYNC'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: '#666', fontSize: 8, fontFamily: 'monospace', marginBottom: 4 }}>
            Auto: {autoExportMesh ? '60s' : 'OFF'} | Chunk: {chunkSizeMB}MB | {isSyncing ? 'SYNCING...' : 'IDLE'}
          </Text>
          {/* Logs */}
          <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
            {debugLogs.map((log, i) => (
              <Text key={i} style={{ color: log.includes('❌') ? '#f66' : log.includes('✅') ? '#6f6' : log.includes('⚠') ? '#ff0' : '#ccc', fontSize: 9, fontFamily: 'monospace', marginBottom: 1 }}>
                {log}
              </Text>
            ))}
            {debugLogs.length === 0 && <Text style={{ color: '#666', fontSize: 9, fontFamily: 'monospace' }}>No logs yet. Export mesh to see activity.</Text>}
          </ScrollView>
        </View>
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
                      renderItem={({item}) => (
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

            {/* AUTO-EXPORT TOGGLE */}
            <View style={styles.toggleContainer}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.toggleTitle}>Auto-Export Mesh Chunking</Text>
                <Text style={styles.toggleDesc}>Silently slices and uploads 45MB chunks of 3D data while scanning.</Text>
              </View>
              <Switch
                value={autoExportMesh}
                onValueChange={setAutoExportMesh}
                trackColor={{ false: '#333', true: 'rgba(51,204,255,0.5)' }}
                thumbColor={autoExportMesh ? '#33CCFF' : '#888'}
              />
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalBtnSkip} onPress={handleSkipProject}>
                <Text style={styles.modalBtnSkipText}>Free Mode</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtnCreate, { backgroundColor: '#4CAF50' }]} onPress={handleCreateProject}>
                <Text style={styles.modalBtnCreateText}>Create</Text>
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
  modeButton: { paddingHorizontal: 24, paddingVertical: 18, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', minWidth: 90, alignItems: 'center' },
  modeButtonActive: { borderColor: '#33CCFF', backgroundColor: 'rgba(51,204,255,0.2)' },
  modeButtonText: { color: '#666', fontFamily: typography.fontFamily.bold, fontSize: 15, letterSpacing: 1.5 },
  addPointButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(51,204,255,0.1)', borderWidth: 3, alignItems: 'center', justifyContent: 'center', ...shadows.lg },
  addPointText: { fontSize: 42, lineHeight: 46, fontWeight: '300', marginTop: -2 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
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
