import { useEffect, useRef, type RefObject } from 'react';
import { envioTerminouParaOSelecionado, focoPodeSerMovido } from '../../utils/foco';

/**
 * Durante um envio o botão fica desabilitado, e o navegador tira o foco dele:
 * quando a resposta chega, o foco está no BODY e quem usa teclado ou leitor de
 * tela perde o lugar (V5-01). Quando o envio termina e o foco se perdeu, este
 * hook foca o primeiro alvo que existir na tela (o aviso do resultado, por
 * exemplo, e na falta dele o próprio botão).
 *
 * Só age se:
 * - o foco estiver perdido: se a pessoa já foi para outro campo, ele fica lá;
 * - o envio que terminou for do colaborador que está na tela. Se terminou o
 *   de outro (V6-03), o resultado dele está no aviso global, que o leitor de
 *   tela anuncia sozinho; os alvos desta tela são do colaborador selecionado
 *   e mostram outra coisa, então o foco não é movido.
 *
 * `salvandoId` é o id em envio (ou null) e `selecionadoId` o da tela.
 */
export function useDevolverFocoAoTerminar(
  salvandoId: number | null,
  selecionadoId: number | null,
  alvos: ReadonlyArray<RefObject<HTMLElement | null>>
) {
  const anterior = useRef<number | null>(null);
  useEffect(() => {
    const terminou = anterior.current;
    anterior.current = salvandoId;
    if (!envioTerminouParaOSelecionado(terminou, salvandoId, selecionadoId)) return;
    if (!focoPodeSerMovido(document.activeElement, document.body)) return;
    const alvo = alvos.find((ref) => ref.current)?.current;
    alvo?.focus({ preventScroll: true });
    // Os alvos são refs (estáveis) e o selecionado é lido no momento em que o
    // envio termina: só a mudança de `salvandoId` importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salvandoId]);
}
