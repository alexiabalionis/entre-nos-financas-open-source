"use client";
import { Segmented } from "../ds/segmented.tsx";

// Escolha única do Panorama (período, ordem, aba): adapta a lista de pares
// [valor, rótulo] ao Segmented do design system.
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="ins-chips">
      <Segmented
        size="sm"
        label={label}
        value={value}
        options={options.map(([v, text]) => ({ value: v, label: text }))}
        onChange={onChange}
      />
    </div>
  );
}
