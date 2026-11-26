/** Próximo índice para a tecla; null se a tecla não for de navegação. */
export function railKey(key: string, selected: number, count: number): number | null {
  let next: number;
  switch (key) {
    case "ArrowRight":
      next = selected + 1;
      break;
    case "ArrowLeft":
      next = selected - 1;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    case "PageDown":
      next = selected + 3;
      break;
    case "PageUp":
      next = selected - 3;
      break;
    default:
      return null;
  }
  return Math.max(0, Math.min(count - 1, next));
}
