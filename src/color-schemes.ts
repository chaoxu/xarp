export const COLOR_SCHEMES = [
  { name: 'default', label: 'Theme colors', group: 'Core · Ink & Print' },
  { name: 'sumi-e', label: 'Sumi-e · 墨絵', group: 'Core · Ink & Print' },
  { name: 'shuimo', label: 'Shuǐmò · 白宣水墨', group: 'Core · Ink & Print' },
  { name: 'manga', label: 'Manga · 漫画', group: 'Core · Ink & Print' },
  { name: 'han-rubbing', label: 'Han Rubbing · 汉画像石拓', group: 'Core · Ink & Print' },
  { name: 'song-scroll', label: 'Song Scroll · 宣和装宋画', group: 'Core · Ink & Print' },
  { name: 'qinglu', label: 'Qīnglǜ · 千里江山', group: 'Core · Ink & Print' },
  { name: 'washi', label: 'Washi · 和紙', group: 'Japanese Craft' },
  { name: 'edo', label: 'Edo · 江戸紫', group: 'Japanese Craft' },
  { name: 'hanami', label: 'Hanami · 花見', group: 'Japanese Craft' },
  { name: 'kimono', label: 'Kimono · 着物', group: 'Japanese Craft' },
  { name: 'wabi-sabi', label: 'Wabi-sabi · 侘寂', group: 'Japanese Craft' },
  { name: 'japandi', label: 'Japandi', group: 'Japanese Craft' },
  { name: 'ukiyo-e', label: 'Ukiyo-e · 浮世絵', group: 'Japanese Craft' },
  { name: 'urushi', label: 'Urushi · 黒漆蒔絵', group: 'Japanese Craft' },
  { name: 'sahara', label: 'Sahara Rock · 撒哈拉岩画', group: 'World Art History' },
  { name: 'egypt', label: 'Egyptian Fresco · 埃及壁画', group: 'World Art History' },
  { name: 'maya', label: 'Maya Codex · 玛雅抄本', group: 'World Art History' },
  { name: 'mughal', label: 'Mughal Miniature · 莫卧儿细密画', group: 'World Art History' },
  { name: 'wayang', label: 'Wayang Kulit · 爪哇皮影', group: 'World Art History' },
  { name: 'starry', label: 'Starry Night · 星月夜', group: 'World Art History' },
  { name: 'scream', label: 'The Scream · 呐喊', group: 'World Art History' },
  { name: 'nitrate', label: 'Silent Nitrate · 1922 默片', group: 'World Art History' },
  { name: 'blueprint', label: 'Blueprint · 青写真', group: 'Analog & Digital' },
  { name: 'oscilloscope', label: 'Oscilloscope · 示波器荧光', group: 'Analog & Digital' },
  { name: 'pixel-8bit', label: '8-Bit Arcade · 红白机像素', group: 'Analog & Digital' },
  { name: 'win2000', label: 'Win2000 Desktop · 千禧桌面', group: 'Analog & Digital' },
  { name: 'vaporwave', label: 'Vaporwave · 蒸汽波磁带', group: 'Analog & Digital' },
  { name: 'code-art', label: 'Generative Code · 代码美学', group: 'Analog & Digital' },
] as const;

export type ColorScheme = typeof COLOR_SCHEMES[number]['name'];

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && COLOR_SCHEMES.some(scheme => scheme.name === value);
}
