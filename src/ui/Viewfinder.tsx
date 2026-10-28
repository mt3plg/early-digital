import { FilterMode, MipmapMode, Skia, TileMode } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import type { CameraPhotoOutput } from 'react-native-vision-camera';
import { SkiaCamera, type SkiaCameraRef } from 'react-native-vision-camera-skia';
import { createSynchronizable } from 'react-native-worklets';
import { buildPreviewUniforms } from '../pipeline/params';
import { PREVIEW_SKSL } from '../pipeline/shaders';
import { packUniforms } from '../pipeline/skia';
import type { CameraProfile } from '../profiles';

const previewEffect = Skia.RuntimeEffect.Make(PREVIEW_SKSL);
if (!previewEffect) throw new Error('Viewfinder shader failed to compile');
const previewPaint = Skia.Paint();

/** `frameSize` (2 floats) and `time` (1) are the last uniforms in the shader. */
const TRAILING_UNIFORMS = 3;

interface Props {
  profile: CameraProfile;
  lcd: boolean;
  position: 'back' | 'front';
  isActive: boolean;
  photoOutput: CameraPhotoOutput;
  cameraRef?: React.Ref<SkiaCameraRef>;
  style?: ViewStyle;
}

/**
 * The live viewfinder: every camera frame goes through a single-pass GPU
 * approximation of the profile's pipeline. In LCD mode it also drops to the
 * phone's screen resolution, colour depth and frame rate.
 */
export function Viewfinder({ profile, lcd, position, isActive, photoOutput, cameraRef, style }: Props) {
  // Read by the frame worklet on the camera thread; written from JS when the
  // profile changes, so the camera session never has to be rebuilt.
  const state = useMemo(() => createSynchronizable<{ uniforms: number[]; minFrameMs: number }>({ uniforms: [], minFrameMs: 0 }), []);
  const lastFrame = useMemo(() => createSynchronizable(0), []);

  useEffect(() => {
    const values = { ...buildPreviewUniforms(profile, lcd), frameSize: [1, 1], time: 0 };
    const packed = packUniforms(previewEffect!, values);
    state.setBlocking({
      uniforms: packed.slice(0, packed.length - TRAILING_UNIFORMS),
      minFrameMs: lcd ? 1000 / profile.viewfinder.fps : 0,
    });
  }, [profile, lcd, state]);

  const outputs = useMemo(() => [photoOutput], [photoOutput]);

  return (
    <View style={[styles.wrap, style]}>
      <SkiaCamera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={position}
        isActive={isActive}
        outputs={outputs}
        enablePreviewSizedOutputBuffers
        warnIfRenderSkipped={false}
        onFrame={(frame, render) => {
          'worklet';
          const s = state.getDirty();
          const now = Date.now();
          if (s.uniforms.length === 0 || (s.minFrameMs > 0 && now - lastFrame.getDirty() < s.minFrameMs)) {
            frame.dispose();
            return;
          }
          lastFrame.setBlocking(now);
          render(({ canvas, frameTexture }) => {
            const w = frameTexture.width();
            const h = frameTexture.height();
            const shader = frameTexture.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
            const u = s.uniforms.slice();
            u.push(w, h, (now % 100000) / 1000);
            previewPaint.setShader(previewEffect!.makeShaderWithChildren(u, [shader]));
            canvas.drawRect({ x: 0, y: 0, width: w, height: h }, previewPaint);
          });
          frame.dispose();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: '#000' },
});
