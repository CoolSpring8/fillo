import { type CSSProperties, useEffect, useMemo, useRef } from 'react';
import { Box, Button, Paper, Stack, Text, Title } from '@mantine/core';

interface ConfettiPiece {
  id: number;
  left: number;
  tx: number;
  delay: number;
  color: string;
}

interface CelebrationOverlayProps {
  open: boolean;
  version: number;
  title: string;
  message: string;
  ctaLabel: string;
  onClose: () => void;
  onCta: () => void;
}

export function CelebrationOverlay({
  open,
  version,
  title,
  message,
  ctaLabel,
  onClose,
  onCta,
}: CelebrationOverlayProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const confettiPieces = useMemo<ConfettiPiece[]>(() => {
    if (!open) {
      return [];
    }
    return Array.from({ length: 80 }, (_, index) => ({
      id: index,
      left: Math.random() * 100,
      tx: Math.random() * 100 - 50,
      delay: Math.random() * 0.2,
      color: `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`,
    }));
  }, [open, version]);

  useEffect(() => {
    if (!open) {
      return;
    }
    buttonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <Box
      className="fillo-celebration"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fillo-celebration-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <Box className="fillo-celebration__confetti">
        {confettiPieces.map((piece) => (
          <Box
            key={piece.id}
            className="fillo-confetto"
            style={
              {
                left: `${piece.left}%`,
                animationDelay: `${piece.delay}s`,
                backgroundColor: piece.color,
                '--tx': `${piece.tx}px`,
              } as CSSProperties & { '--tx': string }
            }
          />
        ))}
      </Box>
      <Paper className="fillo-celebration__card" shadow="xl" radius="lg" p="xl">
        <Stack gap="sm" align="center">
          <Title id="fillo-celebration-title" order={3}>
            {title}
          </Title>
          <Text fz="sm" c="dimmed">
            {message}
          </Text>
          <Button
            ref={buttonRef}
            onClick={() => {
              onCta();
            }}
          >
            {ctaLabel}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
