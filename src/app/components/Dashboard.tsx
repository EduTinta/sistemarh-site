import { useEffect, useState } from 'react';
import { Users, Briefcase, ClipboardCheck, Loader2, RefreshCw, Clock, Building2, User, type LucideIcon } from 'lucide-react';
import '../styles/hr-system.css';
import { useAuth } from '../context/AuthContext';
import { hrefDaTela } from '../context/NavegacaoContext';
import { api, ApiError } from '../../services/api';
import {
  StatusAusencia,
  StatusFuncionario,
  StatusRecrutamento,
  type DepartamentoDto,
  type FuncionarioDto,
} from '../../types/api';
import { contarColaboradores } from '../../utils/funcionarios';

const MENSAGEM_RESPOSTA_INESPERADA = 'O servidor devolveu uma resposta inesperada.';

// "+6h30" / "-2h15", igual ao app e a Meus Dados.
function formatarSaldoBancoHoras(minutos: number): string {
  const total = Math.abs(minutos);
  return `${minutos < 0 ? '-' : '+'}${Math.floor(total / 60)}h${(total % 60).toString().padStart(2, '0')}`;
}

// Uma resposta 200 que não é lista (página de proxy, objeto de erro), ou uma
// lista com item vazio (`[null]`), vira um erro comum de carga: o indicador
// mostra "—" e a faixa de erro oferece "Tentar novamente". Antes o `.filter`
// quebrava e o Dashboard ficava em branco ou carregando para sempre.
async function lista<T>(promessa: Promise<T[]>): Promise<T[]> {
  const valor = await promessa;
  if (!Array.isArray(valor) || valor.some((item) => !item || typeof item !== 'object')) {
    throw new ApiError(0, MENSAGEM_RESPOSTA_INESPERADA);
  }
  return valor;
}

function CardIndicador({
  icone: Icone,
  cor,
  titulo,
  valor,
  detalhe,
  carregando,
}: {
  icone: LucideIcon;
  cor?: string;
  titulo: string;
  valor: number | string | null;
  detalhe?: string;
  carregando: boolean;
}) {
  return (
    <div className="card-simples !mb-0 min-w-0">
      <div className="flex justify-between items-center mb-4">
        <div className="icone-card" style={cor ? { backgroundColor: cor } : undefined} aria-hidden="true">
          <Icone size={24} />
        </div>
      </div>
      <h3 className="m-0 text-gray-500 text-sm">{titulo}</h3>
      <p className="mt-1 mb-0 text-3xl sm:text-4xl font-bold text-gray-800 [overflow-wrap:anywhere]">
        {carregando ? (
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" aria-label="Carregando" />
        ) : valor === null ? (
          <span title="Indisponível">
            —<span className="sr-only"> (indisponível)</span>
          </span>
        ) : (
          valor
        )}
      </p>
      {detalhe && <p className="m-0 mt-1 text-xs text-gray-400">{detalhe}</p>}
    </div>
  );
}

export function Dashboard() {
  const { isRhOuAdmin } = useAuth();
  // A conta Funcionário não chama nenhuma rota de RH (dariam 403 no console).
  return isRhOuAdmin ? <DashboardRh /> : <InicioColaborador />;
}

/** Tela inicial de quem não é RH/Admin: só os dados da própria conta (/auth/me). */
function InicioColaborador() {
  const { usuario } = useAuth();
  if (!usuario) return null;
  const primeiroNome = usuario.nome.trim().split(/\s+/)[0] ?? '';

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6 sm:mb-8 min-w-0">
        {/* O título é o mesmo do menu e da aba do navegador. */}
        <h1 className="m-0 text-2xl sm:text-3xl lg:text-[32px] text-gray-800 font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm sm:text-base text-gray-500 [overflow-wrap:anywhere]">
          Olá{primeiroNome ? `, ${primeiroNome}` : ''}. Um resumo da sua conta.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mb-6 sm:mb-8">
        <CardIndicador
          icone={Clock}
          titulo="Saldo do banco de horas"
          valor={formatarSaldoBancoHoras(usuario.saldoBancoHorasMinutos)}
          carregando={false}
        />
        <CardIndicador icone={Briefcase} cor="#10b981" titulo="Cargo" valor={usuario.cargo?.trim() || null} carregando={false} />
        <CardIndicador
          icone={Building2}
          cor="#8b5cf6"
          titulo="Departamento"
          valor={usuario.departamento?.trim() || null}
          carregando={false}
        />
      </div>

      <div className="card-simples flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="m-0 text-sm text-gray-600">
          Seus dados de cadastro, holerites e o histórico do vale alimentação ficam em Meus Dados.
        </p>
        <a
          href={hrefDaTela('profile')}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity shrink-0 no-underline"
        >
          <User size={16} aria-hidden="true" />
          Ver Meus Dados
        </a>
      </div>
    </div>
  );
}

interface Falha {
  rotulo: string;
  mensagem: string;
}

function DashboardRh() {
  const { token } = useAuth();
  const [funcionarios, setFuncionarios] = useState<FuncionarioDto[] | null>(null);
  const [departamentos, setDepartamentos] = useState<DepartamentoDto[] | null>(null);
  const [candidatosEmProcesso, setCandidatosEmProcesso] = useState<number | null>(null);
  const [justificativasPendentes, setJustificativasPendentes] = useState<number | null>(null);
  const [falhas, setFalhas] = useState<Falha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!token) return;
    const t = token;
    // Sair da tela (ou "Tentar novamente") cancela as quatro listas: antes
    // a resposta de um Dashboard abandonado ainda era baixada inteira.
    const controle = new AbortController();
    const { signal } = controle;

    async function carregar() {
      setCarregando(true);
      setFalhas([]);
      try {
        await buscarIndicadores();
      } catch {
        // Qualquer coisa fora do previsto vira aviso com "Tentar novamente",
        // nunca um spinner eterno.
        if (!signal.aborted) setFalhas([{ rotulo: 'indicadores', mensagem: 'Ocorreu um erro inesperado.' }]);
      } finally {
        if (!signal.aborted) setCarregando(false);
      }
    }

    async function buscarIndicadores() {
      const [resDeps, resFunc, resRecrutamento, resAusencias] = await Promise.allSettled([
        lista(api.listarDepartamentos(t, signal)),
        lista(api.listarFuncionarios(t, signal)),
        lista(api.listarRecrutamentos(t, signal)),
        lista(api.listarAusenciasRh(t, undefined, signal)),
      ]);
      if (signal.aborted) return;

      // Lista que falhou fica null: a tela mostra "—", nunca um 0 falso.
      setDepartamentos(resDeps.status === 'fulfilled' ? resDeps.value : null);
      setFuncionarios(resFunc.status === 'fulfilled' ? resFunc.value : null);
      // Os registros de recrutamento são candidatos; "em processo" = ainda
      // sem decisão (em processo ou em entrevista).
      setCandidatosEmProcesso(
        resRecrutamento.status === 'fulfilled'
          ? resRecrutamento.value.filter(
              (r) => r.status === StatusRecrutamento.EmProcesso || r.status === StatusRecrutamento.Entrevista
            ).length
          : null
      );
      // Só as que ainda esperam decisão do RH.
      setJustificativasPendentes(
        resAusencias.status === 'fulfilled'
          ? resAusencias.value.filter((a) => a.status === StatusAusencia.Enviada || a.status === StatusAusencia.EmAnalise)
              .length
          : null
      );

      const resultados: [string, PromiseSettledResult<unknown>][] = [
        ['departamentos', resDeps],
        ['colaboradores', resFunc],
        ['candidatos', resRecrutamento],
        ['justificativas', resAusencias],
      ];
      setFalhas(
        resultados
          .filter(([, r]) => r.status === 'rejected')
          .map(([rotulo, r]) => {
            const motivo = (r as PromiseRejectedResult).reason;
            return { rotulo, mensagem: motivo instanceof ApiError ? motivo.message : 'Ocorreu um erro inesperado.' };
          })
      );
    }

    carregar();
    return () => controle.abort();
  }, [token, tentativa]);

  const totalAtivos = funcionarios ? funcionarios.filter((f) => f.status === StatusFuncionario.Ativo).length : null;

  const porDepartamento = departamentos?.map((dep) => ({
    id: dep.id,
    nome: dep.nome,
    quantidade: funcionarios
      ? funcionarios.filter((f) => f.departamentoId === dep.id && f.status === StatusFuncionario.Ativo).length
      : null,
  }));

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="m-0 text-2xl sm:text-3xl lg:text-[32px] text-gray-800 font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm sm:text-base text-gray-500">Visão geral dos recursos humanos da empresa</p>
      </div>

      {!carregando && falhas.length > 0 && (
        <div
          role="alert"
          className="mb-6 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="m-0 font-medium">Alguns indicadores não puderam ser carregados:</p>
            <ul className="m-0 mt-1 pl-5 list-disc">
              {falhas.map((f) => (
                <li key={f.rotulo} className="[overflow-wrap:anywhere]">
                  {f.rotulo}: {f.mensagem}
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => setTentativa((n) => n + 1)}
            className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-600 hover:bg-red-50 transition-colors shrink-0"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Tentar novamente
          </button>
        </div>
      )}

      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mb-6 sm:mb-8">
        <CardIndicador icone={Users} titulo="Total de Funcionários Ativos" valor={totalAtivos} carregando={carregando} />
        <CardIndicador
          icone={Briefcase}
          cor="#10b981"
          titulo="Candidatos em processo"
          valor={candidatosEmProcesso}
          detalhe="Em processo seletivo ou entrevista"
          carregando={carregando}
        />
        <CardIndicador
          icone={ClipboardCheck}
          cor="#8b5cf6"
          titulo="Justificativas pendentes"
          valor={justificativasPendentes}
          detalhe="Enviadas pelo app ou em análise"
          carregando={carregando}
        />
      </div>

      {/* Informações Adicionais */}
      <div className="card-simples">
        <h2 className="m-0 mb-5 text-lg sm:text-xl text-gray-800 pb-3 border-b-2 border-gray-200">
          Resumo dos Departamentos
        </h2>

        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Carregando departamentos…
          </div>
        ) : !porDepartamento ? (
          <p className="m-0 text-sm text-gray-500">Não foi possível carregar os departamentos.</p>
        ) : porDepartamento.length === 0 ? (
          <p className="m-0 text-sm text-gray-500">Nenhum departamento cadastrado.</p>
        ) : (
          <ul className="m-0 p-0 list-none grid grid-cols-1 gap-3 sm:gap-4">
            {porDepartamento.map((dep) => (
              <li key={dep.id} className="flex justify-between items-start gap-3 p-3 bg-gray-100 rounded-md min-w-0">
                {/* Nome longo sem espaço quebra dentro da linha, sem empurrar a contagem para fora da tela. */}
                <span className="font-medium min-w-0 flex-1 [overflow-wrap:anywhere]">{dep.nome}</span>
                <span className="text-blue-500 font-bold shrink-0 whitespace-nowrap">
                  {dep.quantidade === null ? (
                    <span title="Indisponível">
                      —<span className="sr-only"> (quantidade indisponível)</span>
                    </span>
                  ) : (
                    contarColaboradores(dep.quantidade)
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
