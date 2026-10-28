import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import type { CameraProfile } from '../profiles';

interface Props {
  profile: CameraProfile;
  point: { x: number; y: number; key: number } | null;
}

/**
 * Period-correct focus indicator: green corner brackets on Nokias, the
 * bouncing blue-white box on iPhones.
 */
export function FocusMark({ profile, point }: Props) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const isPhone = profile.inspiredBy.toLowerCase().includes('iphone');

  useEffect(() => {
    if (!point) return;
    scale.value = isPhone ? 1.6 : 1;
    opacity.value = 1;
    scale.value = withTiming(1, { duration: 220 });
    opacity.value = withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 300 }));
  }, [point, isPhone, scale, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  if (!point) return null;
  const size = isPhone ? 84 : 64;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.mark, { left: point.x - size / 2, top: point.y - size / 2, width: size, height: size }, style]}
    >
      {isPhone ? (
        <View style={styles.box} />
      ) : (
        <>
          <View style={[styles.corner, { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 }]} />
          <View style={[styles.corner, { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 }]} />
          <View style={[styles.corner, { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 }]} />
          <View style={[styles.corner, { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 }]} />
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  mark: { position: 'absolute' },
  box: { flex: 1, borderWidth: 2, borderColor: '#7FB8FF', backgroundColor: 'rgba(127,184,255,0.08)' },
  corner: { position: 'absolute', width: 14, height: 14, borderColor: '#5CFF5C' },
});
