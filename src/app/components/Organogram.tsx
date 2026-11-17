import {
  Mail,
  Phone,
  X,
  Loader2,
  UserMinus,
  Smartphone,
  KeyRound,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Minus,
  Plus,
  Scan,
  Move,
  Users,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import '../styles/hr-system.css';
import { api, ApiError } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import type { FuncionarioDto } from '../../types/api';
import { StatusFuncionario } from '../../types/api';

interface NoOrganograma extends FuncionarioDto {
  subordinados: NoOrganograma[];
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 1).toUpperCase();
  return (partes[0].slice(0, 1) + partes[partes.length - 1].slice(0, 1)).toUpperCase();
}

/** Monta a árvore do organograma a partir da lista plana de funcionários,
 * usando `gerenteId` pra decidir quem fica embaixo de quem. Quem não tem
 * gestor vira raiz (pode haver mais de uma — ex. a cúpula e cadastros de
 * teste sem gestor definido ainda). */
function montarArvore(funcionarios: FuncionarioDto[]): NoOrganograma[] {
  const porId = new Map<number, NoOrganograma>(funcionarios.map((f) => [f.id, { ...f, subordinados: [] }]));
  const raizes: NoOrganograma[] = [];

  // Gestor desligado (fora da lista) ou o próprio funcionário como gestor:
  // o nó vira raiz e continua visível.
  for (const no of porId.values()) {
    const gestor = no.gerenteId !== null && no.gerenteId !== no.id ? porId.get(no.gerenteId) : undefined;
    if (gestor) {
      gestor.subordinados.push(no);
    } else {
      raizes.push(no);
    }
  }

  // Um ciclo de gestores (A → B → A) deixaria esses nós fora da árvore — e o
  // card desenha os subordinados recursivamente. Quem não for alcançável a
  // partir de uma raiz vira raiz também, separado do "gestor" do ciclo.
  const visitados = new Set<number>();
  const visitar = (no: NoOrganograma) => {
    if (visitados.has(no.id)) return;
    visitados.add(no.id);
    no.subordinados.forEach(visitar);
  };
  raizes.forEach(visitar);

  for (const no of porId.values()) {
    if (visitados.has(no.id)) continue;
    const gestor = no.gerenteId !== null ? porId.get(no.gerenteId) : undefined;
    if (gestor) gestor.subordinados = gestor.subordinados.filter((s) => s.id !== no.id);
    raizes.push(no);
    visitar(no);
  }

  return raizes;
}

function tamanhoEquipe(no: NoOrganograma): number {
  return no.subordinados.reduce((total, sub) => total + 1 + tamanhoEquipe(sub), 0);
}

/** Percorre a árvore inteira, com o nível de cada nó (0 = raiz). */
function percorrer(raizes: NoOrganograma[], visitar: (no: NoOrganograma, nivel: number) => void) {
  const descer = (no: NoOrganograma, nivel: number) => {
    visitar(no, nivel);
    no.subordinados.forEach((sub) => descer(sub, nivel + 1));
  };
  raizes.forEach((raiz) => descer(raiz, 0));
}

// Ao abrir a tela, os ramos até este nível já vêm expandidos (raiz e
// diretoria) — os demais mostram só o botão com a quantidade de subordinados.
const NIVEIS_ABERTOS = 2;

// Zoom do organograma: limites, passo dos botões e o mínimo em que o texto
// dos cards ainda é confortável de ler (usado pra decidir a visão inicial).
// O mínimo é baixo pra "Ajustar à tela" encaixar a árvore inteira até no
// celular — aí serve de mapa, e o zoom/arrasto levam até a parte desejada.
const ZOOM_MINIMO = 0.1;
const ZOOM_MAXIMO = 1.5;
const PASSO_ZOOM = 0.1;
const ZOOM_LEGIVEL = 0.8;
// Espaço livre em volta da árvore, dentro da área de visualização.
const MARGEM_AREA = 24;
// Quanto o mouse precisa andar pra virar "arrastar" em vez de clique.
const LIMIAR_ARRASTO = 5;

function limitarZoom(zoom: number): number {
  return Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, Math.round(zoom * 100) / 100));
}

// Ajuste de rolagem a aplicar logo depois que o React redesenhar a árvore:
// - "ponto": um ponto do conteúdo (em px sem zoom) volta pra mesma posição
//   da tela — usado no zoom, pra ampliar em volta do centro ou do mouse;
// - "card": o card clicado fica parado onde estava ao abrir/fechar um ramo;
// - "raiz": centraliza o topo da hierarquia (visão inicial e "ajustar").
type AjusteRolagem =
  | { tipo: 'ponto'; x: number; y: number; telaX: number; telaY: number }
  | { tipo: 'card'; id: number; telaX: number; telaY: number }
  | { tipo: 'raiz' };

function CardColaborador({
  funcionario,
  destaque,
  onAbrir,
}: {
  funcionario: NoOrganograma;
  destaque: boolean;
  onAbrir: () => void;
}) {
  return (
    <button
      type="button"
      data-no={funcionario.id}
      onClick={onAbrir}
      title={`${funcionario.nome} — ${funcionario.cargoNome}`}
      className="w-56 h-[72px] flex items-center gap-2.5 px-3 rounded-xl border border-gray-200 bg-white text-left shadow-sm cursor-pointer transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="relative shrink-0">
        <span
          className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${
            destaque ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground'
          }`}
        >
          {iniciais(funcionario.nome)}
        </span>
        {funcionario.possuiAcessoApp && (
          <span
            title="Tem acesso ao app"
            className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 text-white ring-2 ring-white flex items-center justify-center"
          >
            <Smartphone size={9} strokeWidth={2.5} />
            <span className="sr-only">Tem acesso ao app</span>
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px] font-semibold text-gray-800">{funcionario.nome}</span>
        <span className="block truncate mt-0.5 text-xs font-normal text-gray-600">{funcionario.cargoNome}</span>
        <span className="block truncate mt-0.5 text-[11px] font-normal text-gray-500">
          {funcionario.departamentoNome}
        </span>
      </span>
    </button>
  );
}

/** Um nó da árvore: o card, o botão de abrir/fechar o ramo e, se aberto, os
 * subordinados. As linhas entre gestor e subordinados vêm do CSS (.org-arvore). */
function NoArvore({
  no,
  abertos,
  idDestaque,
  onAbrir,
  onAlternar,
}: {
  no: NoOrganograma;
  abertos: Set<number>;
  idDestaque: number;
  onAbrir: (no: NoOrganograma) => void;
  onAlternar: (id: number) => void;
}) {
  const quantidade = no.subordinados.length;
  const aberto = quantidade > 0 && abertos.has(no.id);
  // Equipe em que ninguém tem subordinados fica em coluna, um card embaixo
  // do outro — em fileira, uma equipe grande esticaria a árvore pros lados.
  const emColuna = quantidade > 1 && no.subordinados.every((sub) => sub.subordinados.length === 0);
  const rotulo = `${aberto ? 'Recolher' : 'Mostrar'} ${quantidade} subordinado${quantidade > 1 ? 's' : ''} de ${no.nome}`;

  return (
    <li>
      <div className="relative">
        <CardColaborador funcionario={no} destaque={no.id === idDestaque} onAbrir={() => onAbrir(no)} />
        {quantidade > 0 && (
          <button
            type="button"
            onClick={() => onAlternar(no.id)}
            aria-expanded={aberto}
            aria-label={rotulo}
            title={rotulo}
            className={`absolute left-1/2 -translate-x-1/2 -bottom-3 z-10 h-6 min-w-6 px-1.5 inline-flex items-center justify-center gap-0.5 rounded-full border text-[11px] font-semibold leading-none shadow-sm cursor-pointer transition-colors ${
              aberto
                ? 'bg-white border-gray-300 text-gray-500 hover:border-primary hover:text-primary'
                : 'bg-primary border-primary text-primary-foreground hover:opacity-90'
            }`}
          >
            {quantidade}
            {aberto ? <ChevronUp size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />}
          </button>
        )}
      </div>

      {aberto && (
        <ul className={emColuna ? 'org-pilha' : 'org-ramo'}>
          {no.subordinados.map((sub) => (
            <NoArvore
              key={sub.id}
              no={sub}
              abertos={abertos}
              idDestaque={idDestaque}
              onAbrir={onAbrir}
              onAlternar={onAlternar}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const classeBotaoFerramenta =
  'h-8 inline-flex items-center justify-center gap-1.5 rounded-lg text-sm text-gray-600 cursor-pointer transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function BotaoFerramenta({
  rotulo,
  onClick,
  disabled,
  className = '',
  children,
}: {
  rotulo: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={rotulo}
      aria-label={rotulo}
      className={`${classeBotaoFerramenta} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Área de visualização do organograma: uma única região com rolagem (as
 * barras só aparecem quando a árvore não cabe), zoom e "arrastar para mover".
 * A roda do mouse rola normalmente (Shift + roda rola na horizontal) e
 * Ctrl + roda — ou o gesto de pinça no touchpad — muda o zoom. No celular,
 * o arrasto é a própria rolagem por toque do navegador.
 */
function VisualizacaoOrganograma({
  raizes,
  total,
  abertos,
  tudoAberto,
  onAlternar,
  onAlternarTudo,
  onAbrir,
}: {
  raizes: NoOrganograma[];
  total: number;
  abertos: Set<number>;
  tudoAberto: boolean;
  onAlternar: (id: number) => void;
  onAlternarTudo: () => void;
  onAbrir: (no: NoOrganograma) => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const conteudoRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const ajusteRef = useRef<AjusteRolagem | null>(null);

  const [principal, ...semGestor] = raizes;

  // --- Rolagem e zoom -------------------------------------------------------

  function centralizarNaRaiz() {
    const area = areaRef.current;
    const card = area?.querySelector<HTMLElement>(`[data-no="${principal.id}"]`);
    if (!area || !card) return;
    const a = area.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    area.scrollLeft += c.left + c.width / 2 - (a.left + area.clientWidth / 2);
    area.scrollTop = 0;
  }

  /** Maior zoom (até 100%) em que a árvore inteira cabe na área. */
  function zoomQueCabe(): number {
    const area = areaRef.current;
    const conteudo = conteudoRef.current;
    if (!area || !conteudo) return 1;
    const r = conteudo.getBoundingClientRect();
    const largura = r.width / zoomRef.current;
    const altura = r.height / zoomRef.current;
    const cabe = Math.min(
      (area.clientWidth - 2 * MARGEM_AREA) / largura,
      (area.clientHeight - 2 * MARGEM_AREA) / altura
    );
    return Math.max(ZOOM_MINIMO, Math.min(1, Math.floor(cabe * 100) / 100));
  }

  /** Muda o zoom mantendo parado o ponto da tela informado (padrão: o centro da área). */
  function mudarZoom(novo: number, telaX?: number, telaY?: number) {
    const area = areaRef.current;
    const conteudo = conteudoRef.current;
    const atual = zoomRef.current;
    const alvo = limitarZoom(novo);
    if (!area || !conteudo || alvo === atual) return;
    const a = area.getBoundingClientRect();
    const c = conteudo.getBoundingClientRect();
    const x = telaX ?? a.left + area.clientWidth / 2;
    const y = telaY ?? a.top + area.clientHeight / 2;
    ajusteRef.current = { tipo: 'ponto', x: (x - c.left) / atual, y: (y - c.top) / atual, telaX: x, telaY: y };
    setZoom(alvo);
  }

  function ajustarATela() {
    ajusteRef.current = { tipo: 'raiz' };
    const cabe = zoomQueCabe();
    if (cabe === zoomRef.current) centralizarNaRaiz();
    else setZoom(cabe);
  }

  // Abrir/fechar um ramo muda a largura da árvore e tudo se reacomoda; o
  // card clicado fica parado na tela pra pessoa não se perder.
  function fixarCard(id: number) {
    const card = areaRef.current?.querySelector<HTMLElement>(`[data-no="${id}"]`);
    if (!card) return;
    const c = card.getBoundingClientRect();
    ajusteRef.current = { tipo: 'card', id, telaX: c.left, telaY: c.top };
  }

  function alternarRamo(id: number) {
    fixarCard(id);
    onAlternar(id);
  }

  function alternarTudo() {
    fixarCard(principal.id);
    onAlternarTudo();
  }

  // Visão inicial: se a árvore inteira cabe com o texto legível, já abre
  // ajustada à tela; senão abre em 100% centralizada no topo da hierarquia.
  useLayoutEffect(() => {
    const cabe = zoomQueCabe();
    if (cabe < 1 && cabe >= ZOOM_LEGIVEL) {
      ajusteRef.current = { tipo: 'raiz' };
      setZoom(cabe);
    } else {
      centralizarNaRaiz();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aplica o ajuste pendente com a árvore já redesenhada (antes de pintar a
  // tela, então não há "pulo" visível).
  useLayoutEffect(() => {
    const ajuste = ajusteRef.current;
    const area = areaRef.current;
    ajusteRef.current = null;
    if (!ajuste || !area) return;

    if (ajuste.tipo === 'raiz') {
      centralizarNaRaiz();
    } else if (ajuste.tipo === 'ponto') {
      const c = conteudoRef.current?.getBoundingClientRect();
      if (!c) return;
      area.scrollLeft += c.left + ajuste.x * zoom - ajuste.telaX;
      area.scrollTop += c.top + ajuste.y * zoom - ajuste.telaY;
    } else {
      const card = area.querySelector<HTMLElement>(`[data-no="${ajuste.id}"]`);
      if (!card) return;
      const c = card.getBoundingClientRect();
      area.scrollLeft += c.left - ajuste.telaX;
      area.scrollTop += c.top - ajuste.telaY;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, abertos]);

  // Ctrl + roda (e a pinça do touchpad, que chega igual) dá zoom em volta do
  // mouse. Precisa de listener nativo não-passivo pra impedir o zoom da página.
  const mudarZoomRef = useRef(mudarZoom);
  mudarZoomRef.current = mudarZoom;
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const aoRolar = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      mudarZoomRef.current(zoomRef.current * Math.exp(-e.deltaY / 400), e.clientX, e.clientY);
    };
    area.addEventListener('wheel', aoRolar, { passive: false });
    return () => area.removeEventListener('wheel', aoRolar);
  }, []);

  // --- Arrastar para mover (mouse) ------------------------------------------

  const arrastoRef = useRef<{ id: number; x: number; y: number; left: number; top: number; movendo: boolean } | null>(
    null
  );
  // Fica true quando o gesto virou arrasto, pra engolir o clique que o
  // navegador dispara ao soltar o botão (senão abriria o card de baixo).
  const arrastouRef = useRef(false);
  const [arrastando, setArrastando] = useState(false);

  function aoPressionar(e: ReactPointerEvent<HTMLDivElement>) {
    arrastouRef.current = false;
    // Toque usa a rolagem nativa do navegador; aqui é só o botão esquerdo do mouse.
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const area = e.currentTarget;
    const r = area.getBoundingClientRect();
    // Clique em cima da barra de rolagem fica com o navegador.
    if (e.clientX - r.left >= area.clientWidth || e.clientY - r.top >= area.clientHeight) return;
    arrastoRef.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: area.scrollLeft,
      top: area.scrollTop,
      movendo: false,
    };
  }

  function encerrarArrasto() {
    arrastoRef.current = null;
    setArrastando(false);
  }

  function aoMover(e: ReactPointerEvent<HTMLDivElement>) {
    const arrasto = arrastoRef.current;
    if (!arrasto || arrasto.id !== e.pointerId) return;
    // Botão solto fora da janela: o pointerup não chegou aqui.
    if ((e.buttons & 1) === 0) {
      encerrarArrasto();
      return;
    }
    const dx = e.clientX - arrasto.x;
    const dy = e.clientY - arrasto.y;
    if (!arrasto.movendo) {
      if (Math.hypot(dx, dy) < LIMIAR_ARRASTO) return;
      arrasto.movendo = true;
      arrastouRef.current = true;
      setArrastando(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    e.currentTarget.scrollLeft = arrasto.left - dx;
    e.currentTarget.scrollTop = arrasto.top - dy;
  }

  function aoSoltar(e: ReactPointerEvent<HTMLDivElement>) {
    if (arrastoRef.current?.id === e.pointerId) encerrarArrasto();
  }

  function aoClicar(e: ReactMouseEvent<HTMLDivElement>) {
    if (!arrastouRef.current) return;
    arrastouRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  }

  const porcentagem = Math.round(zoom * 100);

  return (
    <div className="flex-1 min-h-[320px] flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Barra de ferramentas */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-2 sm:px-3 py-2 border-b border-gray-200">
        <div className="min-w-0 flex items-center gap-3 pl-1 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Users size={16} className="text-gray-400 shrink-0" />
            <span>
              <span className="font-semibold text-gray-800">{total}</span>
              <span className="hidden sm:inline"> colaborador{total === 1 ? '' : 'es'}</span>
            </span>
          </span>
          <span className="hidden lg:inline-flex items-center gap-1.5 text-xs text-gray-400 whitespace-nowrap">
            <Move size={14} />
            Arraste para navegar · Ctrl + roda para zoom
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <BotaoFerramenta
            rotulo={tudoAberto ? 'Recolher ramos' : 'Expandir todos os ramos'}
            onClick={alternarTudo}
            className="px-2"
          >
            {tudoAberto ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
            <span className="hidden md:inline">{tudoAberto ? 'Recolher' : 'Expandir tudo'}</span>
          </BotaoFerramenta>

          <div className="flex items-center rounded-lg border border-gray-200">
            <BotaoFerramenta
              rotulo="Diminuir zoom"
              onClick={() => mudarZoom(Math.round((zoom - PASSO_ZOOM) * 10) / 10)}
              disabled={zoom <= ZOOM_MINIMO}
              className="w-8 rounded-r-none"
            >
              <Minus size={16} />
            </BotaoFerramenta>
            <BotaoFerramenta
              rotulo="Voltar para 100%"
              onClick={() => mudarZoom(1)}
              className="w-12 rounded-none text-xs font-medium tabular-nums"
            >
              {porcentagem}%
            </BotaoFerramenta>
            <BotaoFerramenta
              rotulo="Aumentar zoom"
              onClick={() => mudarZoom(Math.round((zoom + PASSO_ZOOM) * 10) / 10)}
              disabled={zoom >= ZOOM_MAXIMO}
              className="w-8 rounded-l-none"
            >
              <Plus size={16} />
            </BotaoFerramenta>
          </div>

          <BotaoFerramenta rotulo="Ajustar à tela" onClick={ajustarATela} className="px-2">
            <Scan size={16} />
            <span className="hidden md:inline">Ajustar</span>
          </BotaoFerramenta>
        </div>
      </div>

      {/* Área da árvore: a única com rolagem nesta tela */}
      <div
        ref={areaRef}
        className={`org-area flex-1 min-h-0 ${arrastando ? 'arrastando' : ''}`}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={encerrarArrasto}
        onClickCapture={aoClicar}
      >
        {/* Ocupa no mínimo a área toda e centraliza a árvore quando ela é menor. */}
        <div className="min-w-full w-max flex flex-col items-center" style={{ padding: MARGEM_AREA }}>
          <div ref={conteudoRef} className="select-none flex flex-col items-center gap-14" style={{ zoom }}>
            <ul className="org-arvore" aria-label="Organograma">
              <NoArvore
                no={principal}
                abertos={abertos}
                idDestaque={principal.id}
                onAbrir={onAbrir}
                onAlternar={alternarRamo}
              />
            </ul>

            {semGestor.length > 0 && (
              <div className="flex flex-col items-center gap-5">
                <span className="px-3 py-1 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-500">
                  Sem gestor definido · {semGestor.length}
                </span>
                <ul className="org-arvore items-start" aria-label="Colaboradores sem gestor definido">
                  {semGestor.map((raiz) => (
                    <NoArvore
                      key={raiz.id}
                      no={raiz}
                      abertos={abertos}
                      idDestaque={principal.id}
                      onAbrir={onAbrir}
                      onAlternar={alternarRamo}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const TAMANHO_MINIMO_SENHA_APP = 6;

/** Modal com os dados do colaborador e as ações de RH (acesso ao app e desligamento). */
function DetalhesColaborador({
  funcionario,
  onFechar,
  onDesligado,
  onAcessoAppAlterado,
}: {
  funcionario: NoOrganograma;
  onFechar: () => void;
  onDesligado: () => void;
  onAcessoAppAlterado: () => void;
}) {
  const { token, isRhOuAdmin } = useAuth();
  const [desligando, setDesligando] = useState(false);
  const [erroDesligar, setErroDesligar] = useState<string | null>(null);

  const [editandoAcessoApp, setEditandoAcessoApp] = useState(false);
  const [senhaApp, setSenhaApp] = useState('');
  const [salvandoAcessoApp, setSalvandoAcessoApp] = useState(false);
  const [erroAcessoApp, setErroAcessoApp] = useState<string | null>(null);
  const [sucessoAcessoApp, setSucessoAcessoApp] = useState<string | null>(null);
  // Vale até a lista recarregada chegar com possuiAcessoApp atualizado.
  const [acessoAppCriado, setAcessoAppCriado] = useState(false);
  const possuiAcessoApp = funcionario.possuiAcessoApp || acessoAppCriado;

  async function handleSalvarAcessoApp(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (senhaApp.length < TAMANHO_MINIMO_SENHA_APP) {
      setErroAcessoApp(`A senha precisa ter pelo menos ${TAMANHO_MINIMO_SENHA_APP} caracteres.`);
      return;
    }

    const jaTinhaAcesso = possuiAcessoApp;
    setSalvandoAcessoApp(true);
    setErroAcessoApp(null);
    setSucessoAcessoApp(null);
    try {
      const atualizado = await api.definirAcessoApp(token, funcionario.id, senhaApp);
      setAcessoAppCriado(atualizado.possuiAcessoApp ?? true);
      setSucessoAcessoApp(
        jaTinhaAcesso
          ? 'Senha do app redefinida. Passe a nova senha para o colaborador.'
          : `Acesso criado. ${funcionario.nome} já pode entrar no app com ${atualizado.email ?? funcionario.email}.`
      );
      setEditandoAcessoApp(false);
      setSenhaApp('');
      onAcessoAppAlterado();
    } catch (erro) {
      setErroAcessoApp(erro instanceof ApiError ? erro.message : 'Não foi possível definir o acesso ao app.');
    } finally {
      setSalvandoAcessoApp(false);
    }
  }

  async function handleDesligar() {
    if (!token) return;

    const temSubordinados = funcionario.subordinados.length > 0;
    const aviso = temSubordinados
      ? `Desligar ${funcionario.nome}? Os ${funcionario.subordinados.length} colaborador(es) que reportam a ela(e) passam a reportar direto ao gestor dela(e).`
      : `Desligar ${funcionario.nome}? Essa ação não pode ser desfeita pelo site.`;
    if (!window.confirm(aviso)) return;

    setDesligando(true);
    setErroDesligar(null);
    try {
      // Antes de desligar, sobe os subordinados diretos um nível na
      // hierarquia (pro gestor de quem está saindo) — sem isso eles ficariam
      // "perdidos", apontando pra um gestor desligado que some da árvore.
      for (const sub of funcionario.subordinados) {
        await api.atualizarFuncionario(token, sub.id, {
          nome: sub.nome,
          email: sub.email ?? undefined,
          telefone: sub.telefone ?? undefined,
          dataNascimento: sub.dataNascimento ?? undefined,
          departamentoId: sub.departamentoId,
          cargoId: sub.cargoId,
          gerenteId: funcionario.gerenteId,
        });
      }

      await api.desligarFuncionario(token, funcionario.id);
      onDesligado();
    } catch (e) {
      setErroDesligar(e instanceof ApiError ? e.message : 'Não foi possível desligar o colaborador.');
    } finally {
      setDesligando(false);
    }
  }

  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal-conteudo" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5 gap-3">
          <h2 className="m-0 text-xl sm:text-2xl text-gray-800 font-semibold break-words flex-1 min-w-0">
            {funcionario.nome}
          </h2>
          <button className="botao-fechar shrink-0" onClick={onFechar} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className="text-center mb-5">
          <div
            className="avatar-funcionario"
            style={{
              backgroundColor: 'var(--primary)',
              width: '80px',
              height: '80px',
              fontSize: '24px',
              margin: '0 auto 10px',
            }}
          >
            {iniciais(funcionario.nome)}
          </div>
          <span className="inline-block bg-gray-200 px-4 py-1 rounded-full text-sm">{funcionario.cargoNome}</span>
        </div>

        <div>
          <div className="linha-info">
            <span className="flex items-center gap-2 text-gray-500">
              <Mail size={16} />
              Email
            </span>
            <span className="text-gray-800 font-medium break-all">{funcionario.email ?? '—'}</span>
          </div>
          <div className="linha-info">
            <span className="flex items-center gap-2 text-gray-500">
              <Phone size={16} />
              Telefone
            </span>
            <span className="text-gray-800 font-medium">{funcionario.telefone ?? '—'}</span>
          </div>
          <div className="linha-info">
            <span className="text-gray-500">Departamento</span>
            <span className="text-gray-800 font-medium">{funcionario.departamentoNome}</span>
          </div>
          <div className="linha-info">
            <span className="flex items-center gap-2 text-gray-500">
              <Smartphone size={16} />
              Acesso ao app
            </span>
            <span className={`font-medium ${possuiAcessoApp ? 'text-green-600' : 'text-gray-800'}`}>
              {possuiAcessoApp ? 'Sim' : 'Não'}
            </span>
          </div>
        </div>

        {isRhOuAdmin && (
          <div className="mt-5 pt-4 border-t border-gray-200">
            {sucessoAcessoApp && (
              <p className="m-0 mb-3 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                {sucessoAcessoApp}
              </p>
            )}
            {erroAcessoApp && <p className="text-red-600 text-sm mb-3">{erroAcessoApp}</p>}

            {!funcionario.email ? (
              <p className="m-0 mb-3 text-sm text-gray-500">
                Cadastre um e-mail para este colaborador antes de criar o acesso ao app.
              </p>
            ) : editandoAcessoApp ? (
              <form onSubmit={handleSalvarAcessoApp} className="mb-3 space-y-2">
                <label htmlFor={`senha-app-${funcionario.id}`} className="block text-sm text-gray-600">
                  {possuiAcessoApp ? 'Nova senha do app' : 'Senha de acesso ao app'}
                </label>
                <input
                  id={`senha-app-${funcionario.id}`}
                  type="password"
                  value={senhaApp}
                  onChange={(e) => setSenhaApp(e.target.value)}
                  minLength={TAMANHO_MINIMO_SENHA_APP}
                  required
                  autoFocus
                  autoComplete="new-password"
                  placeholder="Mínimo de 6 caracteres"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="submit"
                    disabled={salvandoAcessoApp}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
                  >
                    {salvandoAcessoApp ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditandoAcessoApp(false);
                      setSenhaApp('');
                      setErroAcessoApp(null);
                    }}
                    className="flex-1 px-4 py-2 rounded-lg bg-accent text-accent-foreground hover:bg-accent/80 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => {
                  setEditandoAcessoApp(true);
                  setErroAcessoApp(null);
                  setSucessoAcessoApp(null);
                }}
                className="w-full mb-3 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-primary/40 text-primary hover:bg-primary/5 transition-colors"
              >
                <KeyRound size={16} />
                {possuiAcessoApp ? 'Redefinir senha do app' : 'Criar acesso ao app'}
              </button>
            )}

            {erroDesligar && <p className="text-red-600 text-sm mb-3">{erroDesligar}</p>}
            <button
              onClick={handleDesligar}
              disabled={desligando}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
            >
              {desligando ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
              Desligar colaborador
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Organogram() {
  const { token } = useAuth();
  const [funcionarios, setFuncionarios] = useState<FuncionarioDto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // `silencioso` recarrega sem trocar a árvore pelo spinner — assim o modal
  // aberto (ex. depois de criar o acesso ao app) continua na tela.
  async function carregar(silencioso = false) {
    if (!token) return;
    if (!silencioso) {
      setCarregando(true);
      setErro(null);
    }
    try {
      const lista = await api.listarFuncionarios(token);
      setFuncionarios(lista.filter((f) => f.status === StatusFuncionario.Ativo));
    } catch (e) {
      if (silencioso) return;
      setErro(
        e instanceof ApiError && e.status === 403
          ? 'Só RH/Admin pode ver o organograma completo.'
          : e instanceof ApiError
            ? e.message
            : 'Não foi possível carregar o organograma.'
      );
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // A raiz com a maior equipe (o topo da hierarquia) vem primeiro; as outras
  // são quem ficou sem gestor (cadastro incompleto, gestor desligado, ciclo).
  const raizes = useMemo(
    () => [...montarArvore(funcionarios)].sort((a, b) => tamanhoEquipe(b) - tamanhoEquipe(a)),
    [funcionarios]
  );

  const { porId, padraoAbertos, comSubordinados } = useMemo(() => {
    const porId = new Map<number, NoOrganograma>();
    const padraoAbertos = new Set<number>();
    const comSubordinados: number[] = [];
    percorrer(raizes, (no, nivel) => {
      porId.set(no.id, no);
      if (no.subordinados.length === 0) return;
      comSubordinados.push(no.id);
      if (nivel < NIVEIS_ABERTOS) padraoAbertos.add(no.id);
    });
    return { porId, padraoAbertos, comSubordinados };
  }, [raizes]);

  // null = ramos no padrão (primeiros níveis abertos); vira um conjunto
  // próprio assim que a pessoa abre ou fecha algum ramo.
  const [abertosEscolhidos, setAbertosEscolhidos] = useState<Set<number> | null>(null);
  const abertos = abertosEscolhidos ?? padraoAbertos;
  const tudoAberto = comSubordinados.every((id) => abertos.has(id));

  function alternarRamo(id: number) {
    const proximo = new Set(abertos);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    setAbertosEscolhidos(proximo);
  }

  function alternarTudo() {
    setAbertosEscolhidos(tudoAberto ? null : new Set(comSubordinados));
  }

  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const selecionado = selecionadoId !== null ? porId.get(selecionadoId) : undefined;

  return (
    // Ocupa a altura do <main>: a área da árvore fica com a altura que sobra
    // na janela e é a única parte que rola — a página em si fica parada.
    <div className="w-full h-full flex flex-col">
      <div className="mb-4 sm:mb-6 shrink-0">
        <h1 className="m-0 text-2xl sm:text-3xl lg:text-[32px] text-gray-800 font-semibold">Organograma</h1>
        <p className="mt-1 text-sm sm:text-base text-gray-500">Estrutura organizacional da empresa</p>
      </div>

      {carregando && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Carregando organograma…
        </div>
      )}

      {erro && !carregando && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">{erro}</div>
      )}

      {!carregando && !erro && raizes.length === 0 && (
        <p className="text-muted-foreground">Nenhum funcionário cadastrado ainda.</p>
      )}

      {!carregando && !erro && raizes.length > 0 && (
        <VisualizacaoOrganograma
          raizes={raizes}
          total={funcionarios.length}
          abertos={abertos}
          tudoAberto={tudoAberto}
          onAlternar={alternarRamo}
          onAlternarTudo={alternarTudo}
          onAbrir={(no) => setSelecionadoId(no.id)}
        />
      )}

      {selecionado && (
        <DetalhesColaborador
          key={selecionado.id}
          funcionario={selecionado}
          onFechar={() => setSelecionadoId(null)}
          onDesligado={() => {
            setSelecionadoId(null);
            carregar();
          }}
          onAcessoAppAlterado={() => carregar(true)}
        />
      )}
    </div>
  );
}
