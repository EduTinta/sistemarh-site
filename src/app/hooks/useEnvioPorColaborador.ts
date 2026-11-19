import { useCallback, useRef, useState } from 'react';
import { useAvisos } from '../context/AvisosContext';
import { useMontado } from './useMontado';
import { marcarEnvioEmAndamento } from './envioEmAndamento';

export interface ResultadoEnvio {
  tipo: 'sucesso' | 'erro';
  mensagem: string;
}

/**
 * Estado de envio das telas de remuneração (Ajuste Salarial, Vale e
 * Promoções), onde a pessoa escolhe um colaborador numa lista e pode trocar
 * de colaborador enquanto o envio anterior ainda não respondeu.
 *
 * - O resultado do último envio fica guardado POR colaborador (um mapa por
 *   id) e volta a aparecer quando ele é selecionado de novo. Antes ele era
 *   apagado na troca, e um 409 de quem saiu da tela nunca era visto (RT4-01).
 * - `salvandoId` diz quem está sendo salvo, para a lista mostrar o indicador
 *   na linha certa.
 * - Se a resposta chega com outro colaborador na tela, ou depois que a pessoa
 *   saiu da tela, o resultado também vai para o aviso global.
 * - A trava é síncrona (ref): dois cliques no mesmo instante enviam um só.
 * - Enquanto o envio não responde, F5 ou fechar a aba pedem confirmação.
 */
export function useEnvioPorColaborador(selecionadoId: number | null) {
  const { avisarGlobal } = useAvisos();
  const montado = useMontado();
  const [resultados, setResultados] = useState<Record<number, ResultadoEnvio>>({});
  const [salvandoId, setSalvandoId] = useState<number | null>(null);
  const salvandoRef = useRef(false);
  // Libera o aviso de F5/fechar a aba quando o envio termina.
  const liberarSaidaRef = useRef<(() => void) | null>(null);
  const selecionadoIdRef = useRef(selecionadoId);
  selecionadoIdRef.current = selecionadoId;

  const resultadoAtual = selecionadoId !== null ? resultados[selecionadoId] ?? null : null;

  const registrar = useCallback((funcionarioId: number, resultado: ResultadoEnvio | null) => {
    setResultados((prev) => {
      const proximo = { ...prev };
      if (resultado) proximo[funcionarioId] = resultado;
      else delete proximo[funcionarioId];
      return proximo;
    });
  }, []);

  /** Apaga o resultado guardado de um colaborador (ex.: o erro de um envio anterior que já não vale). */
  const limparResultado = useCallback((funcionarioId: number) => registrar(funcionarioId, null), [registrar]);

  /** Erro de validação, antes de enviar: fica só no painel do colaborador. */
  const erroDeValidacao = useCallback(
    (funcionarioId: number, mensagem: string) => registrar(funcionarioId, { tipo: 'erro', mensagem }),
    [registrar]
  );

  /** Começa um envio. Devolve false se já houver outro em andamento. */
  const iniciar = useCallback(
    (funcionarioId: number): boolean => {
      if (salvandoRef.current) return false;
      salvandoRef.current = true;
      liberarSaidaRef.current = marcarEnvioEmAndamento();
      setSalvandoId(funcionarioId);
      // Uma nova ação apaga o resultado anterior desse colaborador.
      registrar(funcionarioId, null);
      return true;
    },
    [registrar]
  );

  /**
   * Guarda o resultado do envio. `mensagemGlobal` é o texto do aviso global,
   * que precisa dizer de quem é o resultado (a pessoa pode estar vendo outra tela).
   */
  const concluir = useCallback(
    (funcionarioId: number, resultado: ResultadoEnvio, mensagemGlobal: string = resultado.mensagem) => {
      if (!montado.current) {
        avisarGlobal(mensagemGlobal, resultado.tipo);
        return;
      }
      registrar(funcionarioId, resultado);
      if (selecionadoIdRef.current !== funcionarioId) avisarGlobal(mensagemGlobal, resultado.tipo);
    },
    [avisarGlobal, montado, registrar]
  );

  /** Libera a trava (no `finally` do envio). */
  const encerrar = useCallback(() => {
    salvandoRef.current = false;
    liberarSaidaRef.current?.();
    liberarSaidaRef.current = null;
    if (montado.current) setSalvandoId(null);
  }, [montado]);

  /** Se o colaborador ainda é o que está na tela (para não apagar o que foi digitado para outro). */
  const aindaSelecionado = useCallback((funcionarioId: number) => selecionadoIdRef.current === funcionarioId, []);

  return {
    resultadoAtual,
    salvandoId,
    salvando: salvandoId !== null,
    erroDeValidacao,
    limparResultado,
    iniciar,
    concluir,
    encerrar,
    aindaSelecionado,
  };
}
