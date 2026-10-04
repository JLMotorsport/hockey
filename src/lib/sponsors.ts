// Felixstowe HC sponsors (from felixstowehockeyclub.co.uk/d/sponsors.html).
// Logos are in public/sponsors. Lead sponsors come first and get the most
// board space.
export interface Sponsor {
  slug: string;
  name: string;
  tier: 'lead' | 'kit' | 'bar' | 'bronze' | 'supporter';
  url?: string;
}

export const SPONSORS: Sponsor[] = [
  {
    slug: 'diamond-mills',
    name: 'Diamond Mills',
    tier: 'lead',
    url: 'https://www.diamondmills.co.uk/',
  },
  {
    slug: 'bristow-holland',
    name: 'Bristow Holland',
    tier: 'lead',
    url: 'https://www.bristowholland.com/',
  },
  {
    slug: 'hutton',
    name: 'Hutton Construction',
    tier: 'lead',
    url: 'https://www.hutton-group.co.uk/construction/',
  },
  {
    slug: 'stc-teamwear',
    name: 'STC Teamwear',
    tier: 'kit',
    url: 'https://stc-stores.com/collections/felixstowe-hockey-club',
  },
  {
    slug: 'woodfordes',
    name: 'Woodforde’s Brewery',
    tier: 'bar',
    url: 'https://www.woodfordes.com',
  },
  { slug: 'toppesfield', name: 'Toppesfield', tier: 'bronze', url: 'https://www.toppesfield.com/' },
  { slug: 'hireco', name: 'Hireco', tier: 'bronze', url: 'https://hireco.co.uk' },
  {
    slug: 'mml-commercial',
    name: 'MML Commercial',
    tier: 'bronze',
    url: 'https://mmlcommercial.com',
  },
  {
    slug: 'foulgers',
    name: 'Foulgers (CVS) Ltd',
    tier: 'bronze',
    url: 'https://www.foulgersdaf.co.uk/',
  },
  { slug: 'tec41', name: 'TEC41', tier: 'bronze', url: 'https://tec41.com/' },
  { slug: 'trinity-tyres', name: 'Trinity Tyres', tier: 'bronze' },
  {
    slug: 'bevan-group',
    name: 'Bevan Group',
    tier: 'supporter',
    url: 'https://www.bevangroup.com',
  },
  { slug: 'sorrelle-transport', name: 'Sorrelle Transport', tier: 'supporter' },
  { slug: 'coes', name: 'COES', tier: 'supporter', url: 'https://www.coes.co.uk/' },
  {
    slug: 'felixstowe-town-council',
    name: 'Felixstowe Town Council',
    tier: 'supporter',
    url: 'https://felixstowe.gov.uk/',
  },
];

export const LEAD_SPONSORS = SPONSORS.filter((s) => s.tier === 'lead');
export const OTHER_SPONSORS = SPONSORS.filter((s) => s.tier !== 'lead');
