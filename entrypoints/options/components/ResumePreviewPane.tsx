import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core';
import { FileWarning, PanelsTopLeft, RefreshCw, UploadCloud } from 'lucide-react';
import type { StoredFileReference } from '@/shared/types';
import { useProfilePreview } from '@/shared/hooks/useProfilePreview';

interface ResumePreviewPaneProps {
  profileId: string | null;
  file?: StoredFileReference;
  fileSummary?: string | null;
  rawSummary?: string | null;
  rawText: string;
  uploadInputId?: string;
  variant?: 'sidebar' | 'modal';
  onOpenWorkspace?: () => void;
}

export function ResumePreviewPane({
  profileId,
  file,
  fileSummary,
  rawSummary,
  rawText,
  uploadInputId,
  variant = 'sidebar',
  onOpenWorkspace,
}: ResumePreviewPaneProps) {
  const { t } = i18n;
  const { status, previewUrl, reload } = useProfilePreview({ profileId, file });
  const [activeTab, setActiveTab] = useState<'pdf' | 'text'>(file ? 'pdf' : 'text');

  useEffect(() => {
    if (!file && activeTab === 'pdf') {
      setActiveTab('text');
    }
  }, [file, activeTab]);

  const hasRawText = rawText.trim().length > 0;
  const previewHeight = variant === 'modal' ? 520 : 360;
  const stateHeight = variant === 'modal' ? 360 : 240;

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

  const headerActions =
    variant === 'modal' ? (
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
            onClick={reload}
            aria-label={t('options.profileForm.preview.refresh')}
            disabled={!file}
          >
            <RefreshCw size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    ) : null;

  const renderPdfPanel = () => {
    if (!profileId) {
      return (
        <StateMessage
          icon={<FileWarning size={20} />}
          message={t('options.profileForm.preview.noProfile')}
          minHeight={stateHeight}
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
          minHeight={stateHeight}
        />
      );
    }
    if (status === 'loading') {
      return (
        <StateMessage
          icon={<Loader size="sm" />}
          message={t('options.profileForm.preview.loading')}
          minHeight={stateHeight}
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
                onClick={reload}
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
          minHeight={stateHeight}
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
            height: previewHeight,
            border: 'none',
            borderRadius: 12,
            backgroundColor: 'var(--mantine-color-gray-0)',
          }}
        />
        <Group justify="flex-end" align="center">
          <Button size="xs" variant="subtle" onClick={handleDownload} disabled={!previewUrl}>
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
          minHeight={stateHeight}
        />
      );
    }
    return (
      <ScrollArea style={{ maxHeight: previewHeight }}>
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
        style={
          variant === 'sidebar'
            ? { position: 'sticky', top: 16 }
            : { height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }
        }
      >
        <Stack gap="md" style={variant === 'modal' ? { height: '100%' } : undefined}>
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
            {headerActions}
          </Group>
          {variant === 'sidebar' && onOpenWorkspace ? (
            <Button
              size="xs"
              variant="light"
              leftSection={<PanelsTopLeft size={14} />}
              onClick={onOpenWorkspace}
            >
              {t('options.profileForm.preview.openFullscreen')}
            </Button>
          ) : null}

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

    </>
  );
}

interface StateMessageProps {
  icon: JSX.Element;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  actions?: JSX.Element;
  minHeight?: number;
}

function StateMessage({ icon, message, actionLabel, onAction, actions, minHeight }: StateMessageProps) {
  return (
    <Stack
      gap="sm"
      align="center"
      justify="center"
      style={{ minHeight: minHeight ?? 240, textAlign: 'center' }}
    >
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
