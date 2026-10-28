import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { redevelop, saveToLibrary } from '../../darkroom';
import { formatShutter } from '../../pipeline/exposure';
import { PROFILES, getProfile } from '../../profiles';
import { deleteShot, getShot, notifyShotsChanged, onShotsChanged, shotFiles } from '../../storage/shots';
import { DevelopTray } from '../../ui/DevelopTray';
import { colors, mono, radius } from '../../ui/theme';

/** Shake longer than this fraction of the frame width reads as visible blur. */
const VISIBLE_SHAKE = 0.0015;

const SCENE_SOURCE: Record<string, string> = {
  exif: 'from the original EXIF',
  brightness: 'from EXIF brightness',
  assumed: 'assumed daylight',
};

export default function ShotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [shot, setShot] = useState(() => getShot(id));
  const [showOriginal, setShowOriginal] = useState(false);
  const [picking, setPicking] = useState(false);
  const [working, setWorking] = useState(false);
  useEffect(() => onShotsChanged(() => setShot(getShot(id))), [id]);

  if (!shot) {
    return (
      <View style={styles.missing}>
        <Text style={styles.dim}>This shot is gone.</Text>
      </View>
    );
  }

  const profile = getProfile(shot.profileId);
  const files = shotFiles(shot);
  const e = shot.exposure;
  const imgH = (width * shot.height) / shot.width;

  const onSave = async () => {
    try {
      await saveToLibrary(shot);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      Alert.alert('Could not save', String(err));
    }
  };
  const onShare = () => Sharing.shareAsync(files.developed.uri, { mimeType: 'image/jpeg', UTI: 'public.jpeg' }).catch(() => {});
  const onDelete = () =>
    Alert.alert('Delete this shot?', 'It stays in Photos if you saved it there.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteShot(shot);
          notifyShotsChanged();
          router.back();
        },
      },
    ]);
  const onRedevelop = async (profileId: string) => {
    setPicking(false);
    setWorking(true);
    try {
      const next = await redevelop(shot, profileId);
      router.replace(`/shot/${next.id}`);
    } catch (err) {
      Alert.alert('Developing failed', String(err));
    } finally {
      setWorking(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}>
        <ScrollView
          maximumZoomScale={8}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={{ width, height: imgH }}
        >
          <Image
            source={{ uri: showOriginal ? files.original.uri : files.developed.uri }}
            style={{ width, height: imgH }}
            resizeMode={showOriginal ? 'cover' : 'contain'}
          />
        </ScrollView>

        <View style={styles.body}>
          <Pressable
            onPressIn={() => setShowOriginal(true)}
            onPressOut={() => setShowOriginal(false)}
            style={[styles.compare, showOriginal && styles.compareOn]}
          >
            <Text style={[styles.compareText, showOriginal && { color: colors.accent }]}>
              {showOriginal ? 'ORIGINAL' : 'HOLD TO COMPARE'}
            </Text>
          </Pressable>

          <Text style={styles.fileName}>{shot.fileName}</Text>
          <Text style={styles.model}>
            {profile.inspiredBy} · {profile.year}
            {shot.front ? ' · front camera' : ''}
            {shot.flash ? ' · flash' : ''}
          </Text>

          <View style={styles.grid}>
            <Cell label="Shutter" value={formatShutter(e.shutter)} />
            <Cell label="ISO" value={String(e.iso)} />
            <Cell label="Aperture" value={`f/${profile.optics.fNumber}`} />
            <Cell label="Size" value={`${shot.width}×${shot.height}`} />
            <Cell label="File" value={`${Math.round(shot.bytes / 1024)} KB`} />
            <Cell label="Scene" value={`EV ${shot.scene.ev100.toFixed(1)}`} />
          </View>
          <Text style={styles.note}>
            Light {SCENE_SOURCE[shot.scene.source]}.
            {e.underStops > 0.05 ? ` The ${profile.model} ran out of light and underexposed by ${e.underStops.toFixed(1)} EV.` : ''}
            {Math.hypot(e.shake[0], e.shake[1]) > shot.width * VISIBLE_SHAKE ? ' Hand shake at this shutter speed blurred the frame.' : ''}
          </Text>

          <View style={styles.actions}>
            <Action label={shot.savedToLibrary ? 'SAVED' : 'SAVE'} onPress={onSave} />
            <Action label="SHARE" onPress={onShare} />
            <Action label="RE-DEVELOP" onPress={() => setPicking((v) => !v)} active={picking} />
            <Action label="DELETE" onPress={onDelete} danger />
          </View>

          {picking && (
            <View style={styles.picker}>
              <Text style={styles.pickerTitle}>Develop this frame on another phone</Text>
              <View style={styles.pickerRow}>
                {PROFILES.map((p) => (
                  <Pressable key={p.id} onPress={() => onRedevelop(p.id)} style={[styles.pick, p.id === shot.profileId && styles.pickCurrent]}>
                    <Text style={styles.pickYear}>{p.year}</Text>
                    <Text style={styles.pickModel}>{p.model}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {working && (
            <View style={{ marginTop: 16 }}>
              <DevelopTray />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{value}</Text>
    </View>
  );
}

function Action({ label, onPress, danger, active }: { label: string; onPress: () => void; danger?: boolean; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.action, active && styles.actionActive]}>
      <Text style={[styles.actionText, danger && { color: colors.danger }, active && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  dim: { color: colors.textDim },
  body: { paddingHorizontal: 16, paddingTop: 14 },
  compare: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginBottom: 16,
  },
  compareOn: { borderColor: colors.accent },
  compareText: { fontFamily: mono, fontSize: 11, letterSpacing: 1, color: colors.textDim },
  fileName: { fontFamily: mono, fontSize: 20, color: colors.text },
  model: { color: colors.textDim, marginTop: 4, fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16, borderRadius: radius.md, overflow: 'hidden', gap: 1, backgroundColor: colors.line },
  cell: { width: '33.1%', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.surface },
  cellLabel: { color: colors.textFaint, fontSize: 11 },
  cellValue: { color: colors.text, fontFamily: mono, fontSize: 14, marginTop: 2 },
  note: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 18, flexWrap: 'wrap' },
  action: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  actionActive: { borderColor: colors.accent },
  actionText: { fontFamily: mono, fontSize: 12, color: colors.text, letterSpacing: 1 },
  picker: { marginTop: 16, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface },
  pickerTitle: { color: colors.textDim, fontSize: 13, marginBottom: 10 },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pick: {
    width: 76,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceHi,
  },
  pickCurrent: { borderWidth: 1, borderColor: colors.accentDim },
  pickYear: { fontFamily: mono, fontSize: 10, color: colors.accent },
  pickModel: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
});
