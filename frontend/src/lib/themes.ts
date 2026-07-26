export type PageTheme = 'cream' | 'sage' | 'terracotta' | 'slate' | 'blush';
export type AvatarTheme = 'green' | 'terracotta' | 'navy' | 'plum';

interface ThemeDef {
  name: string;
  swatch: string;
  accent: string;
  cardBg: string;
  cardBorder: string;
  pageBg: string;
}

export const PAGE_THEMES: Record<PageTheme, ThemeDef> = {
  cream: {
    name: 'Cream', swatch: 'linear-gradient(145deg,#F4ECDD,#E7DECF)', accent: '#B8431F',
    cardBg: 'linear-gradient(155deg,#FBF8F2,#F4ECDD)', cardBorder: '#EFE7DA', pageBg: '#F8F7F5',
  },
  sage: {
    name: 'Sage', swatch: 'linear-gradient(145deg,#DCEAE0,#B7D0BE)', accent: '#2C4131',
    cardBg: 'linear-gradient(155deg,#EBF2EC,#DCEAE0)', cardBorder: '#CFE0D3', pageBg: '#F1F6F2',
  },
  terracotta: {
    name: 'Terracotta', swatch: 'linear-gradient(145deg,#F6D8C4,#E8AE7E)', accent: '#8A4E15',
    cardBg: 'linear-gradient(155deg,#FBEADF,#F6D8C4)', cardBorder: '#F0C9AC', pageBg: '#FBF2E9',
  },
  slate: {
    name: 'Slate', swatch: 'linear-gradient(145deg,#DCE3EA,#B7C4D3)', accent: '#33465C',
    cardBg: 'linear-gradient(155deg,#EBEEF2,#DCE3EA)', cardBorder: '#C9D3DE', pageBg: '#EFF2F5',
  },
  blush: {
    name: 'Blush', swatch: 'linear-gradient(145deg,#F6D3DC,#E9AEBC)', accent: '#8A3B4E',
    cardBg: 'linear-gradient(155deg,#FBE8EC,#F6D3DC)', cardBorder: '#EFC0CB', pageBg: '#FBF0F2',
  },
};

export const AVATAR_THEMES: Record<AvatarTheme, { name: string; gradient: string }> = {
  green: { name: 'Sage green', gradient: 'linear-gradient(145deg,#3F5D46,#2C4131)' },
  terracotta: { name: 'Terracotta', gradient: 'linear-gradient(145deg,#D9542B,#B8431F)' },
  navy: { name: 'Navy', gradient: 'linear-gradient(145deg,#3B5B7A,#28405A)' },
  plum: { name: 'Plum', gradient: 'linear-gradient(145deg,#7A4B6E,#54314C)' },
};

/** The hero/kitchen card switches to light-on-dark text when a photo is behind it. */
export function heroTextColors(hasPhoto: boolean, theme: PageTheme) {
  if (hasPhoto) {
    return { eyebrow: '#FDEEDB', title: '#FFFFFF', bio: '#F0E9DD', stat: '#FFFFFF', statLabel: '#E3D6C4', dot: '#8A7A66' };
  }
  const t = PAGE_THEMES[theme];
  return { eyebrow: t.accent, title: '#241F1B', bio: '#5C5348', stat: '#241F1B', statLabel: '#948A7D', dot: '#D8CBB6' };
}
