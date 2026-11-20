export const COLOR_SCHEMES = [
  { name: 'default', label: 'Theme colors' },
  { name: 'hanami', label: 'Hanami' },
  { name: 'kimono', label: 'Kimono' },
  { name: 'ukiyo-e', label: 'Ukiyo-e' },
  { name: 'japandi', label: 'Japandi' },
  { name: 'edo', label: 'Edo' },
  { name: 'wabi-sabi', label: 'Wabi-sabi' },
] as const;

export type ColorScheme = typeof COLOR_SCHEMES[number]['name'];

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && COLOR_SCHEMES.some(scheme => scheme.name === value);
}
