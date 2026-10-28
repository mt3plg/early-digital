import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { colors } from '../ui/theme';

SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="gallery" options={{ title: 'Memory card', headerBackTitle: 'Camera' }} />
        <Stack.Screen name="shot/[id]" options={{ title: '', headerTransparent: true, headerBackTitle: 'Back' }} />
        <Stack.Screen name="debug" options={{ title: 'Debug develop' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
