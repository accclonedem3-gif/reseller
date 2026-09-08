import { useEffect, useRef, useState, useCallback } from "react";

type Phase = "off" | "spark" | "booting" | "online";

export function RobotMascot({ className = "" }: { className?: string }) {
  const [phase, setPhase] = useState<Phase>("off");
  const svgRef = useRef<SVGSVGElement>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);

  // Boot sequence
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("spark"), 800);
    const t2 = setTimeout(() => setPhase("booting"), 1600);
    const t3 = setTimeout(() => setPhase("online"), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Blink cycle
  useEffect(() => {
    if (phase !== "online") return;
    const loop = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 150);
    }, 3000 + Math.random() * 2000);
    return () => clearInterval(loop);
  }, [phase]);

  // Mouse tracking
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (window.innerWidth / 2);
    const dy = (e.clientY - cy) / (window.innerHeight / 2);
    setMouse({ x: Math.max(-1, Math.min(1, dx)), y: Math.max(-1, Math.min(1, dy)) });
  }, []);

  useEffect(() => {
    if (phase !== "online") return;
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [phase, handleMouseMove]);

  const eyeOffsetX = phase === "online" ? mouse.x * 3.5 : 0;
  const eyeOffsetY = phase === "online" ? mouse.y * 2.5 : 0;
  const bodyTilt = phase === "online" ? mouse.x * 3 : 0;
  const antennaWiggle = phase === "online" ? mouse.x * -6 : 0;

  const isOn = phase === "booting" || phase === "online";
  const eyeColor = phase === "online" ? "#f97316" : phase === "booting" ? "#f9731680" : "#333";
  const screenColor = isOn ? "rgba(249,115,22,0.08)" : "#111";
  const glowOpacity = phase === "online" ? 0.6 : phase === "booting" ? 0.2 : 0;
  const bodyStroke = isOn ? "rgba(249,115,22,0.3)" : "rgba(255,255,255,0.06)";

  return (
    <div className={`relative select-none ${className}`}>
      {/* Glow behind robot */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-1000"
        style={{
          width: 280, height: 280,
          background: `radial-gradient(circle, rgba(249,115,22,${glowOpacity * 0.3}), transparent 70%)`,
          filter: "blur(40px)",
        }}
      />

      <svg
        ref={svgRef}
        viewBox="0 0 200 240"
        width="320"
        height="384"
        className="relative z-10"
        style={{
          transform: `rotate(${bodyTilt}deg)`,
          transition: "transform 0.15s ease-out",
          filter: phase === "spark" ? "brightness(1.8) contrast(1.3)" : undefined,
        }}
      >
        <defs>
          {/* Eye glow */}
          <filter id="robot-eye-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Screen glow */}
          <filter id="robot-screen-glow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Spark flash */}
          <filter id="robot-spark">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          {/* Body gradient */}
          <linearGradient id="robot-body-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a2a2a" />
            <stop offset="100%" stopColor="#1a1a1a" />
          </linearGradient>
          <linearGradient id="robot-head-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#333" />
            <stop offset="100%" stopColor="#222" />
          </linearGradient>
        </defs>

        {/* ── ANTENNA ── */}
        <g style={{ transform: `rotate(${antennaWiggle}deg)`, transformOrigin: "100px 52px", transition: "transform 0.2s ease-out" }}>
          <line x1="100" y1="52" x2="100" y2="28" stroke="#555" strokeWidth="3" strokeLinecap="round" />
          <circle cx="100" cy="24" r="6" fill={isOn ? "#f97316" : "#333"} style={{ transition: "fill 0.5s" }}>
            {phase === "online" && (
              <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
            )}
          </circle>
          {/* Antenna glow */}
          {isOn && (
            <circle cx="100" cy="24" r="10" fill="none" stroke="rgba(249,115,22,0.3)" strokeWidth="2" opacity={glowOpacity}>
              <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
            </circle>
          )}
        </g>

        {/* ── HEAD ── */}
        <rect x="55" y="48" width="90" height="72" rx="20" fill="url(#robot-head-grad)" stroke={bodyStroke} strokeWidth="1.5" style={{ transition: "stroke 1s" }} />

        {/* ── SCREEN/FACE ── */}
        <rect x="66" y="58" width="68" height="48" rx="10" fill={screenColor} stroke={isOn ? "rgba(249,115,22,0.15)" : "rgba(255,255,255,0.04)"} strokeWidth="1" style={{ transition: "fill 0.8s, stroke 0.8s" }}>
          {phase === "booting" && (
            <animate attributeName="opacity" values="1;0.3;1;0.6;1" dur="0.4s" repeatCount="5" />
          )}
        </rect>

        {/* ── EYES ── */}
        {!blink ? (
          <>
            <circle
              cx={85 + eyeOffsetX} cy={82 + eyeOffsetY} r={phase === "online" ? 6 : 5}
              fill={eyeColor}
              filter={isOn ? "url(#robot-eye-glow)" : undefined}
              style={{ transition: "fill 0.5s, r 0.3s" }}
            />
            <circle
              cx={115 + eyeOffsetX} cy={82 + eyeOffsetY} r={phase === "online" ? 6 : 5}
              fill={eyeColor}
              filter={isOn ? "url(#robot-eye-glow)" : undefined}
              style={{ transition: "fill 0.5s, r 0.3s" }}
            />
            {/* Pupil highlights */}
            {phase === "online" && (
              <>
                <circle cx={83 + eyeOffsetX} cy={80 + eyeOffsetY} r="2" fill="rgba(255,255,255,0.6)" />
                <circle cx={113 + eyeOffsetX} cy={80 + eyeOffsetY} r="2" fill="rgba(255,255,255,0.6)" />
              </>
            )}
          </>
        ) : (
          <>
            {/* Blink = horizontal lines */}
            <line x1={79 + eyeOffsetX} y1={82 + eyeOffsetY} x2={91 + eyeOffsetX} y2={82 + eyeOffsetY} stroke={eyeColor} strokeWidth="2.5" strokeLinecap="round" />
            <line x1={109 + eyeOffsetX} y1={82 + eyeOffsetY} x2={121 + eyeOffsetX} y2={82 + eyeOffsetY} stroke={eyeColor} strokeWidth="2.5" strokeLinecap="round" />
          </>
        )}

        {/* ── MOUTH ── */}
        {phase === "online" && (
          <rect x="90" y="96" width="20" height="4" rx="2" fill="rgba(249,115,22,0.5)" style={{ transition: "fill 0.5s" }}>
            <animate attributeName="width" values="20;24;20" dur="3s" repeatCount="indefinite" />
            <animate attributeName="x" values="90;88;90" dur="3s" repeatCount="indefinite" />
          </rect>
        )}
        {phase !== "online" && (
          <line x1="90" y1="98" x2="110" y2="98" stroke="#333" strokeWidth="2" strokeLinecap="round" />
        )}

        {/* ── Static noise on screen when booting ── */}
        {phase === "booting" && (
          <g opacity="0.3">
            {Array.from({ length: 12 }).map((_, i) => (
              <rect
                key={i}
                x={68 + Math.random() * 60}
                y={60 + Math.random() * 42}
                width={2 + Math.random() * 8}
                height="1.5"
                fill="#f97316"
                opacity={0.3 + Math.random() * 0.7}
              >
                <animate attributeName="opacity" values={`${Math.random()};${Math.random()};${Math.random()}`} dur={`${0.1 + Math.random() * 0.3}s`} repeatCount="indefinite" />
              </rect>
            ))}
          </g>
        )}

        {/* ── NECK ── */}
        <rect x="90" y="120" width="20" height="14" rx="4" fill="#222" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />

        {/* ── BODY ── */}
        <rect x="50" y="132" width="100" height="68" rx="16" fill="url(#robot-body-grad)" stroke={bodyStroke} strokeWidth="1.5" style={{ transition: "stroke 1s" }} />

        {/* Chest indicator */}
        <circle cx="100" cy="155" r="8" fill="transparent" stroke={isOn ? "rgba(249,115,22,0.25)" : "rgba(255,255,255,0.05)"} strokeWidth="1.5" style={{ transition: "stroke 0.8s" }} />
        <circle cx="100" cy="155" r="3.5" fill={isOn ? "#f97316" : "#222"} style={{ transition: "fill 0.8s" }}>
          {phase === "online" && (
            <animate attributeName="opacity" values="1;0.5;1" dur="3s" repeatCount="indefinite" />
          )}
          {phase === "booting" && (
            <animate attributeName="opacity" values="0;1;0;1;0;1" dur="1.5s" repeatCount="1" fill="freeze" />
          )}
        </circle>

        {/* Body panel lines */}
        <line x1="68" y1="172" x2="132" y2="172" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        <rect x="70" y="178" width="12" height="12" rx="3" fill="transparent" stroke={isOn ? "rgba(249,115,22,0.15)" : "rgba(255,255,255,0.04)"} strokeWidth="1" style={{ transition: "stroke 0.8s" }} />
        <rect x="86" y="178" width="12" height="12" rx="3" fill="transparent" stroke={isOn ? "rgba(249,115,22,0.15)" : "rgba(255,255,255,0.04)"} strokeWidth="1" style={{ transition: "stroke 0.8s" }} />
        <rect x="102" y="178" width="12" height="12" rx="3" fill="transparent" stroke={isOn ? "rgba(249,115,22,0.12)" : "rgba(255,255,255,0.04)"} strokeWidth="1" style={{ transition: "stroke 0.8s" }} />
        <rect x="118" y="178" width="12" height="12" rx="3" fill="transparent" stroke={isOn ? "rgba(249,115,22,0.1)" : "rgba(255,255,255,0.04)"} strokeWidth="1" style={{ transition: "stroke 0.8s" }} />

        {/* ── LEFT ARM ── */}
        <g style={{ transform: `rotate(${phase === "online" ? mouse.y * 5 : 0}deg)`, transformOrigin: "50px 145px", transition: "transform 0.2s ease-out" }}>
          <rect x="28" y="140" width="22" height="44" rx="10" fill="#252525" stroke={bodyStroke} strokeWidth="1" style={{ transition: "stroke 1s" }} />
          <circle cx="39" cy="190" r="8" fill="#222" stroke={bodyStroke} strokeWidth="1" style={{ transition: "stroke 1s" }} />
        </g>

        {/* ── RIGHT ARM ── */}
        <g style={{ transform: `rotate(${phase === "online" ? mouse.y * -5 : 0}deg)`, transformOrigin: "150px 145px", transition: "transform 0.2s ease-out" }}>
          <rect x="150" y="140" width="22" height="44" rx="10" fill="#252525" stroke={bodyStroke} strokeWidth="1" style={{ transition: "stroke 1s" }} />
          <circle cx="161" cy="190" r="8" fill="#222" stroke={bodyStroke} strokeWidth="1" style={{ transition: "stroke 1s" }} />
        </g>

        {/* ── LEGS/WHEELS ── */}
        <rect x="68" y="200" width="18" height="22" rx="6" fill="#222" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        <rect x="114" y="200" width="18" height="22" rx="6" fill="#222" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        {/* Wheel bottoms */}
        <ellipse cx="77" cy="224" rx="10" ry="4" fill="#1a1a1a" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        <ellipse cx="123" cy="224" rx="10" ry="4" fill="#1a1a1a" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />

        {/* ── SPARK EFFECT (phase=spark) ── */}
        {phase === "spark" && (
          <g>
            <line x1="95" y1="148" x2="85" y2="135" stroke="#f97316" strokeWidth="2" opacity="0.9" filter="url(#robot-spark)">
              <animate attributeName="opacity" values="0;1;0" dur="0.3s" repeatCount="3" />
            </line>
            <line x1="105" y1="150" x2="118" y2="138" stroke="#fbbf24" strokeWidth="1.5" opacity="0.8" filter="url(#robot-spark)">
              <animate attributeName="opacity" values="0;0.8;0" dur="0.25s" repeatCount="3" />
            </line>
            <line x1="100" y1="145" x2="100" y2="130" stroke="#fff" strokeWidth="1" opacity="0.6" filter="url(#robot-spark)">
              <animate attributeName="opacity" values="0;0.6;0" dur="0.2s" repeatCount="4" />
            </line>
            {/* Small sparks */}
            <circle cx="88" cy="138" r="1.5" fill="#f97316">
              <animate attributeName="opacity" values="0;1;0" dur="0.15s" repeatCount="5" />
            </circle>
            <circle cx="112" cy="140" r="1" fill="#fbbf24">
              <animate attributeName="opacity" values="0;1;0" dur="0.18s" repeatCount="4" />
            </circle>
          </g>
        )}

        {/* ── Idle breathing (online) ── */}
        {phase === "online" && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0; 0,-2; 0,0"
            dur="4s"
            repeatCount="indefinite"
          />
        )}
      </svg>

      {/* Power cable / connector visual */}
      {phase === "off" && (
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-mono tracking-wider text-white/15 uppercase">
          ⚡ no power
        </div>
      )}
      {phase === "spark" && (
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-mono tracking-wider text-orange-500/60 uppercase animate-pulse">
          ⚡ connecting...
        </div>
      )}
      {phase === "booting" && (
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-mono tracking-wider text-orange-400/50 uppercase">
          ▶ booting system...
        </div>
      )}
      {phase === "online" && (
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-mono tracking-wider text-orange-400/40 uppercase">
          ● online
        </div>
      )}
    </div>
  );
}
