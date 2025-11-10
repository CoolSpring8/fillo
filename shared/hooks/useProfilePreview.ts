import { useCallback, useEffect, useState } from 'react';

import type { StoredFileReference } from '@/shared/types';
import { getFileBuffer } from '@/shared/storage/profiles';

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

interface UseProfilePreviewOptions {
  profileId: string | null;
  file?: StoredFileReference | null;
}

export function useProfilePreview({ profileId, file }: UseProfilePreviewOptions) {
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    let objectUrl: string | null = null;

    if (!profileId || !file) {
      setPreviewUrl(null);
      setStatus('idle');
      return () => {
        mounted = false;
      };
    }

    setStatus('loading');
    getFileBuffer(profileId)
      .then((buffer) => {
        if (!mounted) {
          return;
        }
        if (!buffer) {
          setStatus('error');
          setPreviewUrl(null);
          return;
        }
        const blob = new Blob([buffer], { type: file.type || 'application/pdf' });
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
        setStatus('ready');
      })
      .catch((error) => {
        console.warn('Unable to load PDF preview', error);
        if (mounted) {
          setStatus('error');
          setPreviewUrl(null);
        }
      });

    return () => {
      mounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [profileId, file, reloadKey]);

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  return { status, previewUrl, reload };
}
