import { File, Paths } from 'expo-file-system';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { enqueueDevelop } from '../darkroom';
import { DevelopTray } from '../ui/DevelopTray';
import { colors, mono } from '../ui/theme';

/**
 * Development-only entry point for driving the darkroom without a camera or
 * photo picker (e.g. in the simulator):
 *   earlydigital://debug?file=sample.jpg&profile=vga-2002
 * `file` is resolved inside the app's Documents directory.
 */
export default function DebugDevelop() {
  const { file, profile } = useLocalSearchParams<{ file?: string; profile?: string }>();
  const [status, setStatus] = useState('starting');

  useEffect(() => {
    if (!__DEV__ || !file) return;
    let cancelled = false;
    (async () => {
      try {
        const t0 = Date.now();
        const source = await new File(Paths.document, file).bytes();
        const shot = await enqueueDevelop({ source, profileId: profile ?? 'zeiss-2007', origin: 'import', seed: 1234 });
        console.log(`[debug] developed ${shot.fileName} ${shot.width}x${shot.height} in ${Date.now() - t0} ms`);
        if (!cancelled) router.replace(`/shot/${shot.id}`);
      } catch (e) {
        console.error('[debug] develop failed', e);
        setStatus(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, profile]);

  if (!__DEV__) return <Redirect href="/" />;
  return (
    <View style={styles.screen}>
      <Text style={styles.text}>{file ?? 'no file'}</Text>
      <DevelopTray />
      <Text style={styles.text}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: colors.bg },
  text: { fontFamily: mono, color: colors.textDim, fontSize: 12 },
});
