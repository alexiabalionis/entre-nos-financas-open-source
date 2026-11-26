"use client";
import {
  Button as DsButton,
  type ButtonProps as DsButtonProps,
} from "./ds/button.tsx";

/**
 * Repasse para o Button do design system (app/ds/button.tsx), para as telas
 * que importam daqui continuarem iguais. "default" é o nome antigo de
 * "secondary" (o contornado). Código novo importa de "./ds".
 */
export function Button({
  variant,
  ...rest
}: Omit<DsButtonProps, "variant"> & {
  variant?: DsButtonProps["variant"] | "default";
}) {
  return (
    <DsButton
      {...rest}
      variant={
        variant === "default" || variant === undefined ? "secondary" : variant
      }
    />
  );
}
