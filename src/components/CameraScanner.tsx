import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/** Scanner caméra optionnel : fonctionne seulement si le navigateur expose BarcodeDetector et que la caméra est autorisée. */
export default function CameraScanner({ onDetected, onClose }: { onDetected: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let frame = 0;
    const browser = window as Window & { BarcodeDetector?: BarcodeDetectorConstructor };
    (async () => {
      if (!browser.BarcodeDetector) { setError('Ce navigateur ne prend pas en charge le scan code-barres natif. Saisis le code ou utilise un lecteur USB/Bluetooth.'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!active || !videoRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new browser.BarcodeDetector({ formats: ['ean_13','ean_8','code_128','qr_code','upc_a','upc_e'] });
        const scan = async () => {
          if (!active || !videoRef.current) return;
          try { const codes = await detector.detect(videoRef.current); if (codes[0]?.rawValue) { active = false; onDetected(codes[0].rawValue); return; } } catch { /* image non détectée sur cette frame */ }
          if (active) frame = requestAnimationFrame(() => void scan());
        };
        frame = requestAnimationFrame(() => void scan());
      } catch { setError('Caméra indisponible. Vérifie les permissions du navigateur et utilise HTTPS.'); }
    })();
    return () => { active = false; cancelAnimationFrame(frame); stream?.getTracks().forEach(t => t.stop()); };
  }, [onDetected]);
  return <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"><div className="bg-white rounded-xl p-4 w-full max-w-md space-y-3"><div className="flex items-center justify-between"><h2 className="font-semibold flex gap-2 items-center"><Camera className="w-5 h-5"/>Scanner un code</h2><button onClick={onClose} aria-label="Fermer"><X className="w-5 h-5"/></button></div><video ref={videoRef} playsInline muted className="w-full rounded-lg bg-black min-h-48"/><p className="text-sm text-red-600">{error}</p><p className="text-xs text-slate-500">Aligne le code dans le cadre. Le scan dépend des capacités du navigateur et de la caméra.</p></div></div>;
}
