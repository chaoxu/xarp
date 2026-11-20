export const COLOR_SCHEMES = [
  { name: 'default', label: 'Theme colors' },
  { name: 'shuimo', label: 'Shuǐmò · 水墨画' },
  { name: 'qinglu', label: 'Qīnglǜ · 千里江山' },
  { name: 'washi', label: 'Washi · 和紙' },
  { name: 'edo', label: 'Edo · 江戸紫' },
  { name: 'hanami', label: 'Hanami · 花見' },
  { name: 'kimono', label: 'Kimono · 着物' },
  { name: 'wabi-sabi', label: 'Wabi-sabi · 侘寂' },
  { name: 'japandi', label: 'Japandi' },
  { name: 'ukiyo-e', label: 'Ukiyo-e · 浮世絵' },
  { name: 'urushi', label: 'Urushi · 黒漆蒔絵' },
  { name: 'blueprint', label: 'Blueprint · 青写真' },
] as const;

export type ColorScheme = typeof COLOR_SCHEMES[number]['name'];

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && COLOR_SCHEMES.some(scheme => scheme.name === value);
}
