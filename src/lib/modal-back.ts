/**
 * Modal-aware hardware/browser back support.
 *
 * Screens register their open dialogs here; the system back button
 * (useBackHandler) closes the topmost open dialog instead of navigating
 * the screen beneath it — standard Android behaviour.
 *
 * Usage inside a screen:
 *   useEffect(() => {
 *     if (!showDeleteDialog) return;
 *     return registerBackModal(() => setShowDeleteDialog(false));
 *   }, [showDeleteDialog]);
 */

type CloseFn = () => void;

const stack: CloseFn[] = [];

/** Registers a close callback. Returns an unregister function (use as effect cleanup). */
export function registerBackModal(close: CloseFn): () => void {
  stack.push(close);
  return () => {
    const i = stack.indexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

/**
 * Tries to close the topmost open modal.
 * Returns true if a modal was closed (back press consumed), false if none open.
 */
export function closeTopBackModal(): boolean {
  const close = stack[stack.length - 1];
  if (!close) return false;
  stack.pop();
  try {
    close();
  } catch {
    // A stale close callback (unmounted dialog) — ignore, next back works normally.
  }
  return true;
}
