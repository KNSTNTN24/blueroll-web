export const EU_ALLERGENS = ["gluten","crustaceans","eggs","fish","peanuts","soybeans",
  "milk","nuts","celery","mustard","sesame","sulphites","lupin","molluscs"] as const;
const ALIASES: Record<string,string> = {
  "soya":"soybeans","soy":"soybeans","soybean":"soybeans","tree nuts":"nuts","tree nut":"nuts","nut":"nuts",
  "sulphite":"sulphites","sulphur dioxide":"sulphites","sulphur dioxide/sulphites":"sulphites",
  "cereals containing gluten":"gluten","cereals/gluten":"gluten","gluten (cereals)":"gluten","crustacean":"crustaceans",
  "mollusc":"molluscs","egg":"eggs","peanut":"peanuts",
};
export function normalizeAllergens(labels: string[]): string[] {
  const set = new Set<string>();
  for (const raw of labels ?? []) {
    const k = String(raw).trim().toLowerCase();
    const mapped = (EU_ALLERGENS as readonly string[]).includes(k) ? k : ALIASES[k];
    if (mapped) set.add(mapped);
  }
  return EU_ALLERGENS.filter((a) => set.has(a));
}
