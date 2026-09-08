import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

const TOTAL_MS = 10000;
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const cl = (x: number) => Math.max(0, Math.min(1, x));

// ── THE QUANTUM AI CORE ──
// Abandoning particle clouds (which can look messy/blurry) in favor of 
// razor-sharp, hyper-futuristic geometric structures. 
// Simulates an 'Iron Man / Jarvis' style AI brain awakening.
export function CinematicIntro({ onComplete }: { onComplete: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fadeOut, setFadeOut] = useState(false);
  const doneRef = useRef(false);
  
  const handleDone = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setFadeOut(true);
    setTimeout(onComplete, 1500);
  }, [onComplete]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let w = el.clientWidth, h = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000); // Pure black for maximum contrast
    const cam = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);

    const mainGroup = new THREE.Group();
    scene.add(mainGroup);

    // ── 1. The Super-Hot AI Center ──
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.2, 64, 64), coreMat);
    mainGroup.add(core);

    // ── 2. Fake Volumetric Bloom (Using Additive Blending) ──
    const createBloom = (radius: number, opacity: number, color: number) => {
      return new THREE.Mesh(
        new THREE.SphereGeometry(radius, 64, 64),
        new THREE.MeshBasicMaterial({ 
          color, transparent: true, opacity, 
          blending: THREE.AdditiveBlending, depthWrite: false 
        })
      );
    };
    const b1 = createBloom(1.6, 0.5, 0x00ffff);
    const b2 = createBloom(2.8, 0.2, 0x0088ff);
    const b3 = createBloom(4.5, 0.05, 0x0044ff);
    core.add(b1, b2, b3);

    // ── 3. Cybernetic Wireframe Shells ──
    // Highly intricate geometric cages
    const shell1 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.5, 2),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending })
    );
    const shell2 = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3.6, 1),
      new THREE.MeshBasicMaterial({ color: 0x0055ff, wireframe: true, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending })
    );
    mainGroup.add(shell1, shell2);

    // ── 4. Orbital Gyroscope Rings ──
    // Razor thin, perfectly smooth rings
    const createRing = (radius: number, color: number) => {
      return new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.015, 32, 128),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
      );
    };
    const ringX = createRing(5.5, 0x00ffff); ringX.rotation.x = Math.PI / 2;
    const ringY = createRing(7.0, 0x0055ff); ringY.rotation.y = Math.PI / 2;
    const ringZ = createRing(8.5, 0x00aaff); ringZ.rotation.x = Math.PI / 4; ringZ.rotation.y = Math.PI / 4;
    mainGroup.add(ringX, ringY, ringZ);

    // ── 5. Expanding Energy Wave ──
    const wave = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.2, 128),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    mainGroup.add(wave);

    // ── DOM UI ──
    const mkBar = (s: string) => {
      const b = document.createElement("div");
      b.style.cssText = `position:absolute;left:0;right:0;height:10%;background:#000;z-index:10;transition:height 1.5s cubic-bezier(.22,1,.36,1);${s}:0;`;
      el.appendChild(b); return b;
    };
    const topBar = mkBar("top"), botBar = mkBar("bottom");

    const hud = document.createElement("div");
    hud.style.cssText = `position:absolute;bottom:clamp(50px,11%,100px);left:50%;transform:translateX(-50%);z-index:20;
      font-family:'JetBrains Mono',monospace;font-size:clamp(11px,1.2vw,14px);letter-spacing:0.4em;
      color:rgba(0,255,255,0);transition:color 0.5s;white-space:nowrap;text-transform:uppercase;font-weight:600;`;
    el.appendChild(hud);

    const title = document.createElement("div");
    title.style.cssText = `position:absolute;inset:0;z-index:18;display:flex;flex-direction:column;
      align-items:center;justify-content:center;pointer-events:none;opacity:0;transition:opacity 2s ease;`;
    title.innerHTML = `<div style="font-family:'Be Vietnam Pro',sans-serif;font-size:clamp(40px,7vw,90px);font-weight:900;
      letter-spacing:0.2em;color:#ffffff;text-shadow:0 0 50px rgba(0,255,255,0.6); text-transform:uppercase;">
      ALTIVOX<span style="color:#00ffff">.AI</span></div>
      <div style="margin-top:16px;font-family:'JetBrains Mono',monospace;font-size:clamp(10px,1.2vw,15px);
      letter-spacing:0.8em;color:rgba(0,255,255,0.8);">QUANTUM INTELLIGENCE</div>`;
    el.appendChild(title);
    
    const skip = document.createElement("button");
    skip.style.cssText = `position:absolute;bottom:clamp(14px,3%,28px);right:clamp(14px,3%,28px);z-index:25;
      font-family:'Be Vietnam Pro',sans-serif;font-size:10px;font-weight:600;letter-spacing:0.12em;
      color:rgba(255,255,255,0.4);background:rgba(0,0,0,0.3);border:1px solid rgba(0,255,255,0.2);
      padding:6px 14px;border-radius:99px;cursor:pointer;transition:all 0.3s;text-transform:uppercase;`;
    skip.textContent = "Skip ›";
    skip.onclick = handleDone;
    el.appendChild(skip);

    // ── Animation Loop ──
    const t0 = performance.now();
    let raf = 0;

    function tick() {
      raf = requestAnimationFrame(tick);
      const ms = performance.now() - t0;
      const t = ms / 1000;

      // Complex, independent rotations for the AI components
      shell1.rotation.y = t * 0.4;
      shell1.rotation.z = t * 0.2;
      
      shell2.rotation.y = -t * 0.2;
      shell2.rotation.x = t * 0.3;

      ringX.rotation.y = t * 0.5;
      ringY.rotation.x = -t * 0.4;
      ringZ.rotation.z = t * 0.6;

      // Throbbing core bloom
      const throb = 1 + Math.sin(t * 8) * 0.05;
      b1.scale.setScalar(throb);
      b2.scale.setScalar(throb);

      // Camera Fly-In Logic
      if (t < 5) {
        // Fly from outside the rings to right in front of the core
        const p = easeOutCubic(t / 5);
        cam.position.set(0, 0, lerp(30, 14, p));
        cam.lookAt(0, 0, 0);

        hud.textContent = "BOOTING QUANTUM CORE";
        hud.style.color = `rgba(0,255,255,${p})`;
      }

      // ── The Ignition & Reveal (5s+) ──
      if (t >= 5) {
        const p = cl((t - 5) / 4);

        // Core expands slightly then settles
        const coreScale = 1 + Math.sin(p * Math.PI) * 0.5;
        core.scale.setScalar(coreScale);

        // Energy Wave Burst
        if (p < 0.5) {
          const wp = easeOutCubic(p / 0.5);
          wave.scale.set(1 + wp * 200, 1 + wp * 200, 1);
          wave.material.opacity = (1 - wp) * 0.8;
          wave.lookAt(cam.position);
        } else {
          wave.material.opacity = 0;
        }

        // HUD & UI transitions
        hud.textContent = "SYSTEM ONLINE";
        hud.style.color = `rgba(0,255,255,${1 - p})`;

        // Fade out cinematic bars
        topBar.style.height = `${10 * (1 - easeOutCubic(p))}%`;
        botBar.style.height = `${10 * (1 - easeOutCubic(p))}%`;

        // Fade in logo
        title.style.opacity = p.toString();

        // Slow camera drift to keep it alive
        cam.position.set(0, 0, lerp(14, 15.5, p));
        cam.lookAt(0, 0, 0);
      }

      renderer.render(scene, cam);
      if (ms >= TOTAL_MS && !doneRef.current) handleDone();
    }
    
    tick();

    const onResize = () => {
      w = el.clientWidth; h = el.clientHeight;
      cam.aspect = w / h; cam.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      [renderer.domElement, topBar, botBar, hud, title, skip].forEach(n => {
        try { if (el.contains(n)) el.removeChild(n); } catch {}
      });
    };
  }, [handleDone]);

  return (
    <div ref={containerRef} className="fixed inset-0 z-[100]"
      style={{ opacity: fadeOut ? 0 : 1, transition: "opacity 1.5s cubic-bezier(.22,1,.36,1)", background: "#000000" }} />
  );
}
