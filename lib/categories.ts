export const PROJECT_CATEGORIES = [
  'Developer Tools',
  'Productivity & Personal Tools',
  'People & Profiles',
  'Design & Creative',
  'Marketing & Advertising',
  'SEO & AI Visibility',
  'Social Media & Creator Tools',
  'Writing & Content',
  'Sales & Lead Generation',
  'Business, Finance & Legal',
  'Games & Entertainment',
  'Education & Learning',
  'Health, Fitness & Wellness',
  'Ecommerce & Retail',
  'Directories, Launch & Discovery',
  'Hiring, Jobs & Careers',
  'Audio, Voice & Podcasting',
  'Crypto, Web3 & Investing',
] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export function isProjectCategory(value: unknown): value is ProjectCategory {
  return typeof value === 'string' && PROJECT_CATEGORIES.some((category) => category === value);
}
