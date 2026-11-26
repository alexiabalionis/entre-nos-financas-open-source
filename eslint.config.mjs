import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "data/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      // Um select só no app: o do design system (seta, foco, lista e
      // tamanhos iguais em toda tela). <select> cru vira um visual paralelo.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message:
            "Use o <Select> de app/ds/select.tsx em vez de <select> (size=\"sm\" para filtros).",
        },
      ],
    },
  },
  {
    files: ["app/ds/select.tsx"],
    rules: { "no-restricted-syntax": "off" },
  },
);
