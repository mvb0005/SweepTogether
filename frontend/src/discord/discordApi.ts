export function discordAvatarUrl(userId: string, avatar: string | null | undefined): string {
  if (avatar) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=128`;
  }
  const index = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Route Discord CDN assets through the Activity proxy to satisfy iframe CSP. */
export function discordProxiedUrl(url: string): string {
  if (!isDiscordEmbedded()) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'cdn.discordapp.com') return url;
    return `/.proxy/cdn${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function discordApiPath(path: string): string {
  const inDiscordIframe = window.parent !== window;
  const prefix = inDiscordIframe ? '/.proxy' : '';
  return `${prefix}${path}`;
}

export function isDiscordEmbedded(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

export function isDiscordActivityCandidate(): boolean {
  return Boolean(import.meta.env.VITE_DISCORD_CLIENT_ID) && isDiscordEmbedded();
}

export function discordGameId(instanceId: string): string {
  return `discord-${instanceId}`;
}

export function displayDiscordName(user: {
  global_name?: string | null;
  username: string;
}): string {
  return user.global_name?.trim() || user.username;
}
