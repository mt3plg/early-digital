import { Platform } from 'react-native';

export const colors = {
  bg: '#0B0B0C',
  surface: '#161618',
  surfaceHi: '#202023',
  line: '#2A2A2E',
  text: '#F2EFE9',
  textDim: '#8D8A84',
  textFaint: '#55534F',
  // Backlit-keypad amber, the colour of every 2000s phone at night.
  accent: '#FF9F2E',
  accentDim: '#7A4A12',
  lcd: '#B8E986',
  danger: '#FF5A4E',
};

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const radius = { sm: 6, md: 12, lg: 20 };
