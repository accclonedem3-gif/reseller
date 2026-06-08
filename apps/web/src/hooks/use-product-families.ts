import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { sourceProductFamilyOptions } from "@/lib/source-product-options";

export type FamilyOption = { value: string; label: string };

const STATIC_FALLBACK: FamilyOption[] = sourceProductFamilyOptions.map((o) => ({
  value: o.value,
  label: o.label,
}));

/**
 * Active product families for select dropdowns. Fetches the admin-managed list
 * from the API and falls back to the built-in static list while loading / on error,
 * so a dropdown is never empty.
 */
export function useProductFamilyOptions(): FamilyOption[] {
  const { data } = useQuery({
    queryKey: ["product-families"],
    queryFn: async (): Promise<FamilyOption[]> => {
      const res = await api.get("/product-families");
      return (res.data as Array<{ key: string; label: string }>).map((f) => ({
        value: f.key,
        label: f.label,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });

  return data && data.length > 0 ? data : STATIC_FALLBACK;
}
