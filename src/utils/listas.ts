/**
 * Filtra uma lista de departamentos ou cargos vinda da API, mantendo só os
 * itens com `id` numérico e `nome` em texto, já ordenados por nome. Uma
 * resposta fora do contrato (proxy, versão errada do backend) não pode
 * derrubar a tela com "Cannot read properties of undefined".
 *
 * `valida` é false quando a resposta não é uma lista ou quando ela tinha
 * itens e nenhum era aproveitável: a tela mostra o erro com "Tentar novamente".
 */
export function itensComNome<T extends { id: number; nome: string }>(resposta: unknown): { itens: T[]; valida: boolean } {
  if (!Array.isArray(resposta)) return { itens: [], valida: false };
  const itens = resposta.filter(
    (item): item is T =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as T).id === 'number' &&
      typeof (item as T).nome === 'string' &&
      (item as T).nome.trim() !== ''
  );
  itens.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { itens, valida: resposta.length === 0 || itens.length > 0 };
}

/**
 * Salário base de um cargo, ou null se ele não veio como número positivo
 * (resposta fora do contrato). O cargo continua escolhível; só não há
 * sugestão de salário. Sem isso, `formatarValorEditavel(undefined)` quebrava
 * a tela com "Cannot read properties of undefined (reading 'toLocaleString')".
 */
export function salarioBaseDoCargo(cargo: { salarioBase?: unknown } | null | undefined): number | null {
  const valor = cargo?.salarioBase;
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : null;
}
