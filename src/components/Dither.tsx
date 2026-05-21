/* eslint-disable react/no-unknown-property */
"use client";
import { useRef, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/* ─────────────────────────────────────────────────────────────
   Single self-contained shader — Perlin FBM waves +
   Bayer 8×8 ordered dithering, all in one pass.
   No EffectComposer needed.
───────────────────────────────────────────────────────────── */
const vert = /* glsl */ `
  precision highp float;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */ `
  precision highp float;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform float uWaveSpeed;
  uniform float uWaveFrequency;
  uniform float uWaveAmplitude;
  uniform vec3  uWaveColor;
  uniform vec2  uMouse;
  uniform int   uMouseEnabled;
  uniform float uMouseRadius;
  uniform float uColorNum;
  uniform float uPixelSize;

  /* ── Perlin noise helpers ── */
  vec4 mod289(vec4 x){ return x - floor(x*(1.0/289.0))*289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }
  vec2 fade2(vec2 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }

  float cnoise(vec2 P){
    vec4 Pi  = floor(P.xyxy) + vec4(0,0,1,1);
    vec4 Pf  = fract(P.xyxy) - vec4(0,0,1,1);
    Pi = mod289(Pi);
    vec4 ix=Pi.xzxz, iy=Pi.yyww, fx=Pf.xzxz, fy=Pf.yyww;
    vec4 i  = permute(permute(ix)+iy);
    vec4 gx = fract(i*(1.0/41.0))*2.0-1.0;
    vec4 gy = abs(gx)-0.5;
    vec4 tx = floor(gx+0.5); gx -= tx;
    vec2 g00=vec2(gx.x,gy.x), g10=vec2(gx.y,gy.y),
         g01=vec2(gx.z,gy.z), g11=vec2(gx.w,gy.w);
    vec4 norm=taylorInvSqrt(vec4(dot(g00,g00),dot(g01,g01),dot(g10,g10),dot(g11,g11)));
    g00*=norm.x; g01*=norm.y; g10*=norm.z; g11*=norm.w;
    float n00=dot(g00,vec2(fx.x,fy.x));
    float n10=dot(g10,vec2(fx.y,fy.y));
    float n01=dot(g01,vec2(fx.z,fy.z));
    float n11=dot(g11,vec2(fx.w,fy.w));
    vec2 f2=fade2(Pf.xy);
    return 2.3*mix(mix(n00,n10,f2.x),mix(n01,n11,f2.x),f2.y);
  }

  float fbm(vec2 p){
    float v=0.0, a=1.0;
    float freq = uWaveFrequency;
    for(int i=0;i<4;i++){
      v += a*abs(cnoise(p));
      p *= freq;
      a *= uWaveAmplitude;
    }
    return v;
  }

  float pattern(vec2 p){
    vec2 p2 = p - uTime * uWaveSpeed;
    return fbm(p + fbm(p2));
  }

  /* ── Bayer 8×8 ordered dither ── */
  float bayer(vec2 coord){
    int x = int(mod(coord.x, 8.0));
    int y = int(mod(coord.y, 8.0));
    /* row-major Bayer matrix values /64 */
    float m[64];
    m[0]= 0.0/64.0; m[1]=48.0/64.0; m[2]=12.0/64.0; m[3]=60.0/64.0;
    m[4]= 3.0/64.0; m[5]=51.0/64.0; m[6]=15.0/64.0; m[7]=63.0/64.0;
    m[8]=32.0/64.0; m[9]=16.0/64.0; m[10]=44.0/64.0;m[11]=28.0/64.0;
    m[12]=35.0/64.0;m[13]=19.0/64.0;m[14]=47.0/64.0;m[15]=31.0/64.0;
    m[16]= 8.0/64.0;m[17]=56.0/64.0;m[18]= 4.0/64.0;m[19]=52.0/64.0;
    m[20]=11.0/64.0;m[21]=59.0/64.0;m[22]= 7.0/64.0;m[23]=55.0/64.0;
    m[24]=40.0/64.0;m[25]=24.0/64.0;m[26]=36.0/64.0;m[27]=20.0/64.0;
    m[28]=43.0/64.0;m[29]=27.0/64.0;m[30]=39.0/64.0;m[31]=23.0/64.0;
    m[32]= 2.0/64.0;m[33]=50.0/64.0;m[34]=14.0/64.0;m[35]=62.0/64.0;
    m[36]= 1.0/64.0;m[37]=49.0/64.0;m[38]=13.0/64.0;m[39]=61.0/64.0;
    m[40]=34.0/64.0;m[41]=18.0/64.0;m[42]=46.0/64.0;m[43]=30.0/64.0;
    m[44]=33.0/64.0;m[45]=17.0/64.0;m[46]=45.0/64.0;m[47]=29.0/64.0;
    m[48]=10.0/64.0;m[49]=58.0/64.0;m[50]= 6.0/64.0;m[51]=54.0/64.0;
    m[52]= 9.0/64.0;m[53]=57.0/64.0;m[54]= 5.0/64.0;m[55]=53.0/64.0;
    m[56]=42.0/64.0;m[57]=26.0/64.0;m[58]=38.0/64.0;m[59]=22.0/64.0;
    m[60]=41.0/64.0;m[61]=25.0/64.0;m[62]=37.0/64.0;m[63]=21.0/64.0;
    return m[y*8+x];
  }

  vec3 ditherColor(vec3 color, vec2 fragCoord){
    vec2 pc = floor(fragCoord / uPixelSize);
    float threshold = bayer(mod(pc, 8.0)) - 0.25;
    float step = 1.0 / (uColorNum - 1.0);
    color += threshold * step;
    color = clamp(color - 0.2, 0.0, 1.0);
    return floor(color*(uColorNum-1.0)+0.5)/(uColorNum-1.0);
  }

  void main(){
    /* Pixel-snap for dither effect */
    vec2 snappedCoord = floor(gl_FragCoord.xy / uPixelSize) * uPixelSize + uPixelSize*0.5;

    vec2 uv = snappedCoord / uResolution;
    uv -= 0.5;
    uv.x *= uResolution.x / uResolution.y;

    float f = pattern(uv);

    if(uMouseEnabled == 1){
      vec2 mUV = uMouse / uResolution - 0.5;
      mUV.x *= uResolution.x / uResolution.y;
      float dist   = length(uv - mUV);
      float effect = 1.0 - smoothstep(0.0, uMouseRadius, dist);
      f -= 0.5 * effect;
    }

    vec3 col = mix(vec3(0.0), uWaveColor, f);
    col = ditherColor(col, gl_FragCoord.xy);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ─────────────────────────────────────────────────────────────
   Inner scene component
───────────────────────────────────────────────────────────── */
export interface DitherProps {
  waveSpeed?:              number;
  waveFrequency?:          number;
  waveAmplitude?:          number;
  waveColor?:              [number, number, number];
  colorNum?:               number;
  pixelSize?:              number;
  disableAnimation?:       boolean;
  enableMouseInteraction?: boolean;
  mouseRadius?:            number;
}

function WaveMesh({
  waveSpeed = 0.5,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  waveColor = [0.5, 0.5, 0.5] as [number, number, number],
  colorNum = 4,
  pixelSize = 2,
  disableAnimation = false,
  enableMouseInteraction = true,
  mouseRadius = 0.3,
}: DitherProps) {
  const { size, viewport, gl } = useThree();

  /* All uniforms in a single ref — never recreated */
  const uniforms = useRef<Record<string, THREE.IUniform>>({
    uResolution:   { value: new THREE.Vector2(size.width, size.height) },
    uTime:         { value: 0 },
    uWaveSpeed:    { value: waveSpeed },
    uWaveFrequency:{ value: waveFrequency },
    uWaveAmplitude:{ value: waveAmplitude },
    uWaveColor:    { value: new THREE.Color(...waveColor) },
    uMouse:        { value: new THREE.Vector2(size.width / 2, size.height / 2) },
    uMouseEnabled: { value: enableMouseInteraction ? 1 : 0 },
    uMouseRadius:  { value: mouseRadius },
    uColorNum:     { value: colorNum },
    uPixelSize:    { value: pixelSize },
  });

  /* ── window mouse — fires regardless of what's under the cursor ── */
  useEffect(() => {
    const canvas = gl.domElement;
    const u = uniforms.current;

    const dpr = gl.getPixelRatio();
    const w   = Math.floor(size.width  * dpr);
    const h   = Math.floor(size.height * dpr);
    u.uResolution.value.set(w, h);
    /* init mouse to center so no dark dent on load */
    u.uMouse.value.set(w / 2, h / 2);

    if (!enableMouseInteraction) return;

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      u.uMouse.value.set(
        (e.clientX - rect.left)  * dpr,
        (rect.height - (e.clientY - rect.top)) * dpr,   // flip Y
      );
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [gl, size, enableMouseInteraction]);

  /* ── frame loop — the ONLY place time is updated ── */
  useFrame(() => {
    const u = uniforms.current;

    /* update resolution in case of resize */
    const dpr = gl.getPixelRatio();
    const w   = Math.floor(size.width  * dpr);
    const h   = Math.floor(size.height * dpr);
    if (u.uResolution.value.x !== w) u.uResolution.value.set(w, h);

    /* tick time — only way animation runs */
    if (!disableAnimation) {
      u.uTime.value = performance.now() / 1000;
    }

    /* sync any prop changes */
    u.uWaveSpeed.value     = waveSpeed;
    u.uWaveFrequency.value = waveFrequency;
    u.uWaveAmplitude.value = waveAmplitude;
    u.uMouseEnabled.value  = enableMouseInteraction ? 1 : 0;
    u.uMouseRadius.value   = mouseRadius;
    u.uColorNum.value      = colorNum;
    u.uPixelSize.value     = pixelSize;
    u.uWaveColor.value.set(...waveColor);
  });

  return (
    <mesh scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        vertexShader={vert}
        fragmentShader={frag}
        uniforms={uniforms.current}
      />
    </mesh>
  );
}

/* ─────────────────────────────────────────────────────────────
   Public export
───────────────────────────────────────────────────────────── */
export default function Dither(props: DitherProps) {
  return (
    <Canvas
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      camera={{ position: [0, 0, 6] }}
      dpr={typeof window !== "undefined" ? window.devicePixelRatio : 1}
      gl={{ antialias: false }}
      frameloop="always"
    >
      <WaveMesh {...props} />
    </Canvas>
  );
}
