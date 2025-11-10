import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import { FileWarning, RefreshCw, UploadCloud } from 'lucide-react';
import type { StoredFileReference } from '@/shared/types';
import { getFileBuffer } from '@/shared/storage/profiles';

interface ResumePreviewPaneProps {
  profileId: string | null;
  file?: StoredFileReference;
  fileSummary?: string | null;
  rawSummary?: string | null;
  rawText: string;
  uploadInputId?: string;
}

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export function ResumePreviewPane({
  profileId,
  file,
  fileSummary,
  rawSummary,
  rawText,
  uploadInputId,
}: ResumePreviewPaneProps) {
  const { t } = i18n;
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'pdf' | 'text'>(file ? 'pdf' : 'text');

  useEffect(() => {
    if (!file && activeTab === 'pdf') {
      setActiveTab('text');
    }
  }, [file, activeTab]);

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
  }, [file, profileId, reloadKey]);

  const hasRawText = rawText.trim().length > 0;

  const handleTriggerUpload = () => {
    if (!uploadInputId || typeof document === 'undefined') {
      return;
    }
    const input = document.getElementById(uploadInputId) as HTMLInputElement | null;
    input?.click();
  };

  const handleDownload = () => {
    if (!previewUrl || typeof document === 'undefined') {
      return;
    }
    const link = document.createElement('a');
    link.href = previewUrl;
    link.download = file?.name ?? 'resume.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const modalContent = previewUrl ? (
    <Box
      component="iframe"
      src={previewUrl}
      title={t('options.profileForm.preview.iframeTitle')}
      style={{ width: '100%', height: '80vh', border: 'none', borderRadius: 12 }}
    />
  ) : null;

  const renderPdfPanel = () => {
    if (!profileId) {
      return (
        <StateMessage
          icon={<FileWarning size={20} />}
          message={t('options.profileForm.preview.noProfile')}
        />
      );
    }
    if (!file) {
      return (
        <StateMessage
          icon={<UploadCloud size={20} />}
          message={t('options.profileForm.preview.empty')}
          actionLabel={t('options.profileForm.preview.replacePdf')}
          onAction={handleTriggerUpload}
        />
      );
    }
    if (status === 'loading') {
      return (
        <StateMessage
          icon={<Loader size="sm" />}
          message={t('options.profileForm.preview.loading')}
        />
      );
    }
    if (status === 'error' || !previewUrl) {
      return (
        <StateMessage
          icon={<FileWarning size={20} />}
          message={t('options.profileForm.preview.error')}
          actions={
            <Group gap="xs">
              <Button
                size="xs"
                leftSection={<RefreshCw size={14} />}
                onClick={() => setReloadKey((value) => value + 1)}
              >
                {t('options.profileForm.preview.refresh')}
              </Button>
              <Button
                size="xs"
                variant="light"
                leftSection={<UploadCloud size={14} />}
                onClick={handleTriggerUpload}
              >
                {t('options.profileForm.preview.replacePdf')}
              </Button>
            </Group>
          }
        />
      );
    }
    return (
      <Stack gap="xs">
        <Box
          component="iframe"
          src={previewUrl}
          title={t('options.profileForm.preview.iframeTitle')}
          style={{
            width: '100%',
            height: 360,
            border: 'none',
            borderRadius: 12,
            backgroundColor: 'var(--mantine-color-gray-0)',
          }}
        />
        <Group justify="space-between" align="center">
          <Button size="xs" variant="light" onClick={() => setModalOpen(true)}>
            {t('options.profileForm.preview.openModal')}
          </Button>
          <Button size="xs" variant="subtle" onClick={handleDownload}>
            {t('options.profileForm.preview.download')}
          </Button>
        </Group>
      </Stack>
    );
  };

  const renderRawTextPanel = () => {
    if (!hasRawText) {
      return (
        <StateMessage
          icon={<FileWarning size={20} />}
          message={t('options.profileForm.preview.noText')}
        />
      );
    }
    return (
      <ScrollArea style={{ maxHeight: 360 }}>
        <Text component="pre" fz="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {rawText}
        </Text>
      </ScrollArea>
    );
  };

  const helperText = useMemo(() => {
    if (fileSummary && rawSummary) {
      return `${fileSummary} · ${rawSummary}`;
    }
    return fileSummary ?? rawSummary ?? null;
  }, [fileSummary, rawSummary]);

  return (
    <>
      <Paper
        withBorder
        radius="lg"
        p="lg"
        shadow="sm"
        style={{ position: 'sticky', top: 16 }}
      >
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap={2} style={{ flex: 1 }}>
              <Text fw={600}>{t('options.profileForm.preview.heading')}</Text>
              <Text fz="sm" c="dimmed">
                {t('options.profileForm.preview.helper')}
              </Text>
              {helperText && (
                <Text fz="xs" c="dimmed">
                  {helperText}
                </Text>
              )}
            </Stack>
            <Group gap={4}>
              <Tooltip label={t('options.profileForm.preview.replacePdf')} withArrow>
                <ActionIcon
                  variant="light"
                  color="gray"
                  onClick={handleTriggerUpload}
                  aria-label={t('options.profileForm.preview.replacePdf')}
                >
                  <UploadCloud size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('options.profileForm.preview.refresh')} withArrow>
                <ActionIcon
                  variant="light"
                  color="gray"
                  onClick={() => setReloadKey((value) => value + 1)}
                  aria-label={t('options.profileForm.preview.refresh')}
                  disabled={!file}
                >
                  <RefreshCw size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          <Tabs value={activeTab} onChange={(value) => setActiveTab((value as 'pdf' | 'text') ?? 'pdf')}>
            <Tabs.List>
              <Tabs.Tab value="pdf">{t('options.profileForm.preview.tabs.pdf')}</Tabs.Tab>
              <Tabs.Tab value="text">{t('options.profileForm.preview.tabs.text')}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="pdf" pt="sm">
              {renderPdfPanel()}
            </Tabs.Panel>
            <Tabs.Panel value="text" pt="sm">
              {renderRawTextPanel()}
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </Paper>

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('options.profileForm.preview.modalTitle')}
        size="90%"
        fullScreen={false}
      >
        {modalContent}
      </Modal>
    </>
  );
}

interface StateMessageProps {
  icon: JSX.Element;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  actions?: JSX.Element;
}

function StateMessage({ icon, message, actionLabel, onAction, actions }: StateMessageProps) {
  return (
    <Stack gap="sm" align="center" justify="center" style={{ minHeight: 240, textAlign: 'center' }}>
      <Center
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          backgroundColor: 'var(--mantine-color-gray-1)',
        }}
      >
        {icon}
      </Center>
      <Text fz="sm" c="dimmed">
        {message}
      </Text>
      {actions}
      {actionLabel && (
        <Button size="xs" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Stack>
  );
}
