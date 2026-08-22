export const CHARITY_SHARE_PERCENT = 10;

export const CHARITY_CAUSES = [
  { id: 'children', label: 'Children & Education', icon: '✦', description: 'Learning, safety, and opportunity for children.' },
  { id: 'animals', label: 'Animals & Wildlife', icon: '●', description: 'Animal welfare, rescue, and habitat protection.' },
  { id: 'climate', label: 'Climate & Environment', icon: '◒', description: 'Cleaner ecosystems and climate resilience.' },
  { id: 'relief', label: 'Hunger & Emergency Relief', icon: '+', description: 'Food security and rapid humanitarian support.' },
] as const;

export type CharityCause = typeof CHARITY_CAUSES[number]['id'];

export function isCharityCause(value: unknown): value is CharityCause {
  return typeof value === 'string' && CHARITY_CAUSES.some((cause) => cause.id === value);
}
