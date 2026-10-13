import {
  Baby,
  Bath,
  Brush,
  BrushCleaning,
  CookingPot,
  Droplets,
  Heart,
  House,
  LayoutGrid,
  Leaf,
  Package,
  ScrollText,
  Shirt,
  Sofa,
  Sparkles,
  SprayCan,
  Utensils,
  WashingMachine,
  Wind,
  type LucideIcon,
} from "lucide-react";

import type { CategoryIconKey } from "@/features/catalog/domain/category";

export const categoryIcons: Record<CategoryIconKey, LucideIcon> = {
  grid: LayoutGrid,
  "washing-machine": WashingMachine,
  "cooking-pot": CookingPot,
  bath: Bath,
  brush: Brush,
  house: House,
  "spray-can": SprayCan,
  sparkles: Sparkles,
  droplets: Droplets,
  shirt: Shirt,
  package: Package,
  leaf: Leaf,
  utensils: Utensils,
  sofa: Sofa,
  wind: Wind,
  "brush-cleaning": BrushCleaning,
  "scroll-text": ScrollText,
  heart: Heart,
  baby: Baby,
};

export function categoryIcon(key: string): LucideIcon {
  return categoryIcons[key as CategoryIconKey] ?? LayoutGrid;
}
