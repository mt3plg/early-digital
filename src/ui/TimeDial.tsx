import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type { CameraProfile } from '../profiles';
import { colors, mono } from './theme';

const ITEM_W = 92;

interface Props {
  profiles: CameraProfile[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * A horizontal "time dial": scroll through 2002-2013 and the camera snaps to
 * whichever phone sits under the notch, with a detent tick per model.
 */
export function TimeDial({ profiles, selectedId, onSelect }: Props) {
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<CameraProfile>>(null);
  const [initialIndex] = useState(() => Math.max(0, profiles.findIndex((p) => p.id === selectedId)));
  const lastIndex = useRef(initialIndex);
  const sidePad = (width - ITEM_W) / 2;

  useEffect(() => {
    const i = profiles.findIndex((p) => p.id === selectedId);
    if (i >= 0 && i !== lastIndex.current) {
      lastIndex.current = i;
      list.current?.scrollToOffset({ offset: i * ITEM_W, animated: true });
    }
  }, [selectedId, profiles]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(profiles.length - 1, Math.round(e.nativeEvent.contentOffset.x / ITEM_W)));
    if (i !== lastIndex.current) {
      lastIndex.current = i;
      Haptics.selectionAsync().catch(() => {});
      onSelect(profiles[i].id);
    }
  };

  return (
    <View style={styles.wrap}>
      <View pointerEvents="none" style={[styles.notch, { left: width / 2 - 1 }]} />
      <FlatList
        ref={list}
        data={profiles}
        horizontal
        keyExtractor={(p) => p.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={ITEM_W}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: sidePad }}
        contentOffset={{ x: initialIndex * ITEM_W, y: 0 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item, index }) => {
          const active = item.id === selectedId;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.inspiredBy}, ${item.year}`}
              accessibilityState={{ selected: active }}
              onPress={() => list.current?.scrollToOffset({ offset: index * ITEM_W, animated: true })}
              style={styles.item}
            >
              <Text style={[styles.year, active && styles.yearActive]}>{item.year}</Text>
              <Text numberOfLines={1} style={[styles.model, active && styles.modelActive]}>
                {item.model}
              </Text>
              <View style={styles.ticks}>
                {[0, 1, 2, 3, 4].map((t) => (
                  <View key={t} style={[styles.tick, t === 2 && styles.tickMajor, active && t === 2 && styles.tickActive]} />
                ))}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 84, justifyContent: 'center' },
  notch: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: colors.accent,
    zIndex: 2,
  },
  item: { width: ITEM_W, alignItems: 'center', paddingTop: 12 },
  year: { fontFamily: mono, fontSize: 13, color: colors.textFaint, letterSpacing: 1 },
  yearActive: { color: colors.accent },
  model: { fontSize: 17, fontWeight: '600', color: colors.textDim, marginTop: 2, maxWidth: ITEM_W - 8 },
  modelActive: { color: colors.text },
  ticks: { flexDirection: 'row', marginTop: 8, width: ITEM_W, justifyContent: 'space-around', alignItems: 'flex-start' },
  tick: { width: 1, height: 6, backgroundColor: colors.line },
  tickMajor: { height: 10, backgroundColor: colors.textFaint },
  tickActive: { backgroundColor: colors.accent },
});
