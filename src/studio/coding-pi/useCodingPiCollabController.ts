import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { HermesCodingPiCollabLinks } from '../../api/hermes-coding-pi';
import {
  NativeCollabClient,
  useNativeCollabSnapshot,
  type CollabSnapshot,
} from './collab-native-client';

const NAME_STORAGE_KEY = 'hermes.coding.pi.collab.name';
const LINK_STORAGE_KEY = 'hermes.coding.pi.collab.link';

export interface CodingPiCollabController {
  client: NativeCollabClient | null;
  error: string | null;
  link: string;
  loading: boolean;
  name: string;
  snapshot: CollabSnapshot | null;
  connect(link: string, name?: string): void;
  leave(): void;
  rejoin(): void;
  setName(name: string): void;
}

/**
 * Keeps the native collab guest alive beside the normal Pi RPC controller.
 * Chat-mode changes only hide/show the Coding surface; they do not tear down
 * this store, so the Pi stream and room connection continue independently.
 */
export function useCodingPiCollabController({
  currentCollab,
}: {
  currentCollab?: HermesCodingPiCollabLinks | null;
}): CodingPiCollabController {
  const [client, setClient] = useState<NativeCollabClient | null>(null);
  const [name, setNameState] = useState('guest');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  const autoConnectDisabledRef = useRef(false);
  const lastAutoLinkRef = useRef('');
  const snapshot = useNativeCollabSnapshot(client);

  useEffect(() => {
    let active = true;
    void Promise.all([
      AsyncStorage.getItem(NAME_STORAGE_KEY),
      AsyncStorage.getItem(LINK_STORAGE_KEY),
    ]).then(([storedName, storedLink]) => {
      if (!active) return;
      if (storedName?.trim()) setNameState(storedName.trim().slice(0, 32));
      if (storedLink?.trim()) setLink(storedLink.trim());
      loadedRef.current = true;
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      loadedRef.current = true;
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const connect = useCallback((nextLink: string, nextName = name) => {
    const normalizedLink = nextLink.trim();
    const normalizedName = nextName.trim().slice(0, 32) || 'guest';
    if (!normalizedLink) {
      setError('paste a collab link first');
      return;
    }
    try {
      const next = new NativeCollabClient(normalizedLink, normalizedName);
      setError(null);
      autoConnectDisabledRef.current = false;
      lastAutoLinkRef.current = normalizedLink;
      setLink(normalizedLink);
      setNameState(normalizedName);
      void AsyncStorage.multiSet([
        [LINK_STORAGE_KEY, normalizedLink],
        [NAME_STORAGE_KEY, normalizedName],
      ]).catch(() => undefined);
      setClient((current) => {
        current?.close();
        next.connect();
        return next;
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [name]);

  const leave = useCallback(() => {
    autoConnectDisabledRef.current = true;
    setClient((current) => {
      current?.close();
      return null;
    });
    setError(null);
  }, []);

  const rejoin = useCallback(() => {
    const nextLink = link.trim();
    if (!nextLink) {
      setError('no saved collab link is available');
      return;
    }
    autoConnectDisabledRef.current = false;
    connect(nextLink, name);
  }, [connect, link, name]);

  const setName = useCallback((nextName: string) => {
    const normalized = nextName.slice(0, 32);
    setNameState(normalized);
    void AsyncStorage.setItem(NAME_STORAGE_KEY, normalized).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!loadedRef.current || autoConnectDisabledRef.current) return;
    const currentLink = currentCollab?.link?.trim() || '';
    const candidate = currentLink || link.trim();
    if (!candidate || candidate === lastAutoLinkRef.current) return;
    if (client?.link === candidate && client.getSnapshot().phase !== 'ended') return;
    lastAutoLinkRef.current = candidate;
    connect(candidate, name);
  }, [client, connect, currentCollab?.link, link, name]);

  useEffect(() => () => {
    // The controller normally remains mounted for the whole chat page. This
    // cleanup is only for account/app teardown, not a Chat/Coding mode toggle.
    client?.close();
  }, [client]);

  return {
    client,
    error,
    link,
    loading,
    name,
    snapshot,
    connect,
    leave,
    rejoin,
    setName,
  };
}
