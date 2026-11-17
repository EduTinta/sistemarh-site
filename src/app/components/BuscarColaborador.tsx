import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Search,
  Loader2,
  RefreshCw,
  Mail,
  Phone,
  Building2,
  Briefcase,
  UserCheck,
  Calendar,
  CalendarX,
  DollarSign,
  Utensils,
  Smartphone,
  TrendingUp,
  History,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import { useFuncionarios } from '../hooks/useFuncionarios';
import {
  StatusFuncionario,
  TipoAjusteRemuneracao,
  type AjusteRemuneracaoDto,
  type FuncionarioDto,
} from '../../types/api';
import { ListaColaboradores } from './ListaColaboradores';
import { formatarMoeda } from '../../utils/moeda';
import { formatarDataCalendario, formatarDataHoraBrasilia } from '../../utils/datas';
import { iniciais } from '../../utils/funcionarios';

type FiltroSituacao = 'ativos' | 'desligados' | 'todos';

const FILTROS_SITUACAO: {
  id: FiltroSituacao;
  label: string;
  vazio: string;
  inclui: (f: FuncionarioDto) => boolean;
}[] = [
  {
    id: 'ativos',
    label: 'Ativos',
    vazio: 'Nenhum colaborador ativo.',
    inclui: (f) => f.status === StatusFuncionario.Ativo,
  },
  {
    id: 'desligados',
    label: 'Desligados',
    vazio: 'Nenhum colaborador desligado.',
    inclui: (f) => f.status !== StatusFuncionario.Ativo,
  },
  {
    id: 'todos',
    label: 'Todos',
    vazio: 'Nenhum colaborador cadastrado.',
    inclui: () => true,
  },
];

const VISUAL_AJUSTE: Record<TipoAjusteRemuneracao, { label: string; icone: LucideIcon }> = {
  [TipoAjusteRemuneracao.Salario]: { label: 'Ajuste salarial', icone: DollarSign },
  [TipoAjusteRemuneracao.ValeAlimentacao]: { label: 'Vale alimentação', icone: Utensils },
  [TipoAjusteRemuneracao.Promocao]: { label: 'Promoção', icone: TrendingUp },
};

// Quantos ajustes mostrar no painel (a API já devolve os mais recentes primeiro).
const LIMITE_AJUSTES = 5;

function LinhaDetalhe({ icone: Icone, rotulo, children }: { icone: LucideIcon; rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-b-0">
      <Icone className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1 sm:flex sm:justify-between sm:gap-3">
        <span className="block text-sm text-muted-foreground shrink-0">{rotulo}</span>
        <span className="block text-sm font-medium break-words sm:text-right">{children}</span>
      </div>
    </div>
  );
}

function ItemAjuste({ ajuste }: { ajuste: AjusteRemuneracaoDto }) {
  const visual = VISUAL_AJUSTE[ajuste.tipo] ?? { label: 'Ajuste', icone: DollarSign };
  const Icone = visual.icone;
  const mudouCargo = ajuste.cargoNovoNome && ajuste.cargoNovoNome !== ajuste.cargoAnteriorNome;
  const mudouDepartamento =
    ajuste.departamentoNovoNome && ajuste.departamentoNovoNome !== ajuste.departamentoAnteriorNome;

  return (
    <li className="p-3 rounded-lg border border-border bg-accent/20">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Icone className="w-4 h-4 text-primary" />
          {visual.label}
        </span>
        <span className="text-xs text-muted-foreground">
          Vigência: {formatarDataCalendario(ajuste.dataVigencia) ?? '—'}
        </span>
      </div>

      <p className="m-0 text-sm">
        <span className="line-through opacity-60">{formatarMoeda(ajuste.valorAnterior)}</span>
        {' → '}
        <span className="font-medium text-primary">{formatarMoeda(ajuste.valorNovo)}</span>
      </p>

      {mudouCargo && (
        <p className="m-0 mt-1 text-xs text-muted-foreground break-words">
          Cargo: {ajuste.cargoAnteriorNome ?? '—'} → {ajuste.cargoNovoNome}
        </p>
      )}
      {mudouDepartamento && (
        <p className="m-0 mt-1 text-xs text-muted-foreground break-words">
          Departamento: {ajuste.departamentoAnteriorNome ?? '—'} → {ajuste.departamentoNovoNome}
        </p>
      )}

      {ajuste.motivo?.trim() && (
        <p className="m-0 mt-2 text-sm text-gray-700 whitespace-pre-line break-words">{ajuste.motivo}</p>
      )}

      <p className="m-0 mt-2 text-xs text-muted-foreground">
        Registrado em {formatarDataHoraBrasilia(ajuste.criadoEm)}
        {ajuste.responsavelNome ? ` por ${ajuste.responsavelNome}` : ''}
      </p>
    </li>
  );
}

export function BuscarColaborador() {
  const { token } = useAuth();
  const { funcionarios, carregando, erro, recarregar } = useFuncionarios();
  const [situacao, setSituacao] = useState<FiltroSituacao>('ativos');
  const [departamentoId, setDepartamentoId] = useState('');
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);

  const [ajustes, setAjustes] = useState<AjusteRemuneracaoDto[]>([]);
  const [carregandoAjustes, setCarregandoAjustes] = useState(false);
  const [erroAjustes, setErroAjustes] = useState<string | null>(null);

  const painelRef = useRef<HTMLDivElement>(null);

  // Departamentos que aparecem na lista, pro filtro (sem chamada extra à API).
  const departamentos = useMemo(() => {
    const porId = new Map<number, string>();
    for (const f of funcionarios) porId.set(f.departamentoId, f.departamentoNome);
    return [...porId.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [funcionarios]);

  const doDepartamento = useMemo(
    () => (departamentoId ? funcionarios.filter((f) => String(f.departamentoId) === departamentoId) : funcionarios),
    [funcionarios, departamentoId]
  );

  const filtroAtual = FILTROS_SITUACAO.find((f) => f.id === situacao) ?? FILTROS_SITUACAO[0];
  const visiveis = useMemo(() => doDepartamento.filter(filtroAtual.inclui), [doDepartamento, filtroAtual]);

  // O painel continua mostrando o selecionado mesmo que um filtro o esconda da lista.
  const selecionado = funcionarios.find((f) => f.id === selecionadoId) ?? null;
  const desligado = selecionado ? selecionado.status !== StatusFuncionario.Ativo : false;

  useEffect(() => {
    if (!token || selecionadoId === null) {
      setAjustes([]);
      setErroAjustes(null);
      return;
    }

    // Se outro colaborador for escolhido antes da resposta chegar, ela é descartada.
    let cancelado = false;
    setAjustes([]);
    setCarregandoAjustes(true);
    setErroAjustes(null);

    api
      .listarAjustesRemuneracao(token, selecionadoId)
      .then((lista) => {
        if (!cancelado) setAjustes(lista);
      })
      .catch((e) => {
        if (cancelado) return;
        setErroAjustes(e instanceof ApiError ? e.message : 'Não foi possível carregar o histórico de remuneração.');
      })
      .finally(() => {
        if (!cancelado) setCarregandoAjustes(false);
      });

    return () => {
      cancelado = true;
    };
  }, [token, selecionadoId]);

  function handleSelecionar(funcionario: FuncionarioDto) {
    setSelecionadoId(funcionario.id);
    // No celular os detalhes ficam abaixo da lista: leva a tela até eles.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => painelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  const mensagemVazia = departamentoId
    ? `Nenhum colaborador ${situacao === 'ativos' ? 'ativo ' : situacao === 'desligados' ? 'desligado ' : ''}neste departamento.`
    : filtroAtual.vazio;

  return (
    <div className="w-full max-w-7xl mx-auto animate-fade-in">
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-lg shrink-0">
              <Search className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <h1 className="text-2xl sm:text-3xl">Buscar Colaborador</h1>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">
            Consulte os dados e o histórico de remuneração de todos os colaboradores
          </p>
        </div>
        <button
          onClick={recarregar}
          disabled={carregando}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60 w-full sm:w-auto shrink-0"
        >
          <RefreshCw size={16} className={carregando ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        {/* Lista de Colaboradores */}
        <ListaColaboradores
          titulo="Colaboradores"
          funcionarios={visiveis}
          carregando={carregando}
          erro={erro}
          onRecarregar={recarregar}
          selecionadoId={selecionadoId}
          onSelecionar={handleSelecionar}
          mensagemVazia={mensagemVazia}
          filtros={
            <div className="space-y-3">
              <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-label="Situação">
                {FILTROS_SITUACAO.map((f) => {
                  const ativo = situacao === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSituacao(f.id)}
                      aria-pressed={ativo}
                      className={`flex-1 min-w-0 px-2 py-2 text-sm leading-tight transition-colors ${
                        ativo ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent/50'
                      }`}
                    >
                      {f.label}{' '}
                      <span className="opacity-75 whitespace-nowrap">({doDepartamento.filter(f.inclui).length})</span>
                    </button>
                  );
                })}
              </div>
              <select
                value={departamentoId}
                onChange={(e) => setDepartamentoId(e.target.value)}
                aria-label="Departamento"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Todos os departamentos</option>
                {departamentos.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome}
                  </option>
                ))}
              </select>
            </div>
          }
          renderItem={(funcionario) => (
            <>
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-medium break-words min-w-0">{funcionario.nome}</h3>
                {funcionario.status !== StatusFuncionario.Ativo && (
                  <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Desligado</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mb-2 break-all">{funcionario.email ?? 'Sem e-mail'}</p>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <div className="flex gap-2 flex-wrap">
                  <span className="text-xs px-2 py-1 bg-accent rounded-full">{funcionario.departamentoNome}</span>
                  <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">{funcionario.cargoNome}</span>
                </div>
                <span className="text-sm font-medium text-primary whitespace-nowrap">
                  {formatarMoeda(funcionario.salario)}
                </span>
              </div>
            </>
          )}
        />

        {/* Detalhes */}
        <div ref={painelRef} className="hr-card p-4 sm:p-6 scroll-mt-4">
          <h2 className="text-xl mb-4">Detalhes do Colaborador</h2>

          {selecionado ? (
            <div className="space-y-6">
              <div className="p-4 bg-accent/30 rounded-lg border border-border flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                    desligado ? 'bg-gray-400 text-white' : 'bg-primary text-primary-foreground'
                  }`}
                >
                  {iniciais(selecionado.nome)}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium break-words">{selecionado.nome}</h3>
                  <p className="text-sm text-muted-foreground break-words">{selecionado.cargoNome}</p>
                </div>
                <span
                  className={`self-start shrink-0 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                    desligado ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}
                >
                  {desligado ? 'Desligado' : 'Ativo'}
                </span>
              </div>

              <div>
                <LinhaDetalhe icone={Mail} rotulo="E-mail">
                  <span className="break-all">{selecionado.email ?? 'Não informado'}</span>
                </LinhaDetalhe>
                <LinhaDetalhe icone={Phone} rotulo="Telefone">
                  {selecionado.telefone ?? 'Não informado'}
                </LinhaDetalhe>
                <LinhaDetalhe icone={Building2} rotulo="Departamento">
                  {selecionado.departamentoNome}
                </LinhaDetalhe>
                <LinhaDetalhe icone={Briefcase} rotulo="Cargo">
                  {selecionado.cargoNome}
                </LinhaDetalhe>
                <LinhaDetalhe icone={UserCheck} rotulo="Gestor">
                  {selecionado.gerenteNome ?? 'Nenhum (topo da hierarquia)'}
                </LinhaDetalhe>
                <LinhaDetalhe icone={Calendar} rotulo="Admissão">
                  {formatarDataCalendario(selecionado.dataAdmissao) ?? '—'}
                </LinhaDetalhe>
                {desligado && (
                  <LinhaDetalhe icone={CalendarX} rotulo="Desligamento">
                    {formatarDataCalendario(selecionado.dataDesligamento) ?? '—'}
                  </LinhaDetalhe>
                )}
                <LinhaDetalhe icone={DollarSign} rotulo="Salário">
                  <span className="text-primary">{formatarMoeda(selecionado.salario)}</span>
                </LinhaDetalhe>
                <LinhaDetalhe icone={Utensils} rotulo="Vale alimentação">
                  {formatarMoeda(selecionado.valeAlimentacao)}
                </LinhaDetalhe>
                <LinhaDetalhe icone={Smartphone} rotulo="Acesso ao app">
                  <span className={selecionado.possuiAcessoApp ? 'text-green-600' : undefined}>
                    {selecionado.possuiAcessoApp ? 'Sim' : 'Não'}
                  </span>
                </LinhaDetalhe>
              </div>

              <div>
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" />
                  Últimos ajustes de remuneração
                </h3>

                {carregandoAjustes ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando histórico…
                  </div>
                ) : erroAjustes ? (
                  <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                    {erroAjustes}
                  </div>
                ) : ajustes.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">Nenhum ajuste de remuneração registrado.</p>
                ) : (
                  <>
                    <ul className="m-0 p-0 list-none space-y-2">
                      {ajustes.slice(0, LIMITE_AJUSTES).map((ajuste) => (
                        <ItemAjuste key={ajuste.id} ajuste={ajuste} />
                      ))}
                    </ul>
                    {ajustes.length > LIMITE_AJUSTES && (
                      <p className="m-0 mt-2 text-xs text-muted-foreground">
                        Mostrando os {LIMITE_AJUSTES} mais recentes de {ajustes.length} ajustes.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Users className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-center">Selecione um colaborador na lista para ver os detalhes</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
