// ============================================================
// AR Viewer Screen — 3D model viewer
// 3D: WebView + Google model-viewer (rotate, zoom, pan)
// AR: Phase 2 — ARKit native module (coming soon)
// ============================================================
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../theme/theme';

interface ARViewerScreenProps {
  route: {
    params: {
      modelUrl: string;
      modelTitle: string;
    };
  };
  navigation: any;
}

export default function ARViewerScreen({ route, navigation }: ARViewerScreenProps) {
  const { modelUrl, modelTitle } = route.params;
  const insets = useSafeAreaInsets();

  const html = useMemo(() => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${modelTitle}</title>
  <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;background:#0A0A1A;overflow:hidden;-webkit-user-select:none}
    model-viewer{width:100%;height:100%;background:transparent;--poster-color:transparent}
    model-viewer::part(default-progress-bar){background:linear-gradient(90deg,#6C5CE7,#A29BFE);height:4px}
    .loader{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:#0A0A1A;z-index:200;transition:opacity 0.3s}
    .spinner{width:40px;height:40px;border:3px solid rgba(108,92,231,0.3);border-top-color:#6C5CE7;border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .hidden{opacity:0;pointer-events:none}
  </style>
</head>
<body>
  <div id="loader" class="loader">
    <div class="spinner"></div>
    <div style="color:#888;font-size:14px">Loading 3D model...</div>
  </div>
  <model-viewer src="${modelUrl}" camera-controls touch-action="pan-y" auto-rotate
    shadow-intensity="1" shadow-softness="0.8" exposure="1" environment-image="neutral"
    interaction-prompt="auto" style="background-color:#0A0A1A"></model-viewer>
  <script>
    const mv=document.querySelector('model-viewer'),loader=document.getElementById('loader');
    mv.addEventListener('load',()=>{loader.classList.add('hidden');setTimeout(()=>loader.style.display='none',300)});
    mv.addEventListener('error',()=>{loader.innerHTML='<div style="color:#ff6b6b;font-size:16px">⚠️ Failed to load</div>'});
  </script>
</body>
</html>`;
  }, [modelUrl, modelTitle]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{modelTitle}</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>3D</Text></View>
      </View>

      <WebView
        source={{ html }}
        style={styles.webview}
        allowsInlineMediaPlayback
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        scrollEnabled={false}
        bounces={false}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:'#0A0A1A' },
  header: { flexDirection:'row', alignItems:'center', paddingHorizontal:spacing.md, paddingVertical:spacing.sm, gap:spacing.sm },
  backButton: { width:40, height:40, borderRadius:20, backgroundColor:'rgba(255,255,255,0.1)', alignItems:'center', justifyContent:'center' },
  backIcon: { fontSize:20, color:colors.textPrimary },
  headerTitle: { flex:1, fontFamily:typography.fontFamily.semiBold, fontSize:typography.fontSize.lg, color:colors.textPrimary },
  badge: { paddingHorizontal:spacing.sm+2, paddingVertical:spacing.xs, borderRadius:borderRadius.sm, backgroundColor:colors.primary },
  badgeText: { fontFamily:typography.fontFamily.bold, fontSize:typography.fontSize.xs, color:'#FFF', letterSpacing:1 },
  webview: { flex:1, backgroundColor:'#0A0A1A' },
  loading: { position:'absolute', top:0, left:0, right:0, bottom:0, justifyContent:'center', alignItems:'center', backgroundColor:'#0A0A1A' },
});
