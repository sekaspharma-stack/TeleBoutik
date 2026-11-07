import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, X, RotateCcw, Keyboard, ZoomIn, ZoomOut, SwitchCamera, Flashlight, FlashlightOff } from 'lucide-react';

type CamInfo = { deviceId: string; label: string };
/** Objectifs à éviter par défaut : l'ultra grand-angle (0.5x) a une mise au point trop proche → image floue. */
const ULTRA_WIDE_RE = /ultra|0[.,]5|wide|grand[- ]?angle|macro|depth|profondeur|tele|zoom/i;
const BACK_RE = /back|rear|arri[eè]re|environment|principal|main/i;

function pickBestCamera(cams: CamInfo[]): CamInfo | undefined {
  const scored = cams.map((c, index) => {
    let score = 0;
    if (BACK_RE.test(c.label)) score += 3;
    if (ULTRA_WIDE_RE.test(c.label)) score -= 5;
    if (/camera2 0|camera 0|back camera$/i.test(c.label)) score += 2; // objectif principal sur Android
    return { c, score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.c;
}

/** Scanner caméra compatible avec les navigateurs Android courants via ZXing. */
export default function CameraScanner({ onDetected, onClose }: { onDetected: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onDetected);
  const detectedRef = useRef(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [cameras, setCameras] = useState<CamInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [zoomCaps, setZoomCaps] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const deviceRef = useRef<string | undefined>(undefined);
  // Taille du cadre de visée uniquement : la vidéo ne doit jamais être agrandie.
  // 10 % fournit un petit cadre d'environ 1 cm à l'écran selon la taille du téléphone.
  const [frameWidth, setFrameWidth] = useState(10);
  useEffect(() => { callbackRef.current = onDetected; }, [onDetected]);

  useEffect(() => {
    let active = true;
    let controls: { stop: () => void } | undefined;
    let onPlaying: (() => void) | undefined;
    detectedRef.current = false;
    setError('');
    setCameraReady(false);
    setFrameWidth(10);
    setZoomCaps(null);
    setTorchAvailable(false);
    setTorchOn(false);

    const stopCamera = () => {
      active = false;
      try { controls?.stop(); } catch { /* arrêt best-effort */ }
      if (videoRef.current) {
        if (onPlaying) videoRef.current.removeEventListener('playing', onPlaying);
        try { videoRef.current.pause(); } catch { /* déjà arrêté */ }
        const activeStream = videoRef.current.srcObject;
        if (activeStream instanceof MediaStream) activeStream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('La caméra nécessite un navigateur compatible et une adresse HTTPS. Vous pouvez saisir le code manuellement.');
        return;
      }
      try {
        if (!videoRef.current) return;
        onPlaying = () => { if (active) setCameraReady(true); };
        videoRef.current.addEventListener('playing', onPlaying);
        // 1) Première ouverture : caméra arrière « environment » (jamais l'ultra grand-angle choisi par défaut).
        let chosenId = deviceRef.current;
        if (!chosenId) {
          const probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          const probeTrack = probe.getVideoTracks()[0];
          const probeId = probeTrack?.getSettings().deviceId;
          probe.getTracks().forEach(t => t.stop());
          const all = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
          const list = all.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Caméra ${i + 1}` }));
          if (!active) return;
          setCameras(list);
          const best = pickBestCamera(list);
          chosenId = best?.deviceId || probeId;
          if (chosenId) { deviceRef.current = chosenId; setDeviceId(chosenId); }
        }

        // 2) Ouverture avec une bonne résolution (code-barres nets) et mise au point continue.
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: chosenId
            ? { deviceId: { exact: chosenId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        };
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 700 });
        controls = await reader.decodeFromConstraints(constraints, videoRef.current, (result) => {
          if (!active || detectedRef.current) return;
          if (result) {
            const value = result.getText().trim();
            if (!value) return;
            detectedRef.current = true;
            stopCamera();
            callbackRef.current(value);
            return;
          }
          // L'absence de code dans une frame est normale pendant le balayage.
        });

        // 3) Mise au point automatique continue + zoom matériel si disponible (best-effort).
        const stream = videoRef.current.srcObject;
        const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
        trackRef.current = track ?? null;
        if (track) {
          try {
            const caps = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean; zoom?: { min: number; max: number; step?: number } };
            if (caps.torch && active) setTorchAvailable(true);
            if (caps.focusMode?.includes('continuous')) {
              await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
            }
            if (caps.zoom && caps.zoom.max > caps.zoom.min && active) {
              setZoomCaps({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
              setZoom(Math.max(caps.zoom.min, 1));
            }
          } catch { /* contraintes non supportées : on garde les réglages par défaut */ }
        }
        if (!active) controls.stop();
      } catch (e) {
        stopCamera();
        const name = e instanceof DOMException ? e.name : (e instanceof Error ? e.name : '');
        const detail = e instanceof Error ? e.message.toLowerCase() : '';
        setCameraReady(false);
        setError(name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Autorisation caméra refusée. Autorisez la caméra dans les paramètres du navigateur puis réessayez.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'Aucune caméra compatible détectée sur cet appareil.'
            : name === 'NotReadableError' || detail.includes('could not start video source')
              ? 'La caméra est déjà utilisée par une autre application. Fermez-la puis réessayez.'
              : 'Impossible d’ouvrir la caméra. Vérifiez que le site est en HTTPS et réessayez.');
      }
    };
    void start();
    return stopCamera;
  }, [retry]);

  const changeFrameWidth = (value: number) => {
    setFrameWidth(Math.min(90, Math.max(10, value)));
  };

  const applyZoom = async (value: number) => {
    setZoom(value);
    try { await trackRef.current?.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] }); } catch { /* zoom non supporté */ }
  };

  const toggleTorch = async () => {
    const next = !torchOn;
    try { await trackRef.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }); setTorchOn(next); }
    catch { setTorchAvailable(false); /* lampe non pilotable sur cet appareil */ }
  };

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const idx = cameras.findIndex(c => c.deviceId === deviceId);
    const next = cameras[(idx + 1) % cameras.length].deviceId;
    deviceRef.current = next;
    setDeviceId(next);
    setRetry(v => v + 1);
  };

  const submitManual = () => {
    const value = manual.trim();
    if (!value || detectedRef.current) return;
    detectedRef.current = true;
    callbackRef.current(value);
  };

  return <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Scanner un code-barres">
    <div className="bg-white rounded-xl p-4 w-full max-w-md space-y-3 max-h-[95dvh] overflow-y-auto">
      <div className="flex items-center justify-between"><h2 className="font-semibold flex gap-2 items-center"><Camera className="w-5 h-5"/>Scanner un code-barres</h2><button onClick={onClose} aria-label="Fermer le scanner" className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5"/></button></div>
      <div className="relative overflow-hidden rounded-lg bg-black"><video ref={videoRef} playsInline muted autoPlay className="w-full aspect-[4/3] object-cover"/><div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-emerald-400 rounded-md transition-[width,height] duration-150" style={{ width: `${frameWidth}%`, height: `${Math.max(8, Math.min(24, frameWidth * 0.24))}%` }}><span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">Cadre rectangulaire</span></div>{cameraReady && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">Recherche du code…</span>}</div>
      <div className="flex items-center gap-2 rounded-lg bg-slate-50 border p-3">
        {cameras.length > 1 && <button type="button" onClick={switchCamera} className="btn-secondary shrink-0" title="Changer d’objectif si l’image est floue ou trop large"><SwitchCamera className="w-4 h-4"/>Objectif {Math.max(1, cameras.findIndex(c => c.deviceId === deviceId) + 1)}/{cameras.length}</button>}
        {torchAvailable && <button type="button" onClick={() => void toggleTorch()} aria-pressed={torchOn} className={`${torchOn ? 'btn-primary' : 'btn-secondary'} shrink-0`} title="Allumer ou éteindre la lampe">{torchOn ? <FlashlightOff className="w-4 h-4"/> : <Flashlight className="w-4 h-4"/>}Lampe</button>}
        {zoomCaps && <><ZoomOut className="w-4 h-4 shrink-0 text-slate-500"/><input type="range" min={zoomCaps.min} max={zoomCaps.max} step={zoomCaps.step} value={zoom} onChange={e => void applyZoom(Number(e.target.value))} aria-label="Zoom de la caméra" className="flex-1 accent-emerald-600"/><ZoomIn className="w-4 h-4 shrink-0 text-slate-500"/></>}
        {cameras.length <= 1 && !zoomCaps && !torchAvailable && <p className="text-xs text-slate-500">Éloignez le téléphone d’environ 15–20 cm du code, bien éclairé, pour obtenir une image nette.</p>}
      </div>
      <div className="flex items-center gap-3 rounded-lg bg-slate-50 border p-3" aria-label="Redimensionner le cadre du scanner">
        <button type="button" onClick={() => changeFrameWidth(frameWidth - 5)} disabled={frameWidth <= 10} aria-label="Réduire le cadre du scanner" title="Réduire le cadre" className="p-2 rounded-lg hover:bg-slate-200 disabled:opacity-40"><ZoomOut className="w-5 h-5"/></button>
        <input type="range" min={10} max={90} step={5} value={frameWidth} onChange={e => changeFrameWidth(Number(e.target.value))} aria-label="Largeur du cadre du scanner" className="flex-1 accent-emerald-600"/>
        <button type="button" onClick={() => changeFrameWidth(frameWidth + 5)} disabled={frameWidth >= 90} aria-label="Agrandir le cadre du scanner" title="Agrandir le cadre" className="p-2 rounded-lg hover:bg-slate-200 disabled:opacity-40"><ZoomIn className="w-5 h-5"/></button>
        <span className="text-xs font-medium text-slate-600 min-w-12 text-right">{frameWidth}%</span>
      </div>
      <p className="text-xs text-slate-500">Ces commandes redimensionnent uniquement le cadre vert, pas l’image de la caméra. Le cadre minimal représente environ 1 cm à l’écran selon le téléphone. Le lecteur analyse encore toute l’image caméra.</p>
      {error && <p className="text-sm text-amber-700" role="alert">{error}</p>}
      <p className="text-xs text-slate-500">Place le code dans le cadre. Le scan ne confirme ni vente ni entrée en stock.</p>
      <button onClick={() => setRetry(v => v + 1)} className="btn-secondary w-full justify-center"><RotateCcw className="w-4 h-4"/>Réessayer la caméra</button>
      <div className="border-t pt-3 space-y-2"><label className="text-sm font-medium flex items-center gap-2"><Keyboard className="w-4 h-4"/>Saisir le code manuellement</label><div className="flex gap-2"><input className="input min-w-0 flex-1" value={manual} onChange={e => setManual(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitManual()} placeholder="Code-barres ou SKU"/><button className="btn-primary" onClick={submitManual} disabled={!manual.trim()}>Valider</button></div></div>
    </div>
  </div>;
}
