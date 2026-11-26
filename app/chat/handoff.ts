// Pergunta pronta de outra tela para a Judite (ex.: o Simular). Vai por
// sessionStorage, não pela URL, para os valores não ficarem no histórico do
// navegador. A Judite só preenche o campo: quem envia é a pessoa.
const KEY = "judite:pergunta";

export function handToJudite(question: string) {
  try {
    sessionStorage.setItem(KEY, question.slice(0, 600));
  } catch {
    // Sem storage (aba privada): abre a Judite vazia.
  }
}

export function takeJuditeQuestion(): string | null {
  try {
    const q = sessionStorage.getItem(KEY);
    if (q) sessionStorage.removeItem(KEY);
    return q;
  } catch {
    return null;
  }
}
