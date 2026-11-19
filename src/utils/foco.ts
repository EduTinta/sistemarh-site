// Decisões de foco das telas de formulário, separadas do React para serem
// testadas sem navegador.

/**
 * Se o foco pode ser movido pelo código: só quando está perdido (nulo ou no
 * BODY) ou num dos elementos permitidos (o botão de envio, ou o campo onde a
 * pessoa estava quando o erro apareceu). Se ela já foi para outro campo, o
 * foco fica lá, para nenhuma letra digitada se perder (V6-02).
 */
export function focoPodeSerMovido(
  ativo: Element | null,
  body: Element | null,
  permitidos: ReadonlyArray<Element | null | undefined> = []
): boolean {
  if (!ativo || ativo === body) return true;
  return permitidos.some((elemento) => !!elemento && elemento === ativo);
}

/**
 * Se o envio que acabou de terminar (`anterior` → `atual` = null) é do
 * colaborador que está na tela. Se for de outro, o resultado dele está no
 * aviso global e o foco não vai para o painel do selecionado (V6-03).
 */
export function envioTerminouParaOSelecionado(
  anterior: number | null,
  atual: number | null,
  selecionadoId: number | null
): boolean {
  return anterior !== null && atual === null && anterior === selecionadoId;
}
