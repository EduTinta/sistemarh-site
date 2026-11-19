import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

export type TipoAviso = 'sucesso' | 'erro' | 'info';

interface Aviso {
  id: number;
  mensagem: string;
  tipo: TipoAviso;
  criadoEm: number;
}

// Quanto tempo cada aviso fica na tela antes de sumir sozinho. Erro fica
// mais, para dar tempo de ler.
const DURACAO_MS: Record<TipoAviso, number> = { sucesso: 6000, info: 6000, erro: 10000 };
// Mais que isso empilhado só atrapalha: os mais antigos saem.
const MAXIMO_NA_TELA = 4;
// Clique ou tecla na página fecham os avisos que já estavam na tela há mais
// que isso. O intervalo evita que o próprio clique que gerou o aviso (ou o
// seguinte, colado nele) o feche antes de a pessoa ver.
const CARENCIA_FECHAR_MS = 300;

export const MENSAGEM_SAIDA_PADRAO = 'Há alterações que ainda não foram salvas nesta tela. Sair e descartar?';

interface AvisosContextValue {
  avisos: Aviso[];
  /** Aviso global (toast), visível em qualquer tela; some sozinho. */
  avisarGlobal: (mensagem: string, tipo?: TipoAviso) => void;
  fecharAviso: (id: number) => void;
  /**
   * Pergunta antes de sair de uma tela com alterações não salvas. Devolve
   * true se não há nada pendente ou se a pessoa confirmou.
   */
  confirmarSaida: () => boolean;
  registrarSaidaPendente: (id: symbol, mensagem: string | null) => void;
}

const AvisosContext = createContext<AvisosContextValue | undefined>(undefined);

export function AvisosProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const proximoIdRef = useRef(1);
  const temporizadoresRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // Telas com alterações não salvas, cada uma com a sua pergunta.
  const pendentesRef = useRef(new Map<symbol, string>());

  const fecharAviso = useCallback((id: number) => {
    const temporizador = temporizadoresRef.current.get(id);
    if (temporizador) clearTimeout(temporizador);
    temporizadoresRef.current.delete(id);
    setAvisos((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const avisarGlobal = useCallback(
    (mensagem: string, tipo: TipoAviso = 'info') => {
      const id = proximoIdRef.current++;
      setAvisos((prev) => [...prev, { id, mensagem, tipo, criadoEm: Date.now() }].slice(-MAXIMO_NA_TELA));
      temporizadoresRef.current.set(
        id,
        setTimeout(() => fecharAviso(id), DURACAO_MS[tipo])
      );
    },
    [fecharAviso]
  );

  useEffect(() => {
    const temporizadores = temporizadoresRef.current;
    return () => temporizadores.forEach((t) => clearTimeout(t));
  }, []);

  // O aviso fica no alto da tela e pode cobrir campos do formulário. Assim
  // que a pessoa volta a mexer na página (clique fora do X ou qualquer
  // tecla), ele sai, em vez de ficar 6 a 10 s em cima do que ela vai usar.
  const temAvisos = avisos.length > 0;
  const avisosRef = useRef(avisos);
  avisosRef.current = avisos;
  useEffect(() => {
    if (!temAvisos) return;
    function fecharOsAntigos(e: Event) {
      if (e.target instanceof Element && e.target.closest('[data-fechar-aviso]')) return;
      const limite = Date.now() - CARENCIA_FECHAR_MS;
      avisosRef.current.filter((a) => a.criadoEm <= limite).forEach((a) => fecharAviso(a.id));
    }
    document.addEventListener('pointerdown', fecharOsAntigos, true);
    document.addEventListener('keydown', fecharOsAntigos, true);
    return () => {
      document.removeEventListener('pointerdown', fecharOsAntigos, true);
      document.removeEventListener('keydown', fecharOsAntigos, true);
    };
  }, [temAvisos, fecharAviso]);

  const registrarSaidaPendente = useCallback((id: symbol, mensagem: string | null) => {
    if (mensagem === null) pendentesRef.current.delete(id);
    else pendentesRef.current.set(id, mensagem);
  }, []);

  const confirmarSaida = useCallback(() => {
    const [mensagem] = pendentesRef.current.values();
    if (mensagem === undefined) return true;
    return window.confirm(mensagem);
  }, []);

  // F5, fechar a aba ou sair do site com um formulário pela metade: o
  // navegador mostra a pergunta padrão dele (o texto não pode ser trocado).
  useEffect(() => {
    function antesDeSair(e: BeforeUnloadEvent) {
      if (pendentesRef.current.size === 0) return;
      e.preventDefault();
      // Navegadores mais antigos só perguntam com o returnValue preenchido.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', antesDeSair);
    return () => window.removeEventListener('beforeunload', antesDeSair);
  }, []);

  const value = useMemo(
    () => ({ avisos, avisarGlobal, fecharAviso, confirmarSaida, registrarSaidaPendente }),
    [avisos, avisarGlobal, fecharAviso, confirmarSaida, registrarSaidaPendente]
  );

  return <AvisosContext.Provider value={value}>{children}</AvisosContext.Provider>;
}

function useAvisosContext(): AvisosContextValue {
  const context = useContext(AvisosContext);
  if (!context) {
    throw new Error('useAvisos precisa ser usado dentro de um <AvisosProvider>.');
  }
  return context;
}

/** `avisarGlobal(mensagem, tipo)` e `confirmarSaida()` para as telas. */
export function useAvisos() {
  const { avisarGlobal, confirmarSaida } = useAvisosContext();
  return { avisarGlobal, confirmarSaida };
}

/**
 * Enquanto `sujo` for true, sair da tela (menu, Voltar, link, Sair) pede
 * confirmação, e F5 ou fechar a aba mostram o aviso do navegador. Quando a
 * tela desmonta, o pedido sai junto.
 */
export function useConfirmarSaida(sujo: boolean, mensagem: string = MENSAGEM_SAIDA_PADRAO) {
  const { registrarSaidaPendente } = useAvisosContext();
  const [id] = useState(() => Symbol('saida-pendente'));

  useEffect(() => {
    registrarSaidaPendente(id, sujo ? mensagem : null);
    return () => registrarSaidaPendente(id, null);
  }, [id, sujo, mensagem, registrarSaidaPendente]);
}

/**
 * Leva o foco para o elemento com esse id depois do próximo render, quando os
 * controles desabilitados durante um envio já voltaram ao normal. Um botão ou
 * campo desabilitado perde o foco para o BODY, e chamar `focus()` nele antes
 * de reabilitar não faz nada: quem usa teclado ou leitor de tela ficava fora
 * do formulário depois do erro ou do sucesso. Não tira o foco de onde a
 * pessoa já foi por conta própria.
 */
export function useFocoAposEnvio(): (id: string) => void {
  const [alvo, setAlvo] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (!alvo) return;
    const ativo = document.activeElement;
    if (!ativo || ativo === document.body) document.getElementById(alvo.id)?.focus();
  }, [alvo]);
  return useCallback((id: string) => setAlvo({ id }), []);
}

const ESTILO_AVISO: Record<TipoAviso, string> = {
  sucesso: 'bg-green-50 border-green-300 text-green-800',
  erro: 'bg-red-50 border-red-300 text-red-700',
  info: 'bg-white border-gray-300 text-gray-800',
};

/**
 * Onde os avisos globais aparecem. A região fica sempre no DOM, mesmo vazia,
 * para o leitor de tela anunciar o que entrar nela.
 *
 * Fica no alto (no celular, logo abaixo da barra com o menu; no desktop, no
 * canto de cima à direita): embaixo ela cobria o botão principal das telas
 * ("Aplicar", "Cadastrar"), que fica no fim do formulário. Só o X recebe
 * clique: um clique em cima do aviso chega ao campo que está embaixo dele (e
 * o aviso fecha, ver AvisosProvider).
 */
export function AreaAvisos() {
  const { avisos, fecharAviso } = useAvisosContext();

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[200] top-[72px] left-3 right-3 sm:left-auto sm:right-4 sm:w-96 lg:top-4 lg:right-6 flex flex-col gap-1.5 sm:gap-2 pointer-events-none"
    >
      {avisos.map((aviso) => (
        <div
          key={aviso.id}
          // No celular, mais baixo e com menos respiro: cobre menos do formulário.
          className={`flex items-start gap-2 sm:gap-3 px-3 py-2 sm:px-4 sm:py-3 rounded-lg border shadow-lg text-[13px] leading-snug sm:text-sm ${ESTILO_AVISO[aviso.tipo]}`}
        >
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{aviso.mensagem}</span>
          <button
            type="button"
            data-fechar-aviso
            onClick={() => fecharAviso(aviso.id)}
            className="pointer-events-auto shrink-0 -m-1 p-1 rounded hover:bg-black/5"
            aria-label="Fechar aviso"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
