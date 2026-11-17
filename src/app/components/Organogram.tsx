import { Mail, Phone, X, Loader2, UserMinus, Smartphone, KeyRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
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

/**
 * Área do organograma com rolagem própria, limitada à altura da janela: as
 * barras horizontal e vertical ficam sempre à vista, sem precisar rolar a
 * página até o fim. Quando a árvore é mais larga que a tela, aparece também
 * uma barra horizontal espelhada no topo, sincronizada com a de baixo.
 */
function AreaRolagemOrganograma({ children }: { children: ReactNode }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const conteudoRef = useRef<HTMLDivElement>(null);
  const barraTopoRef = useRef<HTMLDivElement>(null);
  const [larguraConteudo, setLarguraConteudo] = useState(0);
  const [temRolagemHorizontal, setTemRolagemHorizontal] = useState(false);
  const jaCentralizou = useRef(false);

  useEffect(() => {
    const area = areaRef.current;
    const conteudo = conteudoRef.current;
    if (!area || !conteudo) return;

    const medir = () => {
      setLarguraConteudo(area.scrollWidth);
      const sobraHorizontal = area.scrollWidth - area.clientWidth;
      setTemRolagemHorizontal(sobraHorizontal > 1);

      // O card do topo (CEO) fica centralizado sobre a árvore inteira; numa
      // árvore larga ele começaria fora da tela. Na primeira medição a área
      // já abre rolada até o meio — depois disso o usuário manda na rolagem.
      if (!jaCentralizou.current && sobraHorizontal > 1) {
        area.scrollLeft = sobraHorizontal / 2;
        jaCentralizou.current = true;
      }
    };
    medir();

    // Reage tanto ao redimensionamento da janela quanto à árvore mudando.
    const observador = new ResizeObserver(medir);
    observador.observe(area);
    observador.observe(conteudo);
    return () => observador.disconnect();
  }, []);

  // Copia a posição proporcional de uma barra pra outra. A tolerância de 1px
  // evita que as duas fiquem se reajustando em loop.
  function sincronizar(origem: HTMLDivElement | null, destino: HTMLDivElement | null) {
    if (!origem || !destino) return;
    const maxOrigem = origem.scrollWidth - origem.clientWidth;
    const maxDestino = destino.scrollWidth - destino.clientWidth;
    const alvo = maxOrigem > 0 ? (origem.scrollLeft / maxOrigem) * maxDestino : 0;
    if (Math.abs(destino.scrollLeft - alvo) > 1) destino.scrollLeft = alvo;
  }

  // Quando a barra do topo aparece, já começa na mesma posição da área.
  useEffect(() => {
    if (temRolagemHorizontal) sincronizar(areaRef.current, barraTopoRef.current);
  }, [temRolagemHorizontal, larguraConteudo]);

  return (
    <div className="flex-1 min-h-[280px] flex flex-col">
      {temRolagemHorizontal && (
        <div
          ref={barraTopoRef}
          className="organograma-scroll organograma-scroll-topo mb-2"
          onScroll={() => sincronizar(barraTopoRef.current, areaRef.current)}
          aria-hidden="true"
        >
          <div style={{ width: larguraConteudo, height: 1 }} />
        </div>
      )}
      <div
        ref={areaRef}
        className="organograma-scroll flex-1 min-h-0 rounded-lg border border-gray-200 p-4"
        onScroll={() => sincronizar(areaRef.current, barraTopoRef.current)}
      >
        <div ref={conteudoRef} className="w-max min-w-full">
          {children}
        </div>
      </div>
    </div>
  );
}

const TAMANHO_MINIMO_SENHA_APP = 6;

function EmployeeCard({
  funcionario,
  cor,
  onDesligado,
  onAcessoAppAlterado,
}: {
  funcionario: NoOrganograma;
  cor: string;
  onDesligado: () => void;
  onAcessoAppAlterado: () => void;
}) {
  const { token, isRhOuAdmin } = useAuth();
  const [mostrarDetalhes, setMostrarDetalhes] = useState(false);
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

  function fecharDetalhes() {
    setMostrarDetalhes(false);
    setEditandoAcessoApp(false);
    setSenhaApp('');
    setErroAcessoApp(null);
    setSucessoAcessoApp(null);
  }

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
      fecharDetalhes();
      onDesligado();
    } catch (e) {
      setErroDesligar(e instanceof ApiError ? e.message : 'Não foi possível desligar o colaborador.');
    } finally {
      setDesligando(false);
    }
  }

  return (
    <div className="flex flex-col items-center m-2 sm:m-3">
      <div className="card-funcionario" onClick={() => setMostrarDetalhes(true)}>
        <div className="avatar-funcionario" style={{ backgroundColor: cor }}>
          {iniciais(funcionario.nome)}
        </div>
        <h3 className="m-1 text-sm sm:text-base text-gray-800 font-semibold leading-tight">{funcionario.nome}</h3>
        <p className="m-0 text-xs sm:text-sm text-gray-500">{funcionario.cargoNome}</p>
      </div>

      {mostrarDetalhes && (
        <div className="modal-fundo" onClick={fecharDetalhes}>
          <div className="modal-conteudo" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5 gap-3">
              <h2 className="m-0 text-xl sm:text-2xl text-gray-800 font-semibold break-words flex-1 min-w-0">
                {funcionario.nome}
              </h2>
              <button className="botao-fechar shrink-0" onClick={fecharDetalhes}>
                <X size={20} />
              </button>
            </div>

            <div className="text-center mb-5">
              <div
                className="avatar-funcionario"
                style={{ backgroundColor: cor, width: '80px', height: '80px', fontSize: '24px', margin: '0 auto 10px' }}
              >
                {iniciais(funcionario.nome)}
              </div>
              <span className="inline-block bg-gray-200 px-4 py-1 rounded-full text-sm">
                {funcionario.cargoNome}
              </span>
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
      )}

      {funcionario.subordinados.length > 0 && (
        <div className="mt-6 sm:mt-8 w-full">
          <div className="w-0.5 h-6 sm:h-8 bg-gray-300 mx-auto" />
          <div className="flex flex-wrap gap-3 sm:gap-6 justify-start">
            {funcionario.subordinados.map((sub) => (
              <EmployeeCard
                key={sub.id}
                funcionario={sub}
                cor="#10b981"
                onDesligado={onDesligado}
                onAcessoAppAlterado={onAcessoAppAlterado}
              />
            ))}
          </div>
        </div>
      )}
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

  const raizes = useMemo(() => montarArvore(funcionarios), [funcionarios]);

  return (
    // Ocupa a altura do <main>: assim a área da árvore abaixo do cabeçalho
    // (inclusive a topbar no celular) fica com a altura que sobra na janela.
    <div className="w-full max-w-7xl mx-auto h-full flex flex-col">
      <div className="mb-6 sm:mb-8 shrink-0">
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
        <AreaRolagemOrganograma>
          <div className="flex flex-col items-start gap-10">
            {raizes.map((raiz) => (
              <div key={raiz.id} className="flex justify-center min-w-max">
                <EmployeeCard
                  funcionario={raiz}
                  cor="#3b82f6"
                  onDesligado={() => carregar()}
                  onAcessoAppAlterado={() => carregar(true)}
                />
              </div>
            ))}
          </div>
        </AreaRolagemOrganograma>
      )}
    </div>
  );
}
