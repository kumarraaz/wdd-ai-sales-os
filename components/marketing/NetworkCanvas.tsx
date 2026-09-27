"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Lightweight AI sales-network visualization: a slowly rotating constellation
 * of gold nodes (leads) connected by faint steel-blue edges (relationships).
 * No textures, no shadows, capped pixel ratio — safe for a hero background.
 */
function Network({ count = 64 }: { count?: number }) {
  const group = useRef<THREE.Group>(null);

  const { nodePositions, edgePositions } = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const r = 2.1 + Math.random() * 1.7;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pts.push(
        new THREE.Vector3(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.sin(phi) * Math.sin(theta) * 0.75,
          r * Math.cos(phi)
        )
      );
    }
    const nodePositions = new Float32Array(count * 3);
    pts.forEach((p, i) => {
      nodePositions[i * 3] = p.x;
      nodePositions[i * 3 + 1] = p.y;
      nodePositions[i * 3 + 2] = p.z;
    });
    const edges: number[] = [];
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        if (pts[i].distanceTo(pts[j]) < 1.45) {
          edges.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z);
        }
      }
    }
    return { nodePositions, edgePositions: new Float32Array(edges) };
  }, [count]);

  useFrame((_, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 0.07;
      group.current.rotation.z += delta * 0.015;
    }
  });

  return (
    <group ref={group}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nodePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.055}
          color="#D4AF37"
          sizeAttenuation
          transparent
          opacity={0.95}
          depthWrite={false}
        />
      </points>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[edgePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#5B7FA6" transparent opacity={0.32} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

export default function NetworkCanvas() {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 7.2], fov: 52 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-hidden="true"
    >
      <Network />
    </Canvas>
  );
}
