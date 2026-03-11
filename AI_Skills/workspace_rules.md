# MISS3 AR App - Workspace & Build Rules

**CRITICAL: Read this file before attempting any EAS Builds or resolving dependency issues.**
**CRITICAL: ALWAYS read `AI_Skills/AI_codebase.md` for external documentation links (ARCore, ARKit) before starting complex AR implementation.**

## 1. EAS Build on Windows (The Mapped Drive Path Bug)
If the project is located on a mapped network drive (e.g., `P:\Antigravity\MISS3_AR_App`), the `eas build` CLI on Windows has a bug where it packages the absolute Windows path (`P:/...`) into the tarball. This causes the macOS/Linux EAS build servers to fail instantly with a "No matching files found" error.
**SOLUTION:** You MUST change the directory to the physical drive path (e.g., `Z:\MISS3 Dropbox\Server Data\...`) to run the `eas build` command. Do not build from `P:\`. 

## 2. Expo Doctor & newArchEnabled
ViroReact may ask for the New Architecture, but adding `"newArchEnabled": true` to `app.json` causes `expo-doctor` to fail with a schema validation error (`should NOT have additional property 'newArchEnabled'`), which instantly kills the EAS build pre-check.
**SOLUTION:** Leave `newArchEnabled` out of `app.json`.

## 3. Duplicate React Versions (ViroReact Conflict)
ViroReact often attempts to pull in an older/conflicting version of React. This will cause the `expo-doctor` pre-build step to fail with a "Found duplicates for react" error.
**SOLUTION:** Enforce a single React version by declaring `overrides` in `package.json`:
```json
"overrides": {
  "react": "~18.2.0",
  "react-dom": "~18.2.0"
}
```
*(Adjust the version to match what Expo SDK currently expects. Run `npx expo install --fix` after altering.)*

## 4. Local Development Server (Tunneling)
When running the development server (`npx expo start`), phones on different Wi-Fi networks (e.g., home Wi-Fi vs. office LAN) cannot connect via the default local IP (192.168.x.x). 
**SOLUTION:** Always use the `--tunnel` flag and clear the cache:
`npx expo start --tunnel -c`
To connect, use the native iOS **Camera** app to scan the generated QR code. It will detect the `exp://` deep link and seamlessly open the Expo Dev Client. Do not type URLs manually if the camera works.

## 5. React vs Native State in ViroReact
Avoid binding continuous gesture variables (like pinch scale or rotate) directly to React `useState`. State updates drop frames in Viro 3D rendering.
**SOLUTION:** Use `useRef` for tracking the values, and immediately apply them inside gesture callbacks (`onPinch`, `onRotate`) using direct native manipulation:
`nodeRef.current.setNativeProps({ scale: newScale });`
