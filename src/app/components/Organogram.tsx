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

// Quanto o mouse precisa andar pra virar "arrastar" em vez de clique.
const LIMIAR_ARRASTO = 5;

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

  // Centraliza o card do topo da hierarquia ao abrir a tela.
  useLayoutEffect(() => {
    const area = areaRef.current;
    const card = area?.querySelector<HTMLElement>(`[data-no="${principal.id}"]`);
    if (!area || !card) return;
    const a = area.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    area.scrollLeft += c.left + c.width / 2 - (a.left + area.clientWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <div className="flex flex-col items-center gap-5">
            <span className="px-3 py-1 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-500">
              Sem gestor definido · {semGestor.length}
            </span>
            <ul className="org-arvore items-start" aria-label="Colaboradores sem gestor definido">
              {semGestor.map((raiz) => (
                <NoArvore key={raiz.id} no={raiz} idDestaque={principal.id} onAbrir={onAbrir} />
              ))}
            </ul>
          </div>
        )}
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

  const porId = useMemo(() => {
    const mapa = new Map<number, NoOrganograma>();
    percorrer(raizes, (no) => mapa.set(no.id, no));
    return mapa;
  }, [raizes]);

  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const selecionado = selecionadoId !== null ? porId.get(selecionadoId) : undefined;

  return (
    // Ocupa a altura do <main>: a área da árvore fica com a altura que sobra
    // na janela e é a única parte que rola — a página em si fica parada.
    <div className="w-full h-full flex flex-col">
      <div className="mb-4 sm:mb-6 shrink-0">
        <h1 className="m-0 text-2xl sm:text-3xl lg:text-[32px] text-gray-800 font-semibold">Organograma</h1>
        <p className="mt-1 text-sm sm:text-base text-gray-500">
          Estrutura organizacional da empresa
          {!carregando && !erro && funcionarios.length > 0 && ` · ${funcionarios.length} colaboradores`}
        </p>
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
        <VisualizacaoOrganograma raizes={raizes} onAbrir={(no) => setSelecionadoId(no.id)} />
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
