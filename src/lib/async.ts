/** Rejette si la promesse ne se résout pas à temps (évite les blocages réseau infinis). */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'opération'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`Délai dépassé (timeout) : ${label}`)), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}
