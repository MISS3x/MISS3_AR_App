import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
// import * as Sharing from 'expo-sharing';

import { colors, spacing, borderRadius, typography, shadows } from '../../theme/theme';
import { ARRulerNode } from './useARRuler';
import { calcDistance, calcShoelaceArea, generateAreaSVG } from './utils';

interface ARRulerHUDProps {
  phase: 'floor' | 'ceiling' | 'plan';
  floorPoint: [number, number, number] | null;
  ceilingPoint: [number, number, number] | null;
  floorSamples: [number, number, number][];
  ceilingSamples: [number, number, number][];
  nodes: ARRulerNode[];
  onAddPoint: () => void;
  isReticleActive: boolean;
  onUndo: () => void;
  onClear: () => void;
  onClose: () => void;
}

export default function ARRulerHUD({ phase, floorPoint, ceilingPoint, floorSamples, ceilingSamples, nodes, onAddPoint, isReticleActive, onUndo, onClear, onClose }: ARRulerHUDProps) {
  const insets = useSafeAreaInsets();

  // Calculate dynamic metrics
  let totalDistance = 0;
  for (let i = 1; i < nodes.length; i++) {
     totalDistance += calcDistance(nodes[i-1].position, nodes[i].position);
  }
  
  let polyArea = 0;
  if (nodes.length >= 3) {
     polyArea = calcShoelaceArea(nodes);
  }
  
  let roomHeight = 0;
  if (floorPoint && ceilingPoint) {
      roomHeight = Math.abs(ceilingPoint[1] - floorPoint[1]);
  }
  
  const getPromptLabel = () => {
    if (!isReticleActive) return "Look around to detect surfaces";
    if (phase === 'floor') return `FLOOR: Tap point ${floorSamples.length + 1}/3`;
    if (phase === 'ceiling') return `CEILING: Tap point ${ceilingSamples.length + 1}/3`;
    if (nodes.length >= 3 && !isPlanClosed) return "Trace corners or press CLOSE";
    return "Trace the FLOOR PLAN corners";
  };
  
  const isUndoDisabled = phase === 'floor' && nodes.length === 0;
  
  // Check if plan is closed (distance between first and last node is very small)
  const isPlanClosed = nodes.length > 2 && calcDistance(nodes[0].position, nodes[nodes.length - 1].position) < 0.01;

  const exportSVG = async () => {
    if (nodes.length < 3) {
      Alert.alert("Not Enough Points", "Tap at least 3 points to export an area map.");
      return;
    }
    try {
      const svgString = generateAreaSVG(nodes);
      const fileUri = `${FileSystem.documentDirectory}ar_measurement_${Date.now()}.svg`;
      await FileSystem.writeAsStringAsync(fileUri, svgString, { encoding: FileSystem.EncodingType.UTF8 });
      
      Alert.alert("Export Ready", "SVG saved to local device storage. To share to other apps, the iOS app requires a native rebuild which will enable the sharing native module.");
      
      // if (await Sharing.isAvailableAsync()) {
      //     await Sharing.shareAsync(fileUri, { UTI: 'public.svg-image', mimeType: 'image/svg+xml' });
      // }
    } catch (e) {
      Alert.alert("Error", "Could not export SVG.");
    }
  };

  return (
    <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + spacing.lg }]} pointerEvents="box-none">
      
      {/* HUD Hint directly in viewport when empty or during phases */}
      {(nodes.length === 0 || phase !== 'plan') && (
         <View style={styles.promptOverlay}>
            <Text style={styles.promptText}>
              {getPromptLabel()}
            </Text>
         </View>
      )}

      {/* Floating Action Buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionButton} onPress={onUndo} disabled={isUndoDisabled}>
           <Text style={[styles.actionButtonText, isUndoDisabled && {opacity: 0.5}]}>UNDO</Text>
        </TouchableOpacity>

        {/* Big Add Point Button */}
        <TouchableOpacity 
          style={[styles.addButton, (!isReticleActive || isPlanClosed) && {opacity: 0.5, backgroundColor: '#555'}]} 
          onPress={onAddPoint} 
          disabled={!isReticleActive || isPlanClosed}
        >
           <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>

        {phase === 'plan' && nodes.length >= 3 && !isPlanClosed && (
            <TouchableOpacity style={[styles.actionButton, {backgroundColor: colors.primary, borderColor: colors.primary}]} onPress={onClose}>
               <Text style={[styles.actionButtonText, {color: '#000'}]}>CLOSE</Text>
            </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.actionButton} onPress={onClear} disabled={isUndoDisabled}>
           <Text style={[styles.actionButtonText, isUndoDisabled && {opacity: 0.5}]}>CLEAR</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.measureContainer}>
         <View style={styles.measureBox}>
            <Text style={styles.measureValue}>{roomHeight > 0 ? roomHeight.toFixed(2) : '--'}<Text style={styles.measureUnit}> m</Text></Text>
            <Text style={styles.measureLabel}>Height</Text>
         </View>
         
         <View style={styles.measureDivider} />

         <View style={styles.measureBox}>
            <Text style={styles.measureValue}>{totalDistance.toFixed(2)}<Text style={styles.measureUnit}> m</Text></Text>
            <Text style={styles.measureLabel}>Perimeter</Text>
         </View>
         
         <View style={styles.measureDivider} />

         <View style={styles.measureBox}>
             <Text style={styles.measureValue}>{polyArea > 0 ? polyArea.toFixed(2) : '--'}<Text style={styles.measureUnit}> m²</Text></Text>
             <Text style={styles.measureLabel}>Area</Text>
         </View>
         
         <View style={styles.measureDivider} />
         
         <View style={{justifyContent: 'center', paddingHorizontal: spacing.sm}}>
           <TouchableOpacity style={styles.exportButton} onPress={exportSVG}>
              <Text style={styles.exportButtonText}>EXPORT SVG</Text>
           </TouchableOpacity>
         </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomPanel: { 
     position: 'absolute', bottom: 0, left: 0, right: 0, 
     zIndex: 10 
  },
  measureContainer: {
     backgroundColor: 'rgba(10, 20, 30, 0.95)',
     borderTopWidth: 1, borderTopColor: 'rgba(0, 255, 255, 0.2)',
     flexDirection: 'row', justifyContent: 'space-evenly', 
     paddingTop: spacing.lg,
  },
  promptOverlay: { position: 'absolute', top: -160, left: spacing.md, right: spacing.md, alignItems: 'center', pointerEvents: 'none' },
  promptText: { backgroundColor: 'rgba(0,0,0,0.8)', color: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 30, fontFamily: typography.fontFamily.semiBold, ...shadows.md, overflow: 'hidden'},
  
  actionRow: {
    position: 'absolute',
    top: -90, // Push it up further so the big button fits above the bottom panel
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  actionButton: { paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: borderRadius.sm, backgroundColor: 'rgba(0,0,0,0.8)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', ...shadows.sm },
  actionButtonText: { color: '#FFF', fontFamily: typography.fontFamily.bold, fontSize: 12, letterSpacing: 1 },
  addButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8, elevation: 5 },
  addButtonText: { color: '#000', fontSize: 40, fontFamily: typography.fontFamily.bold, lineHeight: 45, marginTop: -4 },

  measureBox: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  measureValue: { color: '#FFF', fontSize: 30, fontFamily: typography.fontFamily.bold },
  measureUnit: { fontSize: 16, color: colors.primary },
  measureLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: typography.fontFamily.medium, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },
  measureDivider: { width: 1, backgroundColor: 'rgba(0, 255, 255, 0.2)', height: '70%' },
  exportButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: '#2196F3', borderRadius: borderRadius.md, justifyContent: 'center', alignItems: 'center' },
  exportButtonText: { color: '#FFF', fontFamily: typography.fontFamily.bold, fontSize: 12, letterSpacing: 1 }
});
