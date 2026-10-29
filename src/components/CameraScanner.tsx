import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, X, RotateCcw, Keyboard, ZoomIn, ZoomOut } from 'lucide-react';

/** Scanner caméra compatible avec les navigateurs Android courants via ZXing. */
export default function CameraScanner({ onDetected, onClose }: { onDetected: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onDetected);
  const detectedRef = useRef(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(4);
  const [nativeZoom, setNativeZoom] = useState(false);
  useEffect(() => { callbackRef.current = onDetected; }, [onDetected]);

  useEffect(() => {
    let active = true;
    let controls: { stop: () => void } | undefined;
    let onPlaying: (() => void) | undefined;
    detectedRef.current = false;
    setError('');
    setCameraReady(false);
    trackRef.current = null;
    setZoom(1);
    setMaxZoom(4);
    setNativeZoom(false);

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
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 700 });
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
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
        if (!active) controls.stop();
        const stream = videoRef.current?.srcObject;
        const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
        if (track) {
          trackRef.current = track;
          // Le zoom optique/numérique natif dépend du navigateur et de la caméra.
          try {
            const capabilities = track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } };
            if (capabilities.zoom && capabilities.zoom.max > capabilities.zoom.min) {
              setNativeZoom(true);
              setMaxZoom(Math.min(8, Math.max(2, capabilities.zoom.max / Math.max(1, capabilities.zoom.min))));
            }
          } catch { /* Le zoom numérique CSS reste disponible. */ }
        }
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

  const changeZoom = (value: number) => {
    const next = Math.min(maxZoom, Math.max(1, value));
    setZoom(next);
    const track = trackRef.current;
    if (!track || !nativeZoom) return;
    try {
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } };
      if (capabilities.zoom) {
        const nativeValue = Math.min(capabilities.zoom.max, capabilities.zoom.min * next);
        void track.applyConstraints({ advanced: [{ zoom: nativeValue } as MediaTrackConstraintSet] }).catch(() => { /* Le zoom visuel prend le relais. */ });
      }
    } catch { /* Le zoom visuel prend le relais. */ }
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
      <div className="relative overflow-hidden rounded-lg bg-black"><video ref={videoRef} playsInline muted autoPlay style={{ transform: `scale(${nativeZoom ? 1 : zoom})`, transformOrigin: 'center center' }} className="w-full aspect-[4/3] object-cover transition-transform duration-150"/><div className="pointer-events-none absolute inset-[18%] border-2 border-emerald-400 rounded-md"/>{cameraReady && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">Recherche du code…</span>}</div>
      <div className="flex items-center gap-3 rounded-lg bg-slate-50 border p-3" aria-label="Réglage du zoom du scanner">
        <button type="button" onClick={() => changeZoom(zoom - 0.25)} disabled={zoom <= 1} aria-label="Diminuer le zoom" className="p-2 rounded-lg hover:bg-slate-200 disabled:opacity-40"><ZoomOut className="w-5 h-5"/></button>
        <input type="range" min={1} max={maxZoom} step={0.25} value={zoom} onChange={e => changeZoom(Number(e.target.value))} aria-label="Zoom du scanner" className="flex-1 accent-emerald-600"/>
        <button type="button" onClick={() => changeZoom(zoom + 0.25)} disabled={zoom >= maxZoom} aria-label="Augmenter le zoom" className="p-2 rounded-lg hover:bg-slate-200 disabled:opacity-40"><ZoomIn className="w-5 h-5"/></button>
        <span className="text-xs font-medium text-slate-600 min-w-12 text-right">{zoom.toFixed(2).replace(/0$/, '')}×</span>
      </div>
      <p className="text-xs text-slate-500">{nativeZoom ? 'Zoom de la caméra disponible.' : 'Zoom numérique activé. Pour les petits codes, rapprochez légèrement le téléphone et gardez le code dans le cadre.'}</p>
      {error && <p className="text-sm text-amber-700" role="alert">{error}</p>}
      <p className="text-xs text-slate-500">Place le code dans le cadre. Le scan ne confirme ni vente ni entrée en stock.</p>
      <button onClick={() => setRetry(v => v + 1)} className="btn-secondary w-full justify-center"><RotateCcw className="w-4 h-4"/>Réessayer la caméra</button>
      <div className="border-t pt-3 space-y-2"><label className="text-sm font-medium flex items-center gap-2"><Keyboard className="w-4 h-4"/>Saisir le code manuellement</label><div className="flex gap-2"><input className="input min-w-0 flex-1" value={manual} onChange={e => setManual(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitManual()} placeholder="Code-barres ou SKU"/><button className="btn-primary" onClick={submitManual} disabled={!manual.trim()}>Valider</button></div></div>
    </div>
  </div>;
}
