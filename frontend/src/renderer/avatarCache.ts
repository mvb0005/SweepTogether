import { discordProxiedUrl } from '../discord/discordApi';

type AvatarState = HTMLImageElement | 'loading' | 'error';

const cache = new Map<string, AvatarState>();
const listeners = new Map<string, Set<() => void>>();

export function getAvatarImage(url: string | undefined): HTMLImageElement | null {
  if (!url) return null;
  const state = cache.get(url);
  return state instanceof HTMLImageElement ? state : null;
}

export function requestAvatar(url: string | undefined, onLoad: () => void): void {
  if (!url) return;
  const existing = cache.get(url);
  if (existing instanceof HTMLImageElement) {
    onLoad();
    return;
  }
  if (existing === 'loading') {
    listeners.get(url)?.add(onLoad);
    return;
  }
  if (existing === 'error') return;

  cache.set(url, 'loading');
  if (!listeners.has(url)) listeners.set(url, new Set());
  listeners.get(url)!.add(onLoad);

  const fetchUrl = discordProxiedUrl(url);
  const img = new Image();
  if (!fetchUrl.startsWith('/')) {
    img.crossOrigin = 'anonymous';
  }
  img.onload = () => {
    cache.set(url, img);
    const pending = listeners.get(url);
    if (pending) {
      for (const fn of pending) fn();
      listeners.delete(url);
    }
  };
  img.onerror = () => {
    cache.set(url, 'error');
    listeners.get(url)?.delete(onLoad);
  };
  img.src = fetchUrl;
}
