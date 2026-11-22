export function deskWork<T>(hasWork: boolean, run: () => Promise<T>, quit: Promise<void>) {
  return hasWork ? run() : quit.then(() => undefined as T | undefined);
}
