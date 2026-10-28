import * as Haptics from 'expo-haptics';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonResolutions, useCameraDevices, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import type { SkiaCameraRef } from 'react-native-vision-camera-skia';
import { enqueueDevelop } from '../darkroom';
import { PROFILES, getProfile, megapixels } from '../profiles';
import { loadSettings, saveSettings } from '../storage/settings';
import { listShots, onShotsChanged, shotFiles, type Shot } from '../storage/shots';
import { DevelopTray } from '../ui/DevelopTray';
import { FocusMark } from '../ui/FocusMark';
import { TimeDial } from '../ui/TimeDial';
import { Viewfinder } from '../ui/Viewfinder';
import { colors, mono, radius } from '../ui/theme';

function useLatestShot(): Shot | null {
  const [shot, setShot] = useState<Shot | null>(() => listShots()[0] ?? null);
  useEffect(() => onShotsChanged(() => setShot(listShots()[0] ?? null)), []);
  return shot;
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [initial] = useState(loadSettings);
  const [profileId, setProfileId] = useState(initial.profileId);
  const [authentic, setAuthentic] = useState(initial.authentic);
  const [flash, setFlash] = useState(initial.flash);
  const [position, setPosition] = useState<'back' | 'front'>('back');
  const [focus, setFocus] = useState<{ x: number; y: number; key: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const profile = getProfile(profileId);
  const latest = useLatestShot();

  const permission = useCameraPermission();
  const devices = useCameraDevices();
  const hasCamera = devices.length > 0;
  const focused = useIsFocused();
  const appActive = useAppActive();
  const camera = useRef<SkiaCameraRef>(null);

  const photoOutput = usePhotoOutput({
    containerFormat: 'jpeg',
    quality: 0.95,
    targetResolution: CommonResolutions.UHD_4_3,
    qualityPrioritization: 'balanced',
  });

  // Phones without a selfie camera can't flip; ones without a flash can't fire it.
  const effectivePosition = profile.front ? position : 'back';
  const flashAvailable = profile.flash != null && effectivePosition === 'back';
  const flashOn = flash && flashAvailable;

  useEffect(() => {
    if (hasCamera && permission.canRequestPermission) permission.requestPermission();
  }, [hasCamera, permission]);

  const selectProfile = useCallback((id: string) => {
    setProfileId(id);
    saveSettings({ profileId: id });
  }, []);

  // Viewfinder keeps the sensor's aspect ratio, in portrait, and gives way to
  // the controls on shorter screens.
  const aspect = Math.max(profile.output.width, profile.output.height) / Math.min(profile.output.width, profile.output.height);
  const chrome = 330;
  const vfHeight = Math.round(Math.min((width - 24) * aspect, height - insets.top - insets.bottom - chrome));
  const vfWidth = Math.round(vfHeight / aspect);

  const blink = useSharedValue(0);
  const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  const develop = useCallback(
    (source: Uint8Array, origin: Shot['origin']) => {
      enqueueDevelop({ source, profileId, front: effectivePosition === 'front', flash: flashOn, origin }).catch((e) =>
        console.warn('Developing failed', e),
      );
    },
    [profileId, effectivePosition, flashOn],
  );

  const importPhoto = useCallback(async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const bytes = await new File(res.assets[0].uri).bytes();
    develop(bytes, 'import');
  }, [develop]);

  const capture = useCallback(async () => {
    if (!hasCamera || !permission.hasPermission) {
      importPhoto();
      return;
    }
    if (busy) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      if (authentic) await new Promise((r) => setTimeout(r, profile.viewfinder.shutterLagMs));
      blink.set(withSequence(withTiming(1, { duration: 40 }), withTiming(0, { duration: 260 })));
      const photo = await photoOutput.capturePhoto({ flashMode: flashOn ? 'on' : 'off', enableShutterSound: true }, {});
      const data = await photo.getFileDataAsync();
      develop(new Uint8Array(data), 'camera');
    } catch (e) {
      console.warn('Capture failed', e);
    } finally {
      setBusy(false);
    }
  }, [hasCamera, permission.hasPermission, busy, authentic, profile, photoOutput, flashOn, develop, importPhoto, blink]);

  const onTapViewfinder = useCallback(
    (e: GestureResponderEvent) => {
      if (!profile.autofocus || !hasCamera) return;
      const { locationX: x, locationY: y } = e.nativeEvent;
      setFocus({ x, y, key: Date.now() });
      Haptics.selectionAsync().catch(() => {});
      camera.current?.focusTo({ x, y }).catch(() => {});
    },
    [profile.autofocus, hasCamera],
  );

  const toggleAuthentic = () => {
    setAuthentic((v) => {
      saveSettings({ authentic: !v });
      return !v;
    });
    Haptics.selectionAsync().catch(() => {});
  };
  const toggleFlash = () => {
    if (!flashAvailable) return;
    setFlash((v) => {
      saveSettings({ flash: !v });
      return !v;
    });
  };
  const flip = () => {
    if (!profile.front) return;
    setPosition((p) => (p === 'back' ? 'front' : 'back'));
    Haptics.selectionAsync().catch(() => {});
  };

  const spec = effectivePosition === 'front' && profile.front ? profile.front : profile.output;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.topBar}>
        <Chip label={flashAvailable ? (flashOn ? 'FLASH ON' : 'FLASH OFF') : 'NO FLASH'} active={flashOn} disabled={!flashAvailable} onPress={toggleFlash} />
        <Chip label="AUTHENTIC" active={authentic} onPress={toggleAuthentic} />
        <Chip label={profile.front ? (effectivePosition === 'front' ? 'FRONT' : 'BACK') : 'NO SELFIE'} disabled={!profile.front} onPress={flip} />
      </View>

      <View style={styles.header}>
        <Text style={styles.brand} numberOfLines={1}>
          {profile.inspiredBy}
        </Text>
        <Text style={styles.specs} numberOfLines={1}>
          {profile.year} · {spec.width}×{spec.height} · f/{profile.optics.fNumber} · ISO {profile.exposure.baseIso}–{profile.exposure.maxIso}
        </Text>
      </View>

      <Pressable onPress={onTapViewfinder} style={[styles.vf, { width: vfWidth, height: vfHeight }]} accessibilityLabel="Viewfinder">
        {hasCamera && permission.hasPermission ? (
          <Viewfinder
            cameraRef={camera}
            profile={profile}
            lcd={authentic}
            position={effectivePosition}
            isActive={focused && appActive}
            photoOutput={photoOutput}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={styles.noCam}>
            <Text style={styles.noCamTitle}>{hasCamera ? 'Camera access needed' : 'No camera on this device'}</Text>
            <Text style={styles.noCamText}>
              {hasCamera
                ? 'Allow camera access in Settings, or develop a photo from your library.'
                : 'Pick any photo and it will be developed as if this phone had taken it.'}
            </Text>
            <Pressable onPress={importPhoto} style={styles.noCamButton}>
              <Text style={styles.noCamButtonText}>Pick a photo</Text>
            </Pressable>
          </View>
        )}
        <View pointerEvents="none" style={styles.osd}>
          <Text style={styles.osdText}>{megapixels(profile)}</Text>
          <Text style={styles.osdText}>{profile.autofocus ? 'AF' : 'FIXED FOCUS'}</Text>
        </View>
        <FocusMark profile={profile} point={focus} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.blink, blinkStyle]} />
      </Pressable>

      <Text style={styles.tagline} numberOfLines={1}>
        {profile.tagline}
      </Text>

      <TimeDial profiles={PROFILES} selectedId={profile.id} onSelect={selectProfile} />

      <View style={styles.trayRow}>
        <DevelopTray />
      </View>

      <View style={styles.bottom}>
        <Pressable onPress={() => router.push('/gallery')} style={styles.thumb} accessibilityLabel="Open memory card">
          {latest ? <Image source={{ uri: shotFiles(latest).developed.uri }} style={styles.thumbImg} /> : null}
        </Pressable>
        <Pressable
          onPress={capture}
          accessibilityLabel="Take photo"
          style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }]}
        >
          <View style={[styles.shutterInner, busy && { backgroundColor: colors.accentDim }]} />
        </Pressable>
        <Pressable onPress={importPhoto} style={styles.sideBtn} accessibilityLabel="Develop a photo from your library">
          <Text style={styles.sideBtnText}>IMPORT</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Chip({ label, active, disabled, onPress }: { label: string; active?: boolean; disabled?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive, disabled && styles.chipTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  topBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, width: '100%', justifyContent: 'space-between' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: '#2A1D0C' },
  chipDisabled: { opacity: 0.45 },
  chipText: { fontFamily: mono, fontSize: 11, color: colors.textDim, letterSpacing: 1 },
  chipTextActive: { color: colors.accent },
  chipTextDisabled: { textDecorationLine: 'line-through' },
  header: { width: '100%', paddingHorizontal: 16, marginTop: 10, marginBottom: 8 },
  brand: { color: colors.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  specs: { color: colors.textDim, fontFamily: mono, fontSize: 11, marginTop: 2 },
  vf: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#000' },
  osd: { position: 'absolute', top: 8, left: 10, right: 10, flexDirection: 'row', justifyContent: 'space-between' },
  osdText: {
    fontFamily: mono,
    fontSize: 10,
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 2,
    textShadowOffset: { width: 0, height: 1 },
  },
  blink: { backgroundColor: '#000' },
  noCam: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.surface },
  noCamTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  noCamText: { color: colors.textDim, fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  noCamButton: { marginTop: 18, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.accent },
  noCamButtonText: { color: '#1A1206', fontWeight: '700', fontSize: 15 },
  tagline: { color: colors.textFaint, fontSize: 12, marginTop: 8 },
  trayRow: { height: 34, justifyContent: 'center' },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 28,
    marginTop: 'auto',
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.accent },
  sideBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  sideBtnText: { fontFamily: mono, fontSize: 9, color: colors.textDim, letterSpacing: 0.5 },
});
