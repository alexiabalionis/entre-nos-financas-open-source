// Nome exibido de um movimento: o apelido do lançamento, depois o apelido do
// destinatário ou lugar (merchant_aliases), senão a descrição.
// Só para exibição e busca; regras de categoria e recorrência seguem na descrição.
export function eventName(e: {
  display_name?: string | null;
  alias_name?: string | null;
  description: string;
}): string {
  const nick = e.display_name?.trim();
  if (nick) return nick;
  const alias = e.alias_name?.trim();
  return alias ? alias : e.description;
}
