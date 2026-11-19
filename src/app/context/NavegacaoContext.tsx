import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAvisos } from './AvisosContext';

export type ViewType =
  | 'dashboard'
  | 'organogram'
  | 'profile'
  | 'buscarColaborador'
  | 'newEmployee'
  | 'permissions'
  | 'salaryAdjustment'
  | 'mealVoucherAdjustment'
  | 'promotions'
  | 'solicitacoes'
  | 'mensagensRh';

// Cada tela tem um endereço depois do "#" (ex.: /#/organograma). Com isso o
// F5 reabre a mesma tela, Voltar/Avançar do navegador andam entre as telas do
// painel e dá para mandar o link de uma tela para alguém. O "#" não chega ao
// servidor, então o Caddy continua servindo só o index.html.
// O título é o mesmo do menu e do <h1> da tela; vai para a aba do navegador
// e para o rótulo do <main> (o que o leitor de tela anuncia).
const ROTAS: Record<ViewType, { caminho: string; titulo: string }> = {
  dashboard: { caminho: '/dashboard', titulo: 'Dashboard' },
  organogram: { caminho: '/organograma', titulo: 'Organograma' },
  profile: { caminho: '/meus-dados', titulo: 'Meus Dados' },
  buscarColaborador: { caminho: '/colaboradores/buscar', titulo: 'Buscar Colaborador' },
  newEmployee: { caminho: '/colaboradores/novo', titulo: 'Novo Colaborador' },
  salaryAdjustment: { caminho: '/colaboradores/ajuste-salarial', titulo: 'Ajuste Salarial' },
  mealVoucherAdjustment: { caminho: '/colaboradores/vale-alimentacao', titulo: 'Vale Alimentação' },
  promotions: { caminho: '/colaboradores/promocoes', titulo: 'Promoções' },
  // As duas abas de Solicitações têm o mesmo título; a aba ativa é anunciada
  // pelas próprias abas da tela (aria-current).
  solicitacoes: { caminho: '/solicitacoes', titulo: 'Solicitações' },
  mensagensRh: { caminho: '/solicitacoes/mensagens', titulo: 'Solicitações' },
  permissions: { caminho: '/permissoes', titulo: 'Permissões' },
};

const TELA_INICIAL: ViewType = 'dashboard';

/** Endereço da tela para usar em `<a href>`, ex.: "#/organograma". */
export function hrefDaTela(tela: ViewType): string {
  return `#${ROTAS[tela].caminho}`;
}

export function tituloDaTela(tela: ViewType): string {
  return ROTAS[tela].titulo;
}

/** Abas da mesma tela contam como uma tela só (Justificativas e Mensagens). */
export function telaBase(tela: ViewType): ViewType {
  return tela === 'mensagensRh' ? 'solicitacoes' : tela;
}

/** "#/organograma" → 'organogram'. Endereço vazio ou desconhecido → null. */
function telaDoHash(hash: string): ViewType | null {
  const caminho = hash.replace(/^#/, '').replace(/\/+$/, '').toLowerCase();
  const encontrada = (Object.keys(ROTAS) as ViewType[]).find((tela) => ROTAS[tela].caminho === caminho);
  return encontrada ?? null;
}

// Cada entrada do histórico criada pelo painel guarda a sua posição no
// `history.state`. Com ela dá para saber se um hashchange veio de Voltar ou de
// Avançar e, se a pessoa cancelar a saída, desfazer exatamente esse passo.
type EstadoHistorico = { indicePainel?: unknown } & Record<string, unknown>;

function indiceDaEntrada(): number | null {
  const estado = window.history.state as EstadoHistorico | null;
  return typeof estado?.indicePainel === 'number' ? estado.indicePainel : null;
}

function marcarEntrada(indice: number, href?: string) {
  const estado = (window.history.state ?? {}) as EstadoHistorico;
  window.history.replaceState({ ...estado, indicePainel: indice }, '', href);
}

interface NavegacaoContextValue {
  tela: ViewType;
  /** Vai para a tela. `substituir` troca o endereço atual sem criar uma entrada no histórico. */
  navegar: (tela: ViewType, opcoes?: { substituir?: boolean }) => void;
}

const NavegacaoContext = createContext<NavegacaoContextValue | undefined>(undefined);

export function NavegacaoProvider({ children }: { children: ReactNode }) {
  const [tela, setTela] = useState<ViewType>(() => telaDoHash(window.location.hash) ?? TELA_INICIAL);
  const { confirmarSaida } = useAvisos();
  // Cópia síncrona da tela atual, lida pelos listeners.
  const telaRef = useRef(tela);
  telaRef.current = tela;
  // Posição da entrada atual do histórico (ver EstadoHistorico).
  const indiceRef = useRef(0);
  // Endereço que a pessoa já aceitou deixar num clique de link: a pergunta
  // foi feita antes de o endereço mudar, e o hashchange não pergunta de novo.
  const saidaConfirmadaRef = useRef<string | null>(null);

  useEffect(() => {
    // A entrada atual mantém a posição que já tinha (F5) ou começa do zero.
    const inicial = indiceDaEntrada();
    indiceRef.current = inicial ?? 0;
    if (inicial === null) marcarEntrada(0);

    function sincronizar() {
      const destino = telaDoHash(window.location.hash);
      const proxima = destino ?? TELA_INICIAL;
      const indiceDestino = indiceDaEntrada();
      const jaConfirmada = saidaConfirmadaRef.current !== null && saidaConfirmadaRef.current === window.location.hash;
      saidaConfirmadaRef.current = null;

      // Voltar/Avançar (ou endereço digitado) saindo de uma tela com
      // alterações não salvas (useConfirmarSaida). Se a pessoa desistir,
      // desfaz só esse passo, sem reescrever nenhuma entrada: antes o
      // replaceState trocava a entrada de destino por uma cópia da tela
      // atual, e o Voltar seguinte pulava uma tela.
      if (!jaConfirmada && telaBase(proxima) !== telaBase(telaRef.current) && !confirmarSaida()) {
        if (indiceDestino === null) window.history.back();
        else window.history.go(indiceRef.current - indiceDestino);
        return;
      }

      if (indiceDestino === null) {
        // Entrada nova (link ou endereço digitado): ganha a próxima posição.
        // Endereço sem tela ou com uma tela que não existe vira o Dashboard.
        indiceRef.current += 1;
        marcarEntrada(indiceRef.current, destino === null ? hrefDaTela(TELA_INICIAL) : undefined);
      } else {
        indiceRef.current = indiceDestino;
        if (destino === null) window.history.replaceState(window.history.state, '', hrefDaTela(TELA_INICIAL));
      }
      setTela(proxima);
    }

    sincronizar();
    // Cliques nos links do menu, Voltar e Avançar mudam só o "#".
    window.addEventListener('hashchange', sincronizar);
    return () => window.removeEventListener('hashchange', sincronizar);
  }, [confirmarSaida]);

  // Links para outra tela (menu, abas, "Ver Meus Dados"): a confirmação vem
  // ANTES de o endereço mudar. Cancelando, nenhuma entrada nova entra no
  // histórico e o menu continua como estava. Fase de captura, para rodar
  // antes do onClick dos componentes.
  useEffect(() => {
    function aoClicar(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href^="#/"]') : null;
      if (!link || (link.target && link.target !== '_self')) return;
      const href = link.getAttribute('href') ?? '';
      if (href === window.location.hash) return;
      if (telaBase(telaDoHash(href) ?? TELA_INICIAL) === telaBase(telaRef.current)) return;
      if (!confirmarSaida()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      saidaConfirmadaRef.current = href;
    }
    document.addEventListener('click', aoClicar, true);
    return () => document.removeEventListener('click', aoClicar, true);
  }, [confirmarSaida]);

  const navegar = useCallback(
    (destino: ViewType, opcoes?: { substituir?: boolean }) => {
      const href = hrefDaTela(destino);
      if (opcoes?.substituir) {
        // Mantém o history.state (e a posição) da entrada.
        window.history.replaceState(window.history.state, '', href);
        setTela(destino);
        return;
      }
      if (window.location.hash === href) return;
      if (telaBase(destino) !== telaBase(telaRef.current) && !confirmarSaida()) return;
      saidaConfirmadaRef.current = href;
      // Dispara o hashchange, que atualiza a tela.
      window.location.hash = href;
    },
    [confirmarSaida]
  );

  return <NavegacaoContext.Provider value={{ tela, navegar }}>{children}</NavegacaoContext.Provider>;
}

export function useNavegacao(): NavegacaoContextValue {
  const context = useContext(NavegacaoContext);
  if (!context) {
    throw new Error('useNavegacao precisa ser usado dentro de um <NavegacaoProvider>.');
  }
  return context;
}
