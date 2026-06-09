import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DiscordSDK, Events } from '@discord/embedded-app-sdk';
import {
  discordApiPath,
  discordAvatarUrl,
  discordGameId,
  displayDiscordName,
  isDiscordActivityCandidate,
  isDiscordEmbedded,
} from './discordApi';

export type DiscordMode = 'loading' | 'web' | 'discord';

export interface DiscordUser {
  id: string;
  username: string;
  avatarUrl: string;
}

export interface DiscordParticipant {
  id: string;
  username: string;
  avatarUrl: string;
}

type SdkParticipant = {
  id: string;
  username: string;
  avatar?: string | null;
  global_name?: string | null;
  nickname?: string;
};

export interface DiscordContextValue {
  mode: DiscordMode;
  gameId: string;
  username: string;
  avatarUrl: string | null;
  user: DiscordUser | null;
  instanceId: string | null;
  participants: ReadonlyMap<string, DiscordParticipant>;
  getParticipant: (discordUserId: string | undefined) => DiscordParticipant | null;
  speakingUserIds: ReadonlySet<string>;
  isSpeaking: (discordUserId: string | undefined) => boolean;
  error: string | null;
}

const DiscordContext = createContext<DiscordContextValue | null>(null);

const DEFAULT_GAME_ID = 'default';
const DEFAULT_USERNAME = 'Anonymous';
const SDK_READY_TIMEOUT_MS = 8_000;
const SDK_BOOT_TIMEOUT_MS = 15_000;

function mapSdkParticipants(list: SdkParticipant[]): Map<string, DiscordParticipant> {
  const map = new Map<string, DiscordParticipant>();
  for (const p of list) {
    map.set(p.id, {
      id: p.id,
      username: p.nickname?.trim() || displayDiscordName(p),
      avatarUrl: discordAvatarUrl(p.id, p.avatar),
    });
  }
  return map;
}

interface DiscordProviderProps {
  children: React.ReactNode;
}

export const DiscordProvider: React.FC<DiscordProviderProps> = ({ children }) => {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
  const [mode, setMode] = useState<DiscordMode>(
    isDiscordActivityCandidate() ? 'loading' : 'web',
  );
  const [user, setUser] = useState<DiscordUser | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [speakingUserIds, setSpeakingUserIds] = useState<Set<string>>(new Set());
  const [participants, setParticipants] = useState<Map<string, DiscordParticipant>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const sdkRef = useRef<DiscordSDK | null>(null);

  useEffect(() => {
    if (!clientId || !isDiscordEmbedded()) {
      setMode('web');
      return;
    }

    let cancelled = false;
    const speakingListeners: Array<{
      event: Events.SPEAKING_START | Events.SPEAKING_STOP;
      listener: (data: { user_id: string }) => void;
    }> = [];
    let onParticipantsUpdate:
      | ((data: { participants: SdkParticipant[] }) => void)
      | null = null;

    const boot = async () => {
      const discordSdk = new DiscordSDK(clientId);
      sdkRef.current = discordSdk;

      const ready = Promise.race([
        discordSdk.ready(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Discord SDK ready timeout')), SDK_READY_TIMEOUT_MS);
        }),
      ]);

      await ready;
      if (cancelled) return;

      const { code } = await discordSdk.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify', 'rpc.voice.read'],
      });

      const tokenRes = await fetch(discordApiPath('/api/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!tokenRes.ok) {
        throw new Error(`Token exchange failed (${tokenRes.status})`);
      }

      const { access_token: accessToken } = await tokenRes.json() as { access_token?: string };
      if (!accessToken) throw new Error('Missing access token');

      const auth = await discordSdk.commands.authenticate({ access_token: accessToken });
      if (!auth?.user) throw new Error('Discord authentication failed');

      setUser({
        id: auth.user.id,
        username: displayDiscordName(auth.user),
        avatarUrl: discordAvatarUrl(auth.user.id, auth.user.avatar),
      });
      setInstanceId(discordSdk.instanceId);
      setMode('discord');

      onParticipantsUpdate = ({ participants: list }) => {
        setParticipants(mapSdkParticipants(list));
      };
      try {
        const { participants: list } =
          await discordSdk.commands.getInstanceConnectedParticipants();
        setParticipants(mapSdkParticipants(list));
      } catch (err) {
        console.warn('[discord] failed to fetch instance participants:', err);
      }
      await discordSdk.subscribe(
        Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE,
        onParticipantsUpdate,
      );

      const channelId = discordSdk.channelId;
      if (channelId) {
        const onStart = ({ user_id }: { user_id: string }) => {
          setSpeakingUserIds(prev => new Set(prev).add(user_id));
        };
        const onStop = ({ user_id }: { user_id: string }) => {
          setSpeakingUserIds(prev => {
            const next = new Set(prev);
            next.delete(user_id);
            return next;
          });
        };
        try {
          await discordSdk.subscribe(Events.SPEAKING_START, onStart, { channel_id: channelId });
          await discordSdk.subscribe(Events.SPEAKING_STOP, onStop, { channel_id: channelId });
          speakingListeners.push(
            { event: Events.SPEAKING_START, listener: onStart },
            { event: Events.SPEAKING_STOP, listener: onStop },
          );
        } catch (err) {
          console.warn('[discord] speaking indicator unavailable:', err);
        }
      } else {
        console.warn('[discord] no voice channel id — speaking indicator disabled');
      }

      void discordSdk.commands.setActivity({
        activity: {
          type: 0,
          details: 'Sweeping the infinite board',
          state: 'Exploring together',
        },
      });
    };

    const bootWithTimeout = Promise.race([
      boot(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Discord activity startup timeout')), SDK_BOOT_TIMEOUT_MS);
      }),
    ]);

    void bootWithTimeout.catch(err => {
      if (cancelled) return;
      console.warn('[discord] falling back to web mode:', err);
      setError(err instanceof Error ? err.message : 'Discord init failed');
      setMode('web');
    });
    return () => {
      cancelled = true;
      const sdk = sdkRef.current;
      if (!sdk) return;
      for (const { event, listener } of speakingListeners) {
        void sdk.unsubscribe(event, listener, { channel_id: sdk.channelId });
      }
      if (onParticipantsUpdate) {
        void sdk.unsubscribe(
          Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE,
          onParticipantsUpdate,
        );
      }
    };
  }, [clientId]);

  const getParticipant = useCallback(
    (discordUserId: string | undefined) =>
      discordUserId ? participants.get(discordUserId) ?? null : null,
    [participants],
  );

  const isSpeaking = useCallback(
    (discordUserId: string | undefined) =>
      Boolean(discordUserId && speakingUserIds.has(discordUserId)),
    [speakingUserIds],
  );

  const value = useMemo<DiscordContextValue>(() => {
    const params = new URLSearchParams(window.location.search);
    const fallbackName = params.get('username') || params.get('playerId') || DEFAULT_USERNAME;
    const fallbackGame = params.get('gameId') || DEFAULT_GAME_ID;

    if (mode === 'discord' && instanceId && user) {
      return {
        mode,
        gameId: discordGameId(instanceId),
        username: user.username,
        avatarUrl: user.avatarUrl,
        user,
        instanceId,
        participants,
        getParticipant,
        speakingUserIds,
        isSpeaking,
        error,
      };
    }

    return {
      mode,
      gameId: fallbackGame,
      username: fallbackName,
      avatarUrl: null,
      user: null,
      instanceId: null,
      participants,
      getParticipant,
      speakingUserIds,
      isSpeaking,
      error,
    };
  }, [mode, instanceId, user, error, participants, getParticipant, speakingUserIds, isSpeaking]);

  return <DiscordContext.Provider value={value}>{children}</DiscordContext.Provider>;
};

export function useDiscord(): DiscordContextValue {
  const ctx = useContext(DiscordContext);
  if (!ctx) throw new Error('useDiscord must be used within a DiscordProvider');
  return ctx;
}
