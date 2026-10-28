import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { getProfile } from '../profiles';
import { listShots, onShotsChanged, shotFiles, type Shot } from '../storage/shots';
import { colors, mono } from '../ui/theme';

const COLUMNS = 3;
const GAP = 2;

export default function Gallery() {
  const { width } = useWindowDimensions();
  const [shots, setShots] = useState<Shot[]>(listShots);
  useEffect(() => onShotsChanged(() => setShots(listShots())), []);
  const size = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  if (shots.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Memory card is empty</Text>
        <Text style={styles.emptyText}>Shots you take or import land here, with the file names the phone would have used.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={shots}
      numColumns={COLUMNS}
      keyExtractor={(s) => s.id}
      columnWrapperStyle={{ gap: GAP }}
      contentContainerStyle={{ gap: GAP, paddingBottom: 40 }}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push(`/shot/${item.id}`)} style={{ width: size, height: size }}>
          <Image source={{ uri: shotFiles(item).developed.uri }} style={styles.img} />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{getProfile(item.profileId).model}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  img: { width: '100%', height: '100%', backgroundColor: colors.surface },
  badge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  badgeText: { fontFamily: mono, fontSize: 9, color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  emptyText: { color: colors.textDim, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
