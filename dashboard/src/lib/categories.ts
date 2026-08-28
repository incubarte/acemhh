// How a category reads on screen. The database stores the slug.

const LABELS: Record<string, string> = {
  "cat-a": "Categoría A",
  "cat-b": "Categoría B",
  "cat-c": "Categoría C",
  youth: "Juveniles",
};

export function categoryLabel(category: string): string {
  return LABELS[category] ?? category;
}
