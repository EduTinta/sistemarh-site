import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ClipboardCheck, Loader2, RefreshCw, Check, X, Hourglass, MessageSquare, Send, UserX, type LucideIcon } from 'lucide-react';
import '../styles/hr-system.css';
import { api, ApiError, ehConflito } from '../../services/api';
import { useAuth } from '../context/AuthContext';
import { useAvisos, useConfirmarSaida, useFocoAposEnvio } from '../context/AvisosContext';
import { hrefDaTela } from '../context/NavegacaoContext';
import { LimiteDeErro } from './LimiteDeErro';
import { TextoExpansivel } from './TextoExpansivel';
import {
  StatusAusencia,
  StatusMensagemRh,
  TipoAusencia,
  type AusenciaRhDto,
  type MensagemRhDto,
} from '../../types/api';
import { formatarDataCalendario, formatarDataHoraBrasilia, instanteEmMs } from '../../utils/datas';
import { REGRA_RESPOSTA_MENSAGEM, contarCaracteres, limparTextoLongo, validarTexto } from '../../utils/validacao';

const MENSAGEM_RESPOSTA_INESPERADA = 'O servidor devolveu uma resposta inesperada. Tente novamente.';

// Erros que significam "a lista na tela está velha": outra pessoa decidiu
// antes (409), a justificativa já foi concluída (400) ou foi cancelada (404).
function listaDesatualizada(erro: unknown): boolean {
  return ehConflito(erro) || (erro instanceof ApiError && (erro.status === 400 || erro.status === 404));
}

function mensagemDoErro(erro: unknown, padrao: string): string {
  return erro instanceof ApiError ? erro.message : padrao;
}

// Carga cancelada (a tela saiu ou outra carga começou): não é erro.
function foiCancelada(signal: AbortSignal): boolean {
  return signal.aborted;
}

function semItem<T>(registro: Record<number, T>, id: number): Record<number, T> {
  const copia = { ...registro };
  delete copia[id];
  return copia;
}

type Aba = 'justificativas' | 'mensagens';

export function Solicitacoes({ aba }: { aba: Aba }) {
  // A aba só monta na primeira visita e depois fica montada (escondida):
  // trocar de aba não perde rascunhos nem o resultado de um envio em andamento.
  const [visitadas, setVisitadas] = useState<ReadonlySet<Aba>>(() => new Set([aba]));
  useEffect(() => {
    setVisitadas((prev) => (prev.has(aba) ? prev : new Set([...prev, aba])));
  }, [aba]);

  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="mb-5 sm:mb-6 min-w-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0" aria-hidden="true">
            <ClipboardCheck className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
          </div>
          <h1 className="m-0 text-2xl sm:text-3xl lg:text-[32px] text-gray-800 font-semibold">Solicitações</h1>
        </div>
        <p className="mt-2 text-sm sm:text-base text-gray-500">
          Justificativas de ausência e mensagens que os colaboradores enviam pelo app
        </p>
      </div>

      {/* Cada aba tem o próprio endereço (#/solicitacoes e #/solicitacoes/mensagens):
          o F5 e o Voltar mantêm a aba. */}
      <nav aria-label="Tipo de solicitação" className="mb-5 flex gap-2">
        {(
          [
            { id: 'justificativas', rotulo: 'Justificativas', icone: ClipboardCheck, href: hrefDaTela('solicitacoes') },
            { id: 'mensagens', rotulo: 'Mensagens', icone: MessageSquare, href: hrefDaTela('mensagensRh') },
          ] as const
        ).map(({ id, rotulo, icone: Icone, href }) => {
          const ativa = aba === id;
          return (
            <a
              key={id}
              href={href}
              aria-current={ativa ? 'page' : undefined}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm no-underline transition-colors ${
                ativa
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icone size={16} aria-hidden="true" />
              {rotulo}
            </a>
          );
        })}
      </nav>

      {/* Cada aba com o próprio limite de erro: o erro de uma não aparece na
          outra, e voltar à aba que falhou tenta de novo (chaveReinicio). */}
      {(['justificativas', 'mensagens'] as const).map(
        (id) =>
          (visitadas.has(id) || aba === id) && (
            <div key={id} hidden={aba !== id}>
              <LimiteDeErro chaveReinicio={aba}>{id === 'justificativas' ? <Justificativas /> : <MensagensRh />}</LimiteDeErro>
            </div>
          )
      )}
    </div>
  );
}

// ─────────────────────────────── Justificativas ───────────────────────────────

type FiltroJustificativa = 'pendentes' | 'aprovadas' | 'recusadas' | 'todas';

const FILTROS: { id: FiltroJustificativa; label: string; vazio: string; inclui: (status: StatusAusencia) => boolean }[] = [
  {
    id: 'pendentes',
    label: 'Pendentes',
    vazio: 'Nenhuma justificativa pendente. Tudo em dia!',
    inclui: (s) => s === StatusAusencia.Enviada || s === StatusAusencia.EmAnalise,
  },
  {
    id: 'aprovadas',
    label: 'Aprovadas',
    vazio: 'Nenhuma justificativa aprovada ainda.',
    inclui: (s) => s === StatusAusencia.Aprovada,
  },
  {
    id: 'recusadas',
    label: 'Recusadas',
    vazio: 'Nenhuma justificativa recusada.',
    inclui: (s) => s === StatusAusencia.Recusada,
  },
  {
    id: 'todas',
    label: 'Todas',
    vazio: 'Nenhuma justificativa foi enviada pelo app ainda.',
    inclui: () => true,
  },
];

const ROTULO_TIPO: Record<TipoAusencia, string> = {
  [TipoAusencia.AtestadoMedico]: 'Atestado médico',
  [TipoAusencia.FaltaJustificada]: 'Falta justificada',
  [TipoAusencia.EsquecimentoDePonto]: 'Esquecimento de ponto',
  [TipoAusencia.Outro]: 'Outro',
};

const VISUAL_STATUS: Record<StatusAusencia, { label: string; classes: string; aviso: string }> = {
  [StatusAusencia.Enviada]: { label: 'Enviada', classes: 'bg-blue-100 text-blue-700', aviso: 'voltou para enviada' },
  [StatusAusencia.EmAnalise]: { label: 'Em análise', classes: 'bg-amber-100 text-amber-700', aviso: 'está em análise' },
  [StatusAusencia.Aprovada]: { label: 'Aprovada', classes: 'bg-green-100 text-green-700', aviso: 'foi aprovada' },
  [StatusAusencia.Recusada]: { label: 'Recusada', classes: 'bg-red-100 text-red-700', aviso: 'foi recusada' },
};

function estaConcluida(status: StatusAusencia): boolean {
  return status === StatusAusencia.Aprovada || status === StatusAusencia.Recusada;
}

/** Abas de filtro com a contagem de cada uma (usadas nas duas listas). */
function AbasFiltro<T extends string>({
  filtros,
  ativo,
  onSelecionar,
}: {
  filtros: { id: T; label: string; quantidade: number }[];
  ativo: T;
  onSelecionar: (id: T) => void;
}) {
  return (
    <div className="mb-5 border-b border-gray-200 overflow-x-auto">
      <div className="flex gap-1 min-w-max" role="group" aria-label="Filtrar por situação">
        {filtros.map((f) => {
          const selecionado = ativo === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onSelecionar(f.id)}
              aria-pressed={selecionado}
              className={`flex items-center gap-2 px-3 sm:px-4 py-3 border-b-2 transition-colors whitespace-nowrap text-sm ${
                selecionado ? 'border-primary text-primary font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {f.label}
              <span
                className={`px-2 py-0.5 rounded-full text-xs ${selecionado ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-600'}`}
              >
                {f.quantidade}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BarraAtualizar({ carregando, onAtualizar, rotulo }: { carregando: boolean; onAtualizar: () => void; rotulo: string }) {
  return (
    <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <p className="m-0 text-sm text-gray-500">{rotulo}</p>
      <button
        type="button"
        onClick={onAtualizar}
        disabled={carregando}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60 w-full sm:w-auto shrink-0"
      >
        <RefreshCw size={16} className={carregando ? 'animate-spin' : ''} aria-hidden="true" />
        Atualizar
      </button>
    </div>
  );
}

function Justificativas() {
  const { token } = useAuth();
  const [ausencias, setAusencias] = useState<AusenciaRhDto[]>([]);
  const [filtro, setFiltro] = useState<FiltroJustificativa>('pendentes');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  // Trava por item (e não uma só para a tela): agir na 2ª justificativa não
  // pode reabilitar os botões da 1ª, que ainda está salvando. A ref é a
  // trava síncrona; o estado só redesenha os botões.
  const andamentoRef = useRef(new Set<number>());
  const [emAndamento, setEmAndamento] = useState<Record<number, StatusAusencia>>({});
  const [erroPorId, setErroPorId] = useState<Record<number, string>>({});
  const { avisarGlobal } = useAvisos();
  const focarAposEnvio = useFocoAposEnvio();
  const montadaRef = useRef(true);
  // Carga em andamento: cancelada quando outra começa ou quando a tela sai
  // (antes a resposta de uma tela abandonada ainda era baixada inteira).
  const cargaRef = useRef<AbortController | null>(null);

  useEffect(() => {
    montadaRef.current = true;
    return () => {
      montadaRef.current = false;
      cargaRef.current?.abort();
    };
  }, []);

  // `silencioso` mantém a lista na tela enquanto recarrega (ex. depois de um 409).
  async function carregar(silencioso = false) {
    if (!token) return;
    cargaRef.current?.abort();
    const controle = new AbortController();
    cargaRef.current = controle;
    setCarregando(true);
    if (!silencioso) setErro(null);
    try {
      const lista = await api.listarAusenciasRh(token, undefined, controle.signal);
      if (!Array.isArray(lista)) throw new ApiError(0, MENSAGEM_RESPOSTA_INESPERADA);
      setAusencias(lista);
      setErro(null);
      setErroPorId({});
    } catch (e) {
      if (foiCancelada(controle.signal)) return;
      setErro(mensagemDoErro(e, 'Não foi possível carregar as justificativas.'));
    } finally {
      if (!foiCancelada(controle.signal)) setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Mais recentes primeiro.
  const ordenadas = useMemo(
    () => [...ausencias].sort((a, b) => instanteEmMs(b.criadoEm) - instanteEmMs(a.criadoEm)),
    [ausencias]
  );

  const filtroAtual = FILTROS.find((f) => f.id === filtro) ?? FILTROS[0];
  const visiveis = ordenadas.filter((a) => filtroAtual.inclui(a.status));

  async function alterarStatus(ausencia: AusenciaRhDto, novoStatus: StatusAusencia) {
    if (!token || andamentoRef.current.has(ausencia.id)) return;

    if (estaConcluida(novoStatus)) {
      const acao = novoStatus === StatusAusencia.Aprovada ? 'Aprovar' : 'Recusar';
      const data = formatarDataCalendario(ausencia.data) ?? '';
      const confirmou = window.confirm(
        `${acao} a justificativa de ${ausencia.usuarioNome} (${data})? Depois de concluída ela não pode mais ser alterada.`
      );
      if (!confirmou || andamentoRef.current.has(ausencia.id)) return;
    }

    andamentoRef.current.add(ausencia.id);
    setEmAndamento((prev) => ({ ...prev, [ausencia.id]: novoStatus }));
    setAviso(null);
    setErroPorId((prev) => semItem(prev, ausencia.id));
    // Os botões do card ficam desabilitados e o foco cai no BODY; no fim ele
    // volta para o card (se ele continua na aba), para o erro do card ou para
    // o aviso do alto.
    let focarDepois: string | null = null;

    try {
      // A `versao` faz a API recusar (409) a decisão tomada sobre um texto
      // que o colaborador editou depois, ou que outra aba já decidiu.
      const atualizada = await api.atualizarStatusAusencia(token, ausencia.id, novoStatus, ausencia.versao);
      if (atualizada && typeof atualizada === 'object' && atualizada.id === ausencia.id) {
        setAusencias((prev) => prev.map((a) => (a.id === ausencia.id ? atualizada : a)));
      } else {
        // Sem o item de volta não há `versao` nova: busca a lista de novo.
        setAusencias((prev) => prev.map((a) => (a.id === ausencia.id ? { ...a, status: novoStatus } : a)));
        void carregar(true);
      }
      const texto = `A justificativa de ${ausencia.usuarioNome} ${VISUAL_STATUS[novoStatus].aviso}.`;
      // Se a pessoa já saiu da tela, o resultado aparece como aviso global.
      if (montadaRef.current) setAviso({ tipo: 'sucesso', texto });
      else avisarGlobal(texto, 'sucesso');
      focarDepois = filtroAtual.inclui(novoStatus) ? `justificativa-${ausencia.id}` : 'aviso-justificativas';
    } catch (e) {
      const mensagem = mensagemDoErro(e, 'Não foi possível atualizar a justificativa.');
      if (!montadaRef.current) {
        avisarGlobal(`Justificativa de ${ausencia.usuarioNome}: ${mensagem}`, 'erro');
      } else if (listaDesatualizada(e)) {
        // O card mostrava um estado velho: recarrega para mostrar o atual.
        setAviso({ tipo: 'erro', texto: `${ausencia.usuarioNome}: ${mensagem} A lista foi atualizada.` });
        await carregar(true);
        focarDepois = 'aviso-justificativas';
      } else {
        setErroPorId((prev) => ({ ...prev, [ausencia.id]: mensagem }));
        focarDepois = `erro-justificativa-${ausencia.id}`;
      }
    } finally {
      andamentoRef.current.delete(ausencia.id);
      setEmAndamento((prev) => semItem(prev, ausencia.id));
      if (focarDepois && montadaRef.current) focarAposEnvio(focarDepois);
    }
  }

  return (
    <div>
      <BarraAtualizar carregando={carregando} onAtualizar={() => carregar()} rotulo="Ausências e justificativas enviadas pelo app" />

      <AbasFiltro
        filtros={FILTROS.map((f) => ({ id: f.id, label: f.label, quantidade: ausencias.filter((a) => f.inclui(a.status)).length }))}
        ativo={filtro}
        onSelecionar={setFiltro}
      />

      {erro && (
        <div role="alert" className="mb-5 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm [overflow-wrap:anywhere]">
          {erro}
        </div>
      )}
      {aviso && (
        <div
          id="aviso-justificativas"
          tabIndex={-1}
          role={aviso.tipo === 'erro' ? 'alert' : 'status'}
          className={`mb-5 px-4 py-3 rounded-lg border text-sm [overflow-wrap:anywhere] focus:outline-none ${
            aviso.tipo === 'erro' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-green-50 border-green-200 text-green-700'
          }`}
        >
          {aviso.texto}
        </div>
      )}

      {carregando && ausencias.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-gray-500 gap-2" role="status">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          Carregando justificativas…
        </div>
      ) : (
        !erro &&
        visiveis.length === 0 && (
          <div className="card-simples text-center !py-10">
            <ClipboardCheck className="w-8 h-8 text-gray-300 mx-auto mb-3" aria-hidden="true" />
            <p className="m-0 text-sm text-gray-500">{filtroAtual.vazio}</p>
          </div>
        )
      )}

      {/* grid-cols-1 = minmax(0, 1fr) e min-w-0 nos cards: uma palavra longa
          sem espaço na descrição não alarga mais a coluna (e com ela todos os
          cards, que tiravam os botões Aprovar/Recusar da tela). */}
      <div className="grid grid-cols-1 gap-4">
        {visiveis.map((a) => {
          const visual = VISUAL_STATUS[a.status] ?? { label: String(a.status), classes: 'bg-gray-100 text-gray-700' };
          const concluida = estaConcluida(a.status);
          const statusEmAndamento = emAndamento[a.id];
          const ocupada = statusEmAndamento !== undefined;

          const botaoAcao = (status: StatusAusencia, rotulo: string, Icone: LucideIcon, classes: string) => (
            <button
              type="button"
              onClick={() => alterarStatus(a, status)}
              disabled={ocupada}
              className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:opacity-60 ${classes}`}
            >
              {ocupada && statusEmAndamento === status ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Icone size={16} aria-hidden="true" />
              )}
              {rotulo}
            </button>
          );

          return (
            <article
              key={a.id}
              id={`justificativa-${a.id}`}
              tabIndex={-1}
              className="card-simples !mb-0 min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`Justificativa de ${a.usuarioNome}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
                <div className="min-w-0">
                  <p className="m-0 font-semibold text-gray-800 [overflow-wrap:anywhere]">{a.usuarioNome}</p>
                  <p className="m-0 text-sm text-gray-500 break-all">{a.usuarioEmail}</p>
                  {a.funcionarioId === null && (
                    <p className="m-0 mt-1 inline-flex items-center gap-1 text-xs text-amber-700">
                      <UserX size={12} aria-hidden="true" />
                      Conta sem vínculo com um cadastro de colaborador
                    </p>
                  )}
                </div>
                <span
                  className={`self-start shrink-0 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${visual.classes}`}
                >
                  {visual.label}
                </span>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 text-sm">
                <div className="min-w-0">
                  <p className="m-0 text-gray-500">Tipo</p>
                  <p className="m-0 text-gray-800 font-medium">{ROTULO_TIPO[a.tipo] ?? 'Outro'}</p>
                </div>
                <div className="min-w-0">
                  <p className="m-0 text-gray-500">Data</p>
                  <p className="m-0 text-gray-800 font-medium">{formatarDataCalendario(a.data) ?? '—'}</p>
                </div>
                <div className="min-w-0">
                  <p className="m-0 text-gray-500">Período</p>
                  <p className="m-0 text-gray-800 font-medium">{a.diaInteiro ? 'Dia inteiro' : 'Parte do dia'}</p>
                </div>
                <div className="min-w-0">
                  <p className="m-0 text-gray-500">Enviada em</p>
                  <p className="m-0 text-gray-800 font-medium">{formatarDataHoraBrasilia(a.criadoEm)}</p>
                </div>
              </div>

              {a.descricao?.trim() && (
                <div className="mb-4">
                  <TextoExpansivel texto={a.descricao} className="m-0 p-3 rounded-md bg-gray-50 text-sm text-gray-700" />
                </div>
              )}

              {erroPorId[a.id] && (
                <p
                  id={`erro-justificativa-${a.id}`}
                  tabIndex={-1}
                  role="alert"
                  className="m-0 mb-3 text-sm text-red-600 [overflow-wrap:anywhere] focus:outline-none"
                >
                  {erroPorId[a.id]}
                </p>
              )}

              {!concluida && (
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-end gap-2 pt-4 border-t border-gray-200">
                  {a.status === StatusAusencia.Enviada &&
                    botaoAcao(StatusAusencia.EmAnalise, 'Em análise', Hourglass, 'border border-amber-300 text-amber-700 hover:bg-amber-50')}
                  {botaoAcao(StatusAusencia.Recusada, 'Recusar', X, 'border border-red-300 text-red-600 hover:bg-red-50')}
                  {botaoAcao(StatusAusencia.Aprovada, 'Aprovar', Check, 'bg-green-600 text-white hover:bg-green-700')}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────── Mensagens ao RH ───────────────────────────────

type FiltroMensagem = 'abertas' | 'respondidas' | 'todas';

const FILTROS_MENSAGEM: { id: FiltroMensagem; label: string; vazio: string; inclui: (s: StatusMensagemRh) => boolean }[] = [
  {
    id: 'abertas',
    label: 'Abertas',
    vazio: 'Nenhuma mensagem esperando resposta.',
    inclui: (s) => s === StatusMensagemRh.Aberta,
  },
  {
    id: 'respondidas',
    label: 'Respondidas',
    vazio: 'Nenhuma mensagem respondida ainda.',
    inclui: (s) => s === StatusMensagemRh.Respondida,
  },
  {
    id: 'todas',
    label: 'Todas',
    vazio: 'Nenhuma mensagem foi enviada pelo app ainda.',
    inclui: () => true,
  },
];

// Mesma regra da API (texto longo): 3 a 2000 caracteres depois da limpeza,
// quebras de linha no máximo 2 seguidas, sem caracteres invisíveis.
const RESPOSTA_MAXIMO = REGRA_RESPOSTA_MENSAGEM.maximo;

function MensagensRh() {
  const { token } = useAuth();
  const [mensagens, setMensagens] = useState<MensagemRhDto[]>([]);
  const [filtro, setFiltro] = useState<FiltroMensagem>('abertas');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  // Resposta em edição de cada mensagem (várias podem estar abertas ao mesmo tempo).
  const [rascunhos, setRascunhos] = useState<Record<number, string>>({});
  const enviandoRef = useRef(new Set<number>());
  const [enviando, setEnviando] = useState<Record<number, true>>({});
  const [erroPorId, setErroPorId] = useState<Record<number, string>>({});
  const { avisarGlobal } = useAvisos();
  const focarAposEnvio = useFocoAposEnvio();
  const montadaRef = useRef(true);
  const cargaRef = useRef<AbortController | null>(null);

  useEffect(() => {
    montadaRef.current = true;
    return () => {
      montadaRef.current = false;
      cargaRef.current?.abort();
    };
  }, []);

  // Resposta escrita e não enviada: sair da tela pede confirmação (trocar
  // para a aba Justificativas não, porque esta aba continua montada). Uma
  // resposta que já está sendo enviada não conta: ela não se perde ao sair,
  // e o resultado chega pelo aviso global, como nas outras telas.
  const temRascunho = Object.entries(rascunhos).some(
    ([id, texto]) => enviando[Number(id)] !== true && limparTextoLongo(texto) !== ''
  );
  useConfirmarSaida(temRascunho, 'Há respostas escritas e não enviadas. Sair e descartar?');

  async function carregar(silencioso = false) {
    if (!token) return;
    cargaRef.current?.abort();
    const controle = new AbortController();
    cargaRef.current = controle;
    setCarregando(true);
    if (!silencioso) setErro(null);
    try {
      const lista = await api.listarMensagensRh(token, undefined, controle.signal);
      if (!Array.isArray(lista)) throw new ApiError(0, MENSAGEM_RESPOSTA_INESPERADA);
      setMensagens(lista);
      setErro(null);
      setErroPorId({});
    } catch (e) {
      if (foiCancelada(controle.signal)) return;
      setErro(mensagemDoErro(e, 'Não foi possível carregar as mensagens.'));
    } finally {
      if (!foiCancelada(controle.signal)) setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const ordenadas = useMemo(
    () => [...mensagens].sort((a, b) => instanteEmMs(b.criadoEm) - instanteEmMs(a.criadoEm)),
    [mensagens]
  );
  const filtroAtual = FILTROS_MENSAGEM.find((f) => f.id === filtro) ?? FILTROS_MENSAGEM[0];
  const visiveis = ordenadas.filter((m) => filtroAtual.inclui(m.status));

  async function responder(e: FormEvent, mensagem: MensagemRhDto) {
    e.preventDefault();
    if (!token || enviandoRef.current.has(mensagem.id)) return;

    const texto = rascunhos[mensagem.id] ?? '';
    const erroValidacao = validarTexto(texto, REGRA_RESPOSTA_MENSAGEM);
    if (erroValidacao) {
      setErroPorId((prev) => ({ ...prev, [mensagem.id]: erroValidacao }));
      return;
    }

    enviandoRef.current.add(mensagem.id);
    setEnviando((prev) => ({ ...prev, [mensagem.id]: true }));
    setErroPorId((prev) => semItem(prev, mensagem.id));
    setAviso(null);
    // O campo e os botões ficam desabilitados e o foco cai no BODY; no fim
    // ele volta para o campo (erro), para o card ou para o aviso do alto.
    let focarDepois: string | null = null;
    try {
      // Vai o texto já limpo, igual ao que a API grava.
      const respondida = await api.responderMensagemRh(token, mensagem.id, {
        resposta: limparTextoLongo(texto),
        versao: mensagem.versao,
      });
      if (respondida && typeof respondida === 'object' && respondida.id === mensagem.id) {
        setMensagens((prev) => prev.map((m) => (m.id === mensagem.id ? respondida : m)));
      } else {
        void carregar(true);
      }
      setRascunhos((prev) => semItem(prev, mensagem.id));
      const textoSucesso = `Resposta enviada para ${mensagem.usuarioNome}. Ela aparece no app, em "Minhas mensagens".`;
      // Se a pessoa já saiu da tela, o resultado aparece como aviso global.
      if (montadaRef.current) setAviso({ tipo: 'sucesso', texto: textoSucesso });
      else avisarGlobal(textoSucesso, 'sucesso');
      // Respondida, ela sai da aba "Abertas"; nas outras continua visível.
      focarDepois = filtroAtual.inclui(StatusMensagemRh.Respondida) ? `mensagem-${mensagem.id}` : 'aviso-mensagens';
    } catch (erroEnvio) {
      const mensagemErro = mensagemDoErro(erroEnvio, 'Não foi possível enviar a resposta.');
      if (!montadaRef.current) {
        avisarGlobal(`Resposta para ${mensagem.usuarioNome}: ${mensagemErro}`, 'erro');
      } else if (ehConflito(erroEnvio)) {
        // Já respondida (em outra aba ou por outra pessoa): mostra a atual.
        // O rascunho fica guardado, caso ainda sirva.
        setAviso({ tipo: 'erro', texto: `${mensagem.usuarioNome}: ${mensagemErro} A lista foi atualizada.` });
        await carregar(true);
        focarDepois = 'aviso-mensagens';
      } else {
        setErroPorId((prev) => ({ ...prev, [mensagem.id]: mensagemErro }));
        focarDepois = `resposta-mensagem-${mensagem.id}`;
      }
    } finally {
      enviandoRef.current.delete(mensagem.id);
      setEnviando((prev) => semItem(prev, mensagem.id));
      if (focarDepois && montadaRef.current) focarAposEnvio(focarDepois);
    }
  }

  return (
    <div>
      <BarraAtualizar carregando={carregando} onAtualizar={() => carregar()} rotulo='Mensagens do "Falar com o RH" do app' />

      <AbasFiltro
        filtros={FILTROS_MENSAGEM.map((f) => ({
          id: f.id,
          label: f.label,
          quantidade: mensagens.filter((m) => f.inclui(m.status)).length,
        }))}
        ativo={filtro}
        onSelecionar={setFiltro}
      />

      {erro && (
        <div role="alert" className="mb-5 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm [overflow-wrap:anywhere]">
          {erro}
        </div>
      )}
      {aviso && (
        <div
          id="aviso-mensagens"
          tabIndex={-1}
          role={aviso.tipo === 'erro' ? 'alert' : 'status'}
          className={`mb-5 px-4 py-3 rounded-lg border text-sm [overflow-wrap:anywhere] focus:outline-none ${
            aviso.tipo === 'erro' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-green-50 border-green-200 text-green-700'
          }`}
        >
          {aviso.texto}
        </div>
      )}

      {carregando && mensagens.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-gray-500 gap-2" role="status">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          Carregando mensagens…
        </div>
      ) : (
        !erro &&
        visiveis.length === 0 && (
          <div className="card-simples text-center !py-10">
            <MessageSquare className="w-8 h-8 text-gray-300 mx-auto mb-3" aria-hidden="true" />
            <p className="m-0 text-sm text-gray-500">{filtroAtual.vazio}</p>
          </div>
        )
      )}

      <div className="grid grid-cols-1 gap-4">
        {visiveis.map((m) => {
          const aberta = m.status === StatusMensagemRh.Aberta;
          const salvando = enviando[m.id] === true;
          const rascunho = rascunhos[m.id];
          const editando = rascunho !== undefined;
          const idCampo = `resposta-mensagem-${m.id}`;

          return (
            <article
              key={m.id}
              id={`mensagem-${m.id}`}
              tabIndex={-1}
              className="card-simples !mb-0 min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`Mensagem de ${m.usuarioNome}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <p className="m-0 font-semibold text-gray-800 [overflow-wrap:anywhere]">{m.assunto}</p>
                  <p className="m-0 text-sm text-gray-500 [overflow-wrap:anywhere]">
                    {m.usuarioNome} · enviada em {formatarDataHoraBrasilia(m.criadoEm)}
                  </p>
                </div>
                <span
                  className={`self-start shrink-0 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                    aberta ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                  }`}
                >
                  {aberta ? 'Aberta' : 'Respondida'}
                </span>
              </div>

              <div className="mb-4">
                <TextoExpansivel texto={m.mensagem} className="m-0 p-3 rounded-md bg-gray-50 text-sm text-gray-700" />
              </div>

              {!aberta && m.resposta && (
                <div className="mb-1 p-3 rounded-md border border-green-200 bg-green-50 text-sm min-w-0">
                  <p className="m-0 mb-1 text-xs text-green-700 font-medium [overflow-wrap:anywhere]">
                    Resposta{m.responsavelNome ? ` de ${m.responsavelNome}` : ''}
                    {m.respondidaEm ? ` · ${formatarDataHoraBrasilia(m.respondidaEm)}` : ''}
                  </p>
                  <TextoExpansivel texto={m.resposta} className="m-0 text-gray-800" />
                </div>
              )}

              {erroPorId[m.id] && !(aberta && editando) && (
                <p role="alert" className="m-0 mb-3 text-sm text-red-600 [overflow-wrap:anywhere]">
                  {erroPorId[m.id]}
                </p>
              )}

              {aberta &&
                (editando ? (
                  <form onSubmit={(e) => responder(e, m)} className="pt-4 border-t border-gray-200 space-y-2 min-w-0" noValidate>
                    {/* Nome longo sem espaço quebra aqui, como no cabeçalho do card. */}
                    <label htmlFor={idCampo} className="block min-w-0 text-sm text-gray-600 [overflow-wrap:anywhere]">
                      Resposta para {m.usuarioNome}
                    </label>
                    <textarea
                      id={idCampo}
                      value={rascunho}
                      onChange={(e) => {
                        const valor = e.target.value;
                        setRascunhos((prev) => ({ ...prev, [m.id]: valor }));
                      }}
                      rows={4}
                      maxLength={RESPOSTA_MAXIMO * 2}
                      disabled={salvando}
                      autoFocus
                      aria-invalid={erroPorId[m.id] ? true : undefined}
                      aria-describedby={erroPorId[m.id] ? `${idCampo}-erro ${idCampo}-contagem` : `${idCampo}-contagem`}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {/* O erro da resposta fica logo abaixo do campo. */}
                    {erroPorId[m.id] && (
                      <p id={`${idCampo}-erro`} role="alert" className="m-0 text-sm text-red-600 [overflow-wrap:anywhere]">
                        {erroPorId[m.id]}
                      </p>
                    )}
                    <p id={`${idCampo}-contagem`} className="m-0 text-xs text-gray-400">
                      {contarCaracteres(limparTextoLongo(rascunho))}/{RESPOSTA_MAXIMO} caracteres
                    </p>
                    <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
                      <button
                        type="button"
                        disabled={salvando}
                        onClick={() => {
                          setRascunhos((prev) => semItem(prev, m.id));
                          setErroPorId((prev) => semItem(prev, m.id));
                        }}
                        className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={salvando}
                        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
                      >
                        {salvando ? (
                          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Send size={16} aria-hidden="true" />
                        )}
                        Enviar resposta
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex sm:justify-end pt-4 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => setRascunhos((prev) => ({ ...prev, [m.id]: '' }))}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-primary/40 text-primary hover:bg-primary/5 transition-colors"
                    >
                      <MessageSquare size={16} aria-hidden="true" />
                      Responder
                    </button>
                  </div>
                ))}
            </article>
          );
        })}
      </div>
    </div>
  );
}
