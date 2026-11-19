import { Mail, Phone, X, Loader2, UserMinus, Smartphone, KeyRound } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import '../styles/hr-system.css';
import { api, ApiError, ehConflito } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import { useAvisos } from '../context/AvisosContext';
import type { DesligamentoResultadoDto, FuncionarioDto } from '../../types/api';
import { StatusFuncionario } from '../../types/api';
import { contarColaboradores, iniciais, normalizarBusca } from '../../utils/funcionarios';
import { dataIso } from '../../utils/datas';
import { SENHA_APP_MAXIMO, SENHA_APP_MINIMO, validarSenhaApp } from '../../utils/validacao';

interface NoOrganograma extends FuncionarioDto {
  subordinados: NoOrganograma[];
}

const MENSAGEM_RESPOSTA_INESPERADA = 'O servidor devolveu uma resposta inesperada. Tente novamente.';

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

  const visitados = new Set<number>();
  const visitar = (no: NoOrganograma) => {
    if (visitados.has(no.id)) return;
    visitados.add(no.id);
    no.subordinados.forEach(visitar);
  };
  raizes.forEach(visitar);

  // Quem sobrou está num ciclo de gestores (A → B → A) ou pendurado em alguém
  // de um ciclo — e o card desenha os subordinados recursivamente. Sobe a
  // cadeia de gestores até repetir alguém: esse está no ciclo, e o ciclo é
  // cortado nele. Quem só está pendurado no ciclo continua embaixo do próprio
  // gestor (antes ele virava uma raiz solta, longe do gestor ativo).
  for (const no of porId.values()) {
    if (visitados.has(no.id)) continue;
    const vistosNaSubida = new Set<number>();
    let atual = no;
    while (!vistosNaSubida.has(atual.id)) {
      vistosNaSubida.add(atual.id);
      const gestor = atual.gerenteId !== null ? porId.get(atual.gerenteId) : undefined;
      if (!gestor) break;
      atual = gestor;
    }
    const noDoCorte = atual;
    const gestorDoCorte = noDoCorte.gerenteId !== null ? porId.get(noDoCorte.gerenteId) : undefined;
    if (gestorDoCorte) gestorDoCorte.subordinados = gestorDoCorte.subordinados.filter((s) => s.id !== noDoCorte.id);
    raizes.push(noDoCorte);
    visitar(noDoCorte);
  }

  return raizes;
}

function tamanhoEquipe(no: NoOrganograma): number {
  return no.subordinados.reduce((total, sub) => total + 1 + tamanhoEquipe(sub), 0);
}

// "Diretoria", "Diretoria Executiva", "Presidência"...
function ehDiretoria(nomeDepartamento: string): boolean {
  return /diretori|presiden/.test(normalizarBusca(nomeDepartamento));
}

// "CEO", "Presidente" (não "Vice-presidente"), "Diretor(a) Geral",
// "Diretor(a) Executivo(a)".
function ehCargoDeTopo(cargo: string | null | undefined): boolean {
  return /\bceo\b|(?<!vice[\s-]?)presidente|diretora?[\s-]+(geral|executiv)|chief executive/.test(normalizarBusca(cargo ?? ''));
}

/**
 * O topo da hierarquia vem primeiro. Entre as pessoas sem gestor da Diretoria
 * (ou de um departamento de nome parecido), o critério é estável: primeiro
 * o cargo de topo (CEO, Presidente, Diretor Geral/Executivo), depois a
 * admissão mais antiga; o tamanho da equipe só desempata. Antes a equipe
 * vinha primeiro, e um diretor novo sem gestor, com um ramo grande, tirava a
 * CEO do topo. Sem ninguém na Diretoria, vale a raiz com a maior equipe. As
 * outras raízes são quem ficou sem gestor (cadastro incompleto, gestor
 * desligado, ciclo).
 */
function ordenarRaizes(raizes: NoOrganograma[]): NoOrganograma[] {
  const tamanho = new Map(raizes.map((r) => [r.id, tamanhoEquipe(r)]));
  const porEquipe = [...raizes].sort((a, b) => (tamanho.get(b.id) ?? 0) - (tamanho.get(a.id) ?? 0));
  const [melhorDaDiretoria] = raizes
    .filter((r) => r.gerenteId === null && ehDiretoria(r.departamentoNome))
    .sort(
      (a, b) =>
        Number(ehCargoDeTopo(b.cargoNome)) - Number(ehCargoDeTopo(a.cargoNome)) ||
        (dataIso(a.dataAdmissao) ?? '9999-12-31').localeCompare(dataIso(b.dataAdmissao) ?? '9999-12-31') ||
        (tamanho.get(b.id) ?? 0) - (tamanho.get(a.id) ?? 0) ||
        a.id - b.id
    );
  const topo = melhorDaDiretoria ?? porEquipe.find((r) => ehDiretoria(r.departamentoNome)) ?? porEquipe[0];
  return topo ? [topo, ...porEquipe.filter((r) => r !== topo)] : [];
}

/** Se `inicio` está abaixo da pessoa `idTopo` na cadeia de gestores (ciclo). */
function estaAbaixoDe(inicio: FuncionarioDto, idTopo: number, porId: Map<number, FuncionarioDto>): boolean {
  const vistos = new Set<number>();
  let atual: FuncionarioDto | undefined = inicio;
  while (atual && !vistos.has(atual.id)) {
    if (atual.id === idTopo) return true;
    vistos.add(atual.id);
    atual = atual.gerenteId !== null ? porId.get(atual.gerenteId) : undefined;
  }
  return false;
}

/**
 * Pergunta antes de desligar, com a MESMA regra do backend: os subordinados
 * diretos ativos (todos, e não só os desenhados embaixo do card, porque a
 * árvore corta os ciclos) vão para o gestor de quem sai, se ele estiver
 * ativo; senão ficam sem gestor. Com ciclo de gestores, o texto não promete
 * nada: o resultado exato vem na resposta.
 */
function textoConfirmacaoDesligar(pessoa: FuncionarioDto, ativos: FuncionarioDto[]): string {
  const final = 'Essa ação não pode ser desfeita pelo site.';
  const diretos = ativos.filter((f) => f.gerenteId === pessoa.id && f.id !== pessoa.id).length;
  if (diretos === 0) return `Desligar ${pessoa.nome}? ${final}`;

  const porId = new Map(ativos.map((f) => [f.id, f]));
  const quem = `${contarColaboradores(diretos)} que ${diretos === 1 ? 'reporta' : 'reportam'} diretamente a essa pessoa`;
  const gestor = pessoa.gerenteId !== null && pessoa.gerenteId !== pessoa.id ? porId.get(pessoa.gerenteId) : undefined;
  if (gestor && estaAbaixoDe(gestor, pessoa.id, porId)) {
    return `Desligar ${pessoa.nome}? Os gestores dessa pessoa formam um ciclo na hierarquia. O sistema vai realocar ${quem} e mostrar o resultado logo depois. ${final}`;
  }
  const destino = gestor
    ? `${diretos === 1 ? 'passa' : 'passam'} a reportar a ${gestor.nome}`
    : `${diretos === 1 ? 'fica' : 'ficam'} sem gestor definido`;
  return `Desligar ${pessoa.nome}? ${quem} ${destino}. ${final}`;
}

/** Percorre a árvore inteira, com o nível de cada nó (0 = raiz). */
function percorrer(raizes: NoOrganograma[], visitar: (no: NoOrganograma, nivel: number) => void) {
  const descer = (no: NoOrganograma, nivel: number) => {
    visitar(no, nivel);
    no.subordinados.forEach((sub) => descer(sub, nivel + 1));
  };
  raizes.forEach((raiz) => descer(raiz, 0));
}

/** O que de fato aconteceu, a partir da resposta do backend. */
function descreverDesligamento(nome: string, resultado: DesligamentoResultadoDto): string {
  const quantidade = resultado.subordinadosRealocados ?? 0;
  if (quantidade <= 0) return `${nome} foi desligado(a).`;
  const quem =
    quantidade === 1 ? '1 colaborador que reportava a essa pessoa' : `${quantidade} colaboradores que reportavam a essa pessoa`;
  if (resultado.novoGestorNome) {
    return `${nome} foi desligado(a). ${quem} ${quantidade === 1 ? 'passou' : 'passaram'} a reportar a ${resultado.novoGestorNome}.`;
  }
  return `${nome} foi desligado(a). ${quem} ${quantidade === 1 ? 'ficou' : 'ficaram'} sem gestor definido e ${
    quantidade === 1 ? 'aparece' : 'aparecem'
  } em "Sem gestor definido" no organograma.`;
}

// Quanto o mouse precisa andar pra virar "arrastar" em vez de clique.
const LIMIAR_ARRASTO = 5;

// Largura de cada árvore em "Sem gestor definido": o card (w-56 = 224px)
// mais os 10px de cada lado do <li>.
const LARGURA_CELULA = 244;
// p-6 da área (24px de cada lado).
const PADDING_AREA = 48;

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
      aria-haspopup="dialog"
      className="w-56 h-[72px] flex items-center gap-2.5 px-3 rounded-xl border border-gray-200 bg-white text-left shadow-sm cursor-pointer transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="relative shrink-0">
        <span
          className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${
            destaque ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground'
          }`}
          aria-hidden="true"
        >
          {iniciais(funcionario.nome)}
        </span>
        {funcionario.possuiAcessoApp && (
          <span
            title="Tem acesso ao app"
            className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 text-white ring-2 ring-white flex items-center justify-center"
          >
            <Smartphone size={9} strokeWidth={2.5} aria-hidden="true" />
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

/** Um nó da árvore: o card e, embaixo, a equipe dele. As linhas entre gestor
 * e subordinados vêm do CSS (.org-arvore). */
function NoArvore({
  no,
  idDestaque,
  onAbrir,
}: {
  no: NoOrganograma;
  idDestaque: number;
  onAbrir: (no: NoOrganograma) => void;
}) {
  // Equipe em que ninguém tem subordinados fica em coluna, um card embaixo
  // do outro — em fileira, uma equipe grande esticaria a árvore pros lados.
  const emColuna = no.subordinados.length > 1 && no.subordinados.every((sub) => sub.subordinados.length === 0);

  return (
    <li>
      <CardColaborador funcionario={no} destaque={no.id === idDestaque} onAbrir={() => onAbrir(no)} />
      {no.subordinados.length > 0 && (
        <ul className={emColuna ? 'org-pilha' : 'org-ramo'}>
          {no.subordinados.map((sub) => (
            <NoArvore key={sub.id} no={sub} idDestaque={idDestaque} onAbrir={onAbrir} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Área do organograma: a única parte da tela que rola (barras finas, só
 * quando a árvore não cabe). Abre centralizada no topo da hierarquia e, com
 * o mouse, dá pra clicar e arrastar o fundo pra mover a visão.
 */
function VisualizacaoOrganograma({
  raizes,
  onAbrir,
}: {
  raizes: NoOrganograma[];
  onAbrir: (no: NoOrganograma) => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [principal, ...semGestor] = raizes;
  const [larguraArea, setLarguraArea] = useState(0);

  // "Sem gestor definido" vira uma grade que quebra linha na largura visível
  // da área (antes era uma fileira única com centenas de cards lado a lado).
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const medir = () => setLarguraArea(area.clientWidth);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(area);
    return () => observador.disconnect();
  }, []);

  // Centraliza o card do topo da hierarquia ao abrir a tela (depois de medir
  // a área, que define a largura da grade de baixo).
  const centralizadoRef = useRef(false);
  useLayoutEffect(() => {
    if (centralizadoRef.current || larguraArea === 0) return;
    const area = areaRef.current;
    const card = area?.querySelector<HTMLElement>(`[data-no="${principal.id}"]`);
    if (!area || !card) return;
    centralizadoRef.current = true;
    const a = area.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    area.scrollLeft += c.left + c.width / 2 - (a.left + area.clientWidth / 2);
  }, [larguraArea, principal.id]);

  // O contador conta pessoas (a raiz e a equipe dela), não só as raízes.
  const pessoasSemGestor = semGestor.reduce((total, raiz) => total + 1 + tamanhoEquipe(raiz), 0);

  // --- Arrastar para mover (mouse; no celular vale a rolagem por toque) ---
  const arrastoRef = useRef<{ id: number; x: number; y: number; left: number; top: number; movendo: boolean } | null>(
    null
  );
  // Fica true quando o gesto virou arrasto, pra engolir o clique que o
  // navegador dispara ao soltar o botão (senão abriria o card de baixo).
  const arrastouRef = useRef(false);
  const [arrastando, setArrastando] = useState(false);

  function aoPressionar(e: ReactPointerEvent<HTMLDivElement>) {
    arrastouRef.current = false;
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

  return (
    <div
      ref={areaRef}
      className={`org-area flex-1 min-h-[320px] rounded-xl border border-gray-200 ${arrastando ? 'arrastando' : ''}`}
      onPointerDown={aoPressionar}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerCancel={encerrarArrasto}
      onClickCapture={aoClicar}
    >
      {/* Ocupa no mínimo a área toda e centraliza a árvore quando ela é menor. */}
      <div className="min-w-full w-max p-6 select-none flex flex-col items-center gap-14">
        <ul className="org-arvore" aria-label="Organograma">
          <NoArvore no={principal} idDestaque={principal.id} onAbrir={onAbrir} />
        </ul>

        {semGestor.length > 0 && (
          <section
            aria-label="Colaboradores sem gestor definido"
            className="flex flex-col items-center gap-5"
            // Largura fixa (a visível da área): sem ela a grade, dentro de um
            // pai `w-max`, nunca quebraria a linha.
            style={{ width: Math.max(larguraArea - PADDING_AREA, LARGURA_CELULA) }}
          >
            <span className="px-3 py-1 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-500">
              Sem gestor definido · {contarColaboradores(pessoasSemGestor)}
            </span>
            {/* `safe center`: uma árvore mais larga que a área sobra só para a
                direita (dá para rolar até ela); com `center` ela vazava para
                os dois lados e o começo ficava fora do alcance. */}
            <div className="w-full flex flex-wrap justify-center-safe items-start gap-x-4 gap-y-8">
              {semGestor.map((raiz) => (
                <ul key={raiz.id} className="org-arvore">
                  <NoArvore no={raiz} idDestaque={principal.id} onAbrir={onAbrir} />
                </ul>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// Controles que recebem foco por Tab dentro do modal.
const SELETOR_FOCAVEIS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal com os dados do colaborador e as ações de RH (acesso ao app e desligamento). */
function DetalhesColaborador({
  funcionario,
  desligando,
  erroDesligar,
  onFechar,
  onDesligar,
  onLimparErroDesligar,
  onAcessoAppAlterado,
}: {
  funcionario: NoOrganograma;
  /** Vem da tela (e não do modal): continua valendo se o modal for fechado e reaberto. */
  desligando: boolean;
  erroDesligar: string | null;
  onFechar: () => void;
  onDesligar: () => void;
  /** Some com o erro de um desligamento anterior (vale para a tela toda). */
  onLimparErroDesligar: () => void;
  onAcessoAppAlterado: () => void;
}) {
  const { token, isRhOuAdmin } = useAuth();
  const dialogoRef = useRef<HTMLDivElement>(null);
  const erroDesligarRef = useRef<HTMLParagraphElement>(null);
  const erroAcessoRef = useRef<HTMLParagraphElement>(null);
  const idTitulo = `detalhes-colaborador-${funcionario.id}`;

  const [editandoAcessoApp, setEditandoAcessoApp] = useState(false);
  const [senhaApp, setSenhaApp] = useState('');
  const [salvandoAcessoApp, setSalvandoAcessoApp] = useState(false);
  const salvandoAcessoRef = useRef(false);
  const [erroAcessoApp, setErroAcessoApp] = useState<string | null>(null);
  const [sucessoAcessoApp, setSucessoAcessoApp] = useState<string | null>(null);
  // Vale até a lista recarregada chegar com possuiAcessoApp atualizado.
  const [acessoAppCriado, setAcessoAppCriado] = useState(false);
  const possuiAcessoApp = funcionario.possuiAcessoApp || acessoAppCriado;

  // O onFechar muda a cada render da tela; a ref evita reinstalar os
  // listeners de teclado.
  const onFecharRef = useRef(onFechar);
  onFecharRef.current = onFechar;

  // Diálogo modal de verdade: o foco entra nele, fica preso nele (Tab e
  // Shift+Tab dão a volta) e Esc fecha. Antes o foco ficava no card de trás,
  // e Tab+Enter trocava a pessoa mostrada — com risco de desligar a errada.
  useEffect(() => {
    const dialogo = dialogoRef.current;
    if (!dialogo) return;
    dialogo.focus();

    const focaveis = () =>
      Array.from(dialogo.querySelectorAll<HTMLElement>(SELETOR_FOCAVEIS)).filter((el) => el.getClientRects().length > 0);

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onFecharRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogo) return;
      const lista = focaveis();
      if (lista.length === 0) {
        e.preventDefault();
        dialogo.focus();
        return;
      }
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      const ativo = document.activeElement;
      const foraDoDialogo = !ativo || !dialogo.contains(ativo) || ativo === dialogo;
      if (e.shiftKey && (ativo === primeiro || foraDoDialogo)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (ativo === ultimo || foraDoDialogo)) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    // Foco que escapar por outro caminho (leitor de tela, clique) volta ao diálogo.
    function aoFocar(e: FocusEvent) {
      if (dialogo && e.target instanceof Node && !dialogo.contains(e.target)) dialogo.focus();
    }

    document.addEventListener('keydown', aoTeclar);
    document.addEventListener('focusin', aoFocar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('focusin', aoFocar);
    };
  }, []);

  // O botão clicado fica desabilitado durante a requisição, e o navegador
  // tira o foco dele (vai para o BODY, fora do diálogo, sem disparar focusin).
  // Quando a ação termina com o modal ainda aberto, o foco volta para dentro:
  // na mensagem de erro, se houver, ou no próprio diálogo.
  useEffect(() => {
    const dialogo = dialogoRef.current;
    if (!dialogo || desligando || salvandoAcessoApp) return;
    const ativo = document.activeElement;
    if (ativo && ativo !== document.body && dialogo.contains(ativo)) return;
    (erroDesligarRef.current ?? erroAcessoRef.current ?? dialogo).focus();
  }, [desligando, salvandoAcessoApp, erroDesligar, erroAcessoApp, sucessoAcessoApp]);

  async function handleSalvarAcessoApp(e: FormEvent) {
    e.preventDefault();
    // Trava síncrona: o estado só vale no próximo render, e N envios no mesmo
    // instante viravam N POSTs (cada um derruba as sessões do colaborador).
    if (!token || salvandoAcessoRef.current) return;
    const erroSenha = validarSenhaApp(senhaApp);
    if (erroSenha) {
      setErroAcessoApp(erroSenha);
      return;
    }

    const jaTinhaAcesso = possuiAcessoApp;
    salvandoAcessoRef.current = true;
    // Uma ação nova tira o erro da outra: antes os dois alertas ficavam juntos.
    onLimparErroDesligar();
    setSalvandoAcessoApp(true);
    setErroAcessoApp(null);
    setSucessoAcessoApp(null);
    try {
      const atualizado = await api.definirAcessoApp(token, funcionario.id, senhaApp);
      setAcessoAppCriado(atualizado?.possuiAcessoApp ?? true);
      setSucessoAcessoApp(
        jaTinhaAcesso
          ? 'Senha do app redefinida. As sessões abertas com a senha antiga foram encerradas; passe a nova senha para o colaborador.'
          : `Acesso criado. ${funcionario.nome} já pode entrar no app com ${atualizado?.email ?? funcionario.email}.`
      );
      setEditandoAcessoApp(false);
      setSenhaApp('');
      onAcessoAppAlterado();
    } catch (erro) {
      setErroAcessoApp(erro instanceof ApiError ? erro.message : 'Não foi possível definir o acesso ao app.');
    } finally {
      salvandoAcessoRef.current = false;
      setSalvandoAcessoApp(false);
    }
  }

  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className="modal-conteudo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-5 gap-3">
          <h2
            id={idTitulo}
            className="m-0 text-xl sm:text-2xl text-gray-800 font-semibold flex-1 min-w-0 [overflow-wrap:anywhere]"
          >
            {funcionario.nome}
          </h2>
          <button type="button" className="botao-fechar shrink-0" onClick={onFechar} aria-label="Fechar">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="text-center mb-5">
          <div
            className="avatar-funcionario"
            aria-hidden="true"
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
          <span className="inline-block max-w-full bg-gray-200 px-4 py-1 rounded-full text-sm [overflow-wrap:anywhere]">
            {funcionario.cargoNome}
          </span>
        </div>

        <div>
          <div className="linha-info">
            <span className="flex items-center gap-2 text-gray-500">
              <Mail size={16} aria-hidden="true" />
              Email
            </span>
            <span className="text-gray-800 font-medium break-all">{funcionario.email ?? '—'}</span>
          </div>
          <div className="linha-info">
            <span className="flex items-center gap-2 text-gray-500">
              <Phone size={16} aria-hidden="true" />
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
              <Smartphone size={16} aria-hidden="true" />
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
              <p
                role="status"
                className="m-0 mb-3 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm"
              >
                {sucessoAcessoApp}
              </p>
            )}
            {erroAcessoApp && (
              <p
                ref={erroAcessoRef}
                tabIndex={-1}
                role="alert"
                className="text-red-600 text-sm mb-3 [overflow-wrap:anywhere] focus:outline-none"
              >
                {erroAcessoApp}
              </p>
            )}

            {!funcionario.email ? (
              <p className="m-0 mb-3 text-sm text-gray-500">
                Cadastre um e-mail para este colaborador antes de criar o acesso ao app.
              </p>
            ) : editandoAcessoApp ? (
              <form onSubmit={handleSalvarAcessoApp} className="mb-3 space-y-2" noValidate>
                <label htmlFor={`senha-app-${funcionario.id}`} className="block text-sm text-gray-600">
                  {possuiAcessoApp ? 'Nova senha do app' : 'Senha de acesso ao app'}
                </label>
                <input
                  id={`senha-app-${funcionario.id}`}
                  type="password"
                  value={senhaApp}
                  onChange={(e) => setSenhaApp(e.target.value)}
                  // O limite real (64 caracteres, emoji conta 1) é conferido
                  // no envio; o maxLength do navegador conta em UTF-16.
                  maxLength={SENHA_APP_MAXIMO * 2}
                  required
                  autoFocus
                  autoComplete="new-password"
                  placeholder={`De ${SENHA_APP_MINIMO} a ${SENHA_APP_MAXIMO} caracteres`}
                  disabled={desligando}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="submit"
                    disabled={salvandoAcessoApp || desligando}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
                  >
                    {salvandoAcessoApp ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <KeyRound size={16} aria-hidden="true" />
                    )}
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
                type="button"
                disabled={desligando}
                onClick={() => {
                  setEditandoAcessoApp(true);
                  setErroAcessoApp(null);
                  setSucessoAcessoApp(null);
                }}
                className="w-full mb-3 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-primary/40 text-primary hover:bg-primary/5 transition-colors disabled:opacity-60"
              >
                <KeyRound size={16} aria-hidden="true" />
                {possuiAcessoApp ? 'Redefinir senha do app' : 'Criar acesso ao app'}
              </button>
            )}

            {erroDesligar && (
              <p
                ref={erroDesligarRef}
                tabIndex={-1}
                role="alert"
                className="text-red-600 text-sm mb-3 [overflow-wrap:anywhere] focus:outline-none"
              >
                {erroDesligar}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setErroAcessoApp(null);
                setSucessoAcessoApp(null);
                onDesligar();
              }}
              disabled={desligando}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
            >
              {desligando ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <UserMinus size={16} aria-hidden="true" />
              )}
              {desligando ? 'Desligando…' : 'Desligar colaborador'}
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
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const { avisarGlobal } = useAvisos();
  const montadaRef = useRef(true);
  // Carga em andamento: cancelada quando outra começa ou quando a tela sai.
  const cargaRef = useRef<AbortController | null>(null);

  useEffect(() => {
    montadaRef.current = true;
    return () => {
      montadaRef.current = false;
      cargaRef.current?.abort();
    };
  }, []);

  // `silencioso` recarrega sem trocar a árvore pelo spinner — assim o modal
  // aberto (ex. depois de criar o acesso ao app) continua na tela. Devolve
  // os ativos carregados (ou null, se falhou ou foi cancelada).
  async function carregar(silencioso = false): Promise<FuncionarioDto[] | null> {
    if (!token || !montadaRef.current) return null;
    cargaRef.current?.abort();
    const controle = new AbortController();
    cargaRef.current = controle;
    if (!silencioso) {
      setCarregando(true);
      setErro(null);
    }
    try {
      const lista = await api.listarFuncionarios(token, controle.signal);
      if (!Array.isArray(lista)) throw new ApiError(0, MENSAGEM_RESPOSTA_INESPERADA);
      const ativos = lista.filter((f) => f.status === StatusFuncionario.Ativo);
      setFuncionarios(ativos);
      return ativos;
    } catch (e) {
      if (silencioso || controle.signal.aborted) return null;
      setErro(
        e instanceof ApiError && e.status === 403
          ? 'Só RH/Admin pode ver o organograma completo.'
          : e instanceof ApiError
            ? e.message
            : 'Não foi possível carregar o organograma.'
      );
      return null;
    } finally {
      if (!silencioso && !controle.signal.aborted) setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const raizes = useMemo(() => ordenarRaizes(montarArvore(funcionarios)), [funcionarios]);

  const porId = useMemo(() => {
    const mapa = new Map<number, NoOrganograma>();
    percorrer(raizes, (no) => mapa.set(no.id, no));
    return mapa;
  }, [raizes]);

  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const selecionado = selecionadoId !== null ? porId.get(selecionadoId) : undefined;
  // Cópia síncrona, lida quando a resposta do desligamento chega.
  const selecionadoIdRef = useRef<number | null>(null);
  selecionadoIdRef.current = selecionadoId;

  function abrir(no: NoOrganograma) {
    setSelecionadoId(no.id);
  }

  // Ao fechar, o foco volta para o card que abriu o modal (ou para o título,
  // se o card saiu da árvore).
  function fechar() {
    const id = selecionadoIdRef.current;
    setSelecionadoId(null);
    requestAnimationFrame(() => {
      const card = id !== null ? document.querySelector<HTMLElement>(`[data-no="${id}"]`) : null;
      (card ?? tituloRef.current)?.focus();
    });
  }

  // --- Desligamento ---
  // A trava fica na tela, e não no modal: fechar e reabrir o card no meio do
  // processo não libera o botão de novo (antes isso desligava duas vezes).
  const desligandoRef = useRef(new Set<number>());
  const [desligandoIds, setDesligandoIds] = useState<ReadonlySet<number>>(new Set());
  const [errosDesligar, setErrosDesligar] = useState<Record<number, string>>({});
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  function marcarDesligando(id: number, ativo: boolean) {
    if (ativo) desligandoRef.current.add(id);
    else desligandoRef.current.delete(id);
    setDesligandoIds(new Set(desligandoRef.current));
  }

  async function desligar(no: NoOrganograma) {
    if (!token || desligandoRef.current.has(no.id)) return;

    if (!window.confirm(textoConfirmacaoDesligar(no, funcionarios))) return;

    marcarDesligando(no.id, true);
    setAviso(null);
    setErrosDesligar((prev) => {
      const copia = { ...prev };
      delete copia[no.id];
      return copia;
    });
    try {
      // Um POST só: o backend move os subordinados na mesma transação e conta
      // quantos foram (antes eram vários PUTs em série, que paravam no meio).
      const resultado = await api.desligarFuncionario(token, no.id, { versao: no.versao });
      const texto = descreverDesligamento(resultado?.funcionario?.nome ?? no.nome, resultado);
      // Saiu da tela no meio: o resultado aparece como aviso global.
      if (!montadaRef.current) {
        avisarGlobal(texto, 'sucesso');
        return;
      }
      setAviso({ tipo: 'sucesso', texto });
      if (selecionadoIdRef.current === no.id) setSelecionadoId(null);
      await carregar(true);
      if (!document.activeElement || document.activeElement === document.body) tituloRef.current?.focus();
    } catch (e) {
      const mensagem = e instanceof ApiError ? e.message : 'Não foi possível desligar o colaborador.';
      const textoErro = `Não foi possível desligar ${no.nome}. ${mensagem}`;
      if (!montadaRef.current) {
        avisarGlobal(textoErro, 'erro');
        return;
      }

      // Alterado por outra pessoa (409), já desligado (400) ou não encontrado
      // (404): atualiza a árvore e a `versao` para a próxima tentativa.
      if (ehConflito(e) || (e instanceof ApiError && (e.status === 400 || e.status === 404))) {
        const ativos = await carregar(true);
        if (ativos && !ativos.some((f) => f.id === no.id)) {
          // A pessoa já tinha saído (outra pessoa desligou antes). O card some
          // da árvore e o modal fecha, mas com a explicação na tela e o foco
          // num lugar previsível, em vez de sumir sem aviso.
          setAviso({ tipo: 'erro', texto: textoErro });
          if (selecionadoIdRef.current === no.id) setSelecionadoId(null);
          requestAnimationFrame(() => tituloRef.current?.focus());
          return;
        }
      }

      setErrosDesligar((prev) => ({ ...prev, [no.id]: mensagem }));
      // Com o modal dessa pessoa fechado, o erro aparece na própria tela.
      if (selecionadoIdRef.current !== no.id) {
        setAviso({ tipo: 'erro', texto: textoErro });
      }
    } finally {
      marcarDesligando(no.id, false);
    }
  }

  return (
    // Ocupa a altura do <main>: a área da árvore fica com a altura que sobra
    // na janela e é a única parte que rola — a página em si fica parada.
    <div className="w-full h-full flex flex-col">
      <div className="mb-4 sm:mb-6 shrink-0">
        <h1
          ref={tituloRef}
          tabIndex={-1}
          className="m-0 text-2xl sm:text-3xl lg:text-[32px] text-gray-800 font-semibold focus:outline-none"
        >
          Organograma
        </h1>
        <p className="mt-1 text-sm sm:text-base text-gray-500">
          Estrutura organizacional da empresa
          {!carregando && !erro && funcionarios.length > 0 && ` · ${contarColaboradores(funcionarios.length)}`}
        </p>
      </div>

      {aviso && (
        <div
          role={aviso.tipo === 'erro' ? 'alert' : 'status'}
          className={`mb-4 shrink-0 flex items-start justify-between gap-3 px-4 py-3 rounded-lg border text-sm ${
            aviso.tipo === 'erro' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-green-50 border-green-200 text-green-700'
          }`}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{aviso.texto}</span>
          <button
            type="button"
            onClick={() => setAviso(null)}
            className="shrink-0 p-0.5 rounded hover:bg-black/5"
            aria-label="Fechar aviso"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {carregando && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2" role="status">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          Carregando organograma…
        </div>
      )}

      {erro && !carregando && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{erro}</span>
          <button
            type="button"
            onClick={() => carregar()}
            className="px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-600 hover:bg-red-50 transition-colors shrink-0"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!carregando && !erro && raizes.length === 0 && (
        <p className="text-muted-foreground">Nenhum funcionário cadastrado ainda.</p>
      )}

      {!carregando && !erro && raizes.length > 0 && <VisualizacaoOrganograma raizes={raizes} onAbrir={abrir} />}

      {selecionado && (
        <DetalhesColaborador
          key={selecionado.id}
          funcionario={selecionado}
          desligando={desligandoIds.has(selecionado.id)}
          erroDesligar={errosDesligar[selecionado.id] ?? null}
          onFechar={fechar}
          onDesligar={() => desligar(selecionado)}
          onLimparErroDesligar={() =>
            setErrosDesligar((prev) => {
              const copia = { ...prev };
              delete copia[selecionado.id];
              return copia;
            })
          }
          onAcessoAppAlterado={() => carregar(true)}
        />
      )}
    </div>
  );
}
