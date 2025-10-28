import { createTheme } from '@mantine/core';

export const applyTheme = createTheme({
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  defaultRadius: 'md',
  headings: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  colors: {
    brand: [
      '#f7f3f2',
      '#e8e6e5',
      '#d2c9c6',
      '#bdaaa4',
      '#ab9087',
      '#a17f74',
      '#9d766a',
      '#896459',
      '#7b594e',
      '#5d4037',
    ],
  },
  primaryColor: 'brand',
});
