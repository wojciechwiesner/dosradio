/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * Throttles a callback to at most once per `delay` ms — WITH a trailing call.
 * The previous implementation silently DROPPED calls that landed inside the
 * throttle window (the cause of "dead" sliders: the last value never reached
 * the API). Now the most recent arguments are always delivered: leading call
 * fires immediately, and if more calls arrive during the window, one trailing
 * call with the LATEST args fires when the window closes.
 */
export function throttle<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => ReturnType<T> {
  let lastCall = -Infinity;
  let lastResult: ReturnType<T>;
  let pendingArgs: Parameters<T> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (pendingArgs) {
      const args = pendingArgs;
      pendingArgs = null;
      lastCall = Date.now();
      lastResult = func(...args);
    }
  };

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    if (timeSinceLastCall >= delay) {
      lastCall = now;
      lastResult = func(...args);
    } else {
      // Inside the window: remember the LATEST args and schedule a trailing
      // call for when the window closes (never lose the final value).
      pendingArgs = args;
      if (!timer) timer = setTimeout(flush, delay - timeSinceLastCall);
    }
    return lastResult;
  };
}
