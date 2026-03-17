import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, borderRadius, typography, shadows } from '../theme/theme';
import { ARRulerNativeView } from '../../modules/ar-ruler-native';

export default function ARRulerScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const rulerRef = useRef<any>(null);
  
  const [pointCount, setPointCount] = useState(0);
  const [roomHeight, setRoomHeight] = useState<number | null>(null);
  const [planeFound, setPlaneFound] = useState(false);
  const [prompt, setPrompt] = useState("Point crosshair at Floor and tap 3 times to average Floor Height (0/3)");
  const [selectedIndex, setSelectedIndex] = useState(0); // 0 = Floor, 1 = Wall
  const [isWallMode, setIsWallMode] = useState(false);

  // Project Flow State
  const [showProjectModal, setShowProjectModal] = useState(true);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [projectData, setProjectData] = useState<{ id: string; name: string } | null>(null);

  // Sync Debug State
  const [pendingCount, setPendingCount] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleUpdate = (event: any) => {
    const { nativeEvent } = event;
    if (nativeEvent.event === 'floor_point_added') {
      setPrompt(`Point crosshair at Floor and tap 3 times to average Height (${nativeEvent.count}/3)`);
    } else if (nativeEvent.event === 'floor_set') {
      setPrompt("Point crosshair at Ceiling and tap 3 times to average Height (0/3)");
    } else if (nativeEvent.event === 'ceiling_point_added') {
      setPrompt(`Point crosshair at Ceiling and tap 3 times to average Height (${nativeEvent.count}/3)`);
    } else if (nativeEvent.event === 'ceiling_set') {
      setRoomHeight(nativeEvent.roomHeight);
      setPrompt("Scan Floor and tap to draw corners of the room polygon");
    } else if (nativeEvent.event === 'point_added') {
      setPointCount(nativeEvent.count);
      if (nativeEvent.count >= 3) {
         setPrompt("Tap more corners or press Close Shape");
      }
    } else if (nativeEvent.event === 'point_removed') {
      setPointCount(nativeEvent.count);
    } else if (nativeEvent.event === 'reset') {
      setPointCount(0);
      setRoomHeight(null);
      setPrompt(selectedIndex === 0 
        ? "Point crosshair at Floor and tap 3 times to average Floor Height (0/3)"
        : "Scan Wall plane directly to begin drawing Wall polygon");
    }
  };

  const handlePlaneState = (event: any) => {
    setPlaneFound(event.nativeEvent.status === 'plane_found');
  };

  const handleAddPoint = () => {
    rulerRef.current?.addPoint();
  };

  const handleUndo = () => {
    rulerRef.current?.undoLastPoint();
  };

  const handleReset = () => {
    rulerRef.current?.reset();
  };

  const handleCloseShape = async () => {
    if (pointCount < 3) return;
    try {
      const shape = await rulerRef.current?.closeShape();
      if (shape) {
        setPointCount(0);
        setPrompt("Shape saved! You can draw a new room on the floor now.");
      }
    } catch (e) {
      console.log(e);
    }
  };

  const saveToLocalStore = async (exportData: any) => {
    // Free Mode check: If no project data, do not save to local storage
    if (!projectData) return null;

    try {
      const measurementId = `measurement_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const payload = {
        id: measurementId,
        project_id: projectData.id,
        project_name: projectData.name,
        timestamp: new Date().toISOString(),
        status: 'pending',
        data: exportData
      };
      
      const existingMappingsJson = await AsyncStorage.getItem('@ar_measurements');
      const existingMappings = existingMappingsJson ? JSON.parse(existingMappingsJson) : [];
      
      existingMappings.push(payload);
      
      await AsyncStorage.setItem('@ar_measurements', JSON.stringify(existingMappings));
      
      // Update debug counts locally
      setPendingCount(prev => prev + 1);
      
      return payload;
    } catch (e) {
      throw e;
    }
  };

  const refreshSyncCounts = async () => {
    try {
      const recordsJson = await AsyncStorage.getItem('@ar_measurements');
      if (recordsJson) {
        const records = JSON.parse(recordsJson);
        const pending = records.filter((r: any) => r.status === 'pending').length;
        const uploaded = records.filter((r: any) => r.status === 'uploaded').length;
        setPendingCount(pending);
        setUploadedCount(uploaded);
      }
    } catch (err) { }
  };

  const syncMeasurements = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    
    try {
      const recordsJson = await AsyncStorage.getItem('@ar_measurements');
      if (!recordsJson) {
        setIsSyncing(false);
        return;
      }
      
      let records = JSON.parse(recordsJson);
      let syncCount = 0;
      
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !anonKey) {
          console.log("No Supabase credentials found in env. Skipping sync.");
          setIsSyncing(false);
          return;
      }

      for (let i = 0; i < records.length; i++) {
        if (records[i].status === 'pending') {
          // POST to Supabase (assuming an 'ar_measurements' table exists, or standard REST)
          // We will use a generic REST call. If the table doesn't exist yet, this will fail gracefully.
          const res = await fetch(`${supabaseUrl}/rest/v1/ar_measurements`, {
            method: 'POST',
            headers: {
              'apikey': anonKey,
              'Authorization': `Bearer ${anonKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              id: records[i].id,
              project_id: process.env.EXPO_PUBLIC_COMPANY_ID || null,
              created_at: records[i].timestamp,
              payload: records[i].data
            })
          });

          if (res.ok || res.status === 201) {
            records[i].status = 'uploaded';
            syncCount++;
          } else {
            console.log("Sync failed for record", records[i].id, await res.text());
          }
        }
      }

      if (syncCount > 0) {
        await AsyncStorage.setItem('@ar_measurements', JSON.stringify(records));
        console.log(`Synced ${syncCount} measurements to Supabase.`);
      }
      
      refreshSyncCounts();

    } catch (e) {
      console.log("Sync error:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
     refreshSyncCounts();
     syncMeasurements();
  }, []);

  const handleExport = async () => {
    try {
       const rawShapes = await rulerRef.current?.getCurrentShapes();
       if (!rawShapes || rawShapes.length === 0) {
          Alert.alert("Nothing to export", "Close at least one shape first.");
          return;
       }
       
       let totalFloorArea = 0;
       let totalWallArea = 0;
       
       rawShapes.forEach((s: any) => {
           if (s.type === 'wall') totalWallArea += s.area;
           else totalFloorArea += s.area;
       });
       
       const exportData = {
           totalCombinedArea: totalFloorArea + totalWallArea,
           totalFloorArea,
           totalWallArea,
           shapesCount: rawShapes.length,
           shapes: rawShapes
       };
       
       const savedPayload = await saveToLocalStore(exportData);

       if (savedPayload) {
           Alert.alert(
               "Measurement Saved Locally \u231A", 
               `Total Floor: ${totalFloorArea.toFixed(2)} m²\nTotal Walls: ${totalWallArea.toFixed(2)} m²\nShapes: ${rawShapes.length}\nProject: ${projectData?.name}\n\nThis measurement has been securely saved to this device and will sync to Supabase when possible.`,
               [{ text: "Awesome!", onPress: () => console.log("Saved Offline Payload.") }]
           );
       } else {
           Alert.alert(
               "Free Mode - Not Saved", 
               `Total Floor: ${totalFloorArea.toFixed(2)} m²\nTotal Walls: ${totalWallArea.toFixed(2)} m²\nShapes: ${rawShapes.length}\n\nProject was skipped, so this data will not be uploaded.`,
               [{ text: "OK" }]
           );
       }
    } catch (e) {
       console.log(e);
       Alert.alert("Error", "Failed to save measurement data locally.");
    }
  };

  const handleCreateProject = () => {
    if (!projectNameInput.trim()) {
      Alert.alert("Name Required", "Please enter a project name.");
      return;
    }
    setProjectData({
      id: `proj_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name: projectNameInput.trim()
    });
    setShowProjectModal(false);
  };

  const handleSkipProject = () => {
    setProjectData(null);
    setShowProjectModal(false);
  };

  return (
    <View style={styles.container}>
      <ARRulerNativeView 
        ref={rulerRef}
        style={styles.viroContainer} 
        onUpdate={handleUpdate}
        onPlaneStateChange={handlePlaneState}
        isWallMode={selectedIndex === 1}
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
        <TouchableOpacity style={styles.actionButton} onPress={handleReset}>
           <Text style={styles.actionButtonText}>RESET</Text>
        </TouchableOpacity>
      </View>
      
      {/* Mode Selector */}
      <View style={[styles.modeSelectorContainer, { top: insets.top + 60 }]}>
         <SegmentedControl
           values={['Floor Mode', 'Wall Mode']}
           selectedIndex={selectedIndex}
           onChange={(event) => {
             const idx = event.nativeEvent.selectedSegmentIndex;
             setSelectedIndex(idx);
             if (idx === 1) {
                 setPrompt("Scan Wall plane directly to begin drawing Wall polygon");
             } else {
                 setPrompt(roomHeight ? "Scan Floor and tap to draw corners of the room polygon" : "Point crosshair at Floor and tap 3 times to average Floor Height (0/3)");
             }
           }}
           tintColor={selectedIndex === 0 ? colors.primary : '#00FFFF'}
           backgroundColor="rgba(0,0,0,0.6)"
           fontStyle={{ color: '#888', fontFamily: typography.fontFamily.medium }}
           activeFontStyle={{ color: '#000', fontFamily: typography.fontFamily.semiBold }}
           style={styles.segmentedControl}
         />
      </View>
      
      {/* HUD Hint directly in viewport */}
      <View style={styles.promptOverlay}>
        <Text style={[styles.promptText, { color: planeFound ? colors.primary : '#FF5555' }]}>
            {planeFound ? prompt : "Move phone around to detect planes..."}
        </Text>
      </View>

      {/* Crosshair Add Button (Only show when plane found) */}
      {planeFound && (
        <View style={styles.centerAddButtonContainer} pointerEvents="box-none">
           <TouchableOpacity style={styles.addPointButton} onPress={handleAddPoint} activeOpacity={0.7}>
              <Text style={styles.addPointText}>+</Text>
           </TouchableOpacity>
        </View>
      )}
      
      {/* Debug Sync Window */}
      <View style={[styles.debugWindow, { top: insets.top + 100 }]}>
        <Text style={styles.debugTitle}>DB Sync Status</Text>
        <Text style={styles.debugText}>Pending (Local): {pendingCount}</Text>
        <Text style={styles.debugText}>Uploaded (Supabase): {uploadedCount}</Text>
        <TouchableOpacity 
          style={styles.syncBtn} 
          onPress={syncMeasurements}
          disabled={isSyncing || pendingCount === 0}
        >
          <Text style={styles.syncBtnText}>
            {isSyncing ? "Syncing..." : "Force Sync"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Panel Displaying Math & Controls */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + spacing.lg }]}>
         <View style={styles.measureBox}>
            <Text style={styles.measureValue}>{roomHeight ? roomHeight.toFixed(2) : '--'}<Text style={styles.measureUnit}> m</Text></Text>
            <Text style={styles.measureLabel}>Height</Text>
         </View>
         
         <View style={styles.measureDivider} />

         {pointCount >= 3 ? (
             <TouchableOpacity 
                style={[styles.exportButton, { flex: 1, marginHorizontal: spacing.md, backgroundColor: '#4CAF50' }]}
                onPress={handleCloseShape}
             >
                <Text style={styles.actionButtonText}>CLOSE SHAPE</Text>
             </TouchableOpacity>
         ) : (
             <View style={styles.measureBox}>
                 <Text style={styles.measureValue}>{pointCount}<Text style={styles.measureUnit}> pts</Text></Text>
                 <Text style={styles.measureLabel}>Corners</Text>
             </View>
         )}
         
         <View style={styles.measureDivider} />
         
         <View style={{justifyContent: 'center', paddingHorizontal: spacing.sm}}>
           <TouchableOpacity 
             style={styles.exportButton}
             onPress={handleExport}
           >
              <Text style={styles.actionButtonText}>EXPORT</Text>
           </TouchableOpacity>
         </View>
      </View>

      {/* Project Creation Modal */}
      <Modal visible={showProjectModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Measurement Project</Text>
            <Text style={styles.modalSubtitle}>Create a project to automatically save and sync your measurements to Supabase.</Text>
            
            <TextInput
              style={styles.modalInput}
              placeholder="Enter Project Name..."
              placeholderTextColor="#999"
              value={projectNameInput}
              onChangeText={setProjectNameInput}
              autoFocus
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalBtnSkip} onPress={handleSkipProject}>
                <Text style={styles.modalBtnSkipText}>Skip (Free Mode)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnCreate} onPress={handleCreateProject}>
                <Text style={styles.modalBtnCreateText}>Create Project</Text>
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
  
  debugWindow: {
    position: 'absolute',
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
    zIndex: 999,
  },
  debugTitle: { color: '#0f0', fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  debugText: { color: '#FFF', fontSize: 12, marginBottom: 2 },
  syncBtn: { marginTop: 8, backgroundColor: '#007AFF', padding: 6, borderRadius: 4, alignItems: 'center' },
  syncBtnText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },

  viroContainer: { flex: 1 },
  headerOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, gap: spacing.sm, zIndex: 10,
  },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 20, color: '#FFF' },
  headerTitle: { flex: 1, fontFamily: typography.fontFamily.semiBold, fontSize: typography.fontSize.md, color: '#FFF' },
  actionButton: { paddingHorizontal: spacing.sm, paddingVertical: 10, borderRadius: borderRadius.sm, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  actionButtonText: { color: '#FFF', fontFamily: typography.fontFamily.bold, fontSize: 12, letterSpacing: 1 },
  
  modeSelectorContainer: { position: 'absolute', left: spacing.md, right: spacing.md, zIndex: 11 },
  segmentedControl: { height: 40, borderRadius: 20 },

  promptOverlay: { position: 'absolute', top: 120, left: spacing.md, right: spacing.md, alignItems: 'center', zIndex: 12, pointerEvents: 'none' },
  promptText: { backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 30, fontFamily: typography.fontFamily.semiBold, ...shadows.md, overflow: 'hidden'},
  
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
  exportButton: { paddingHorizontal: spacing.md, paddingVertical: 12, backgroundColor: '#2196F3', borderRadius: borderRadius.md, justifyContent: 'center', alignItems: 'center' },

  centerAddButtonContainer: { position: 'absolute', bottom: 150, left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  addPointButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 3, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center', ...shadows.lg },
  addPointText: { color: '#FFF', fontSize: 42, lineHeight: 46, fontWeight: '300', marginTop: -2 },
});
