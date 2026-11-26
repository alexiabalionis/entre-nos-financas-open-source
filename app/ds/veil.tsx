/**
 * Texto ocultado ("ocultar valores") que mantém o tamanho do original: mostra
 * um preenchimento do mesmo comprimento, borrado, para a tela não mudar de
 * altura nem de largura. O texto real nunca vai para o DOM.
 */
export function Veil({ text, hidden }: { text: string; hidden: boolean }) {
  if (!hidden) return <>{text}</>;
  return (
    <>
      <span className="ds-veil" aria-hidden="true">
        {text.replace(/\S/g, "a")}
      </span>
      <span className="sr-only">Valor oculto</span>
    </>
  );
}
