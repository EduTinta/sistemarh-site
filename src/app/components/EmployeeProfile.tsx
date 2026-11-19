import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  User,
  DollarSign,
  Briefcase,
  Clock,
  FileText,
  Printer,
  ShieldCheck,
  Utensils,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
} from 'lucide-react';
import '../styles/hr-system.css';
import { useAuth } from '../context/AuthContext';
import { useAvisos, useConfirmarSaida, useFocoAposEnvio } from '../context/AvisosContext';
import { api, ApiError } from '../../services/api';
import { TextoExpansivel } from './TextoExpansivel';
import {
  TipoAjusteRemuneracao,
  type AjusteRemuneracaoDto,
  type FolhaPagamentoDto,
  type FuncionarioDto,
  type PerfilUsuario,
  type UsuarioDto,
} from '../../types/api';
import { formatarDataCalendario, formatarDataHoraBrasilia } from '../../utils/datas';
import { formatarMoeda } from '../../utils/moeda';
import { formatarCpf } from '../../utils/cpf';
import { MENSAGEM_SENHA_ATUAL_OBRIGATORIA, SENHA_APP_MAXIMO, validarSenhaNova } from '../../utils/validacao';

type TabType = 'info' | 'salary' | 'position' | 'timebank' | 'payslip' | 'foodvoucher' | 'senha';

const MENSAGEM_RESPOSTA_INESPERADA = 'O servidor devolveu uma resposta inesperada. Tente novamente.';

// Formata um saldo em minutos como "+6h30" / "-2h15", igual ao app Flutter.
function formatarSaldoBancoHoras(minutos: number): string {
  const sinal = minutos < 0 ? '-' : '+';
  const total = Math.abs(minutos);
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return `${sinal}${horas}h${resto.toString().padStart(2, '0')}`;
}

// Os mesmos nomes de perfil da tela Permissões.
const NOME_PERFIL: Record<PerfilUsuario, string> = {
  Admin: 'Admin',
  Rh: 'RH',
  Funcionario: 'Funcionário',
};

const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

/** "2026-08" → "Agosto de 2026". */
function formatarCompetencia(competencia: string): string {
  const partes = competencia?.match(/^(\d{4})-(\d{2})/);
  const mes = partes ? MESES[Number(partes[2]) - 1] : undefined;
  return partes && mes ? `${mes} de ${partes[1]}` : competencia ?? '—';
}

/** Estado de uma carga: o que mostrar enquanto carrega, se deu certo e se falhou. */
type Carga<T> = { estado: 'carregando' } | { estado: 'ok'; dados: T } | { estado: 'erro'; mensagem: string; status: number };

function cargaDoResultado<T>(resultado: PromiseSettledResult<T>, padrao: string): Carga<T> {
  if (resultado.status === 'fulfilled') return { estado: 'ok', dados: resultado.value };
  const erro = resultado.reason;
  return {
    estado: 'erro',
    mensagem: erro instanceof ApiError ? erro.message : padrao,
    status: erro instanceof ApiError ? erro.status : 0,
  };
}

// Uma resposta 200 que não é lista vira erro de carga, em vez de quebrar a tela.
async function lista<T>(promessa: Promise<T[]>): Promise<T[]> {
  const valor = await promessa;
  if (!Array.isArray(valor)) throw new ApiError(0, MENSAGEM_RESPOSTA_INESPERADA);
  return valor;
}

function usuarioValido(valor: unknown): valor is UsuarioDto {
  return !!valor && typeof valor === 'object' && typeof (valor as UsuarioDto).nome === 'string';
}

/**
 * Imprime um holerite sozinho, sem o menu nem as outras abas. O bloco é
 * montado fora do #root com textContent (nunca HTML), e o CSS de impressão
 * (hr-system.css) esconde o resto da página só enquanto ele existe.
 */
function imprimirHolerite(holerite: FolhaPagamentoDto, nome: string, cadastro: FuncionarioDto | null) {
  document.querySelectorAll('.impressao-holerite').forEach((el) => el.remove());

  const area = document.createElement('div');
  area.className = 'impressao-holerite';
  const adicionar = (tag: string, texto: string, estilo = '') => {
    const el = document.createElement(tag);
    el.textContent = texto;
    if (estilo) el.setAttribute('style', estilo);
    area.appendChild(el);
  };

  adicionar('h1', `Holerite · ${formatarCompetencia(holerite.competencia)}`, 'font-size:20px;margin:0 0 4px');
  adicionar('p', 'HumanConnect · Gestão de Pessoas', 'margin:0 0 16px;color:#6b7280');
  adicionar('p', `Colaborador: ${nome}`, 'margin:0');
  if (cadastro) {
    adicionar('p', `CPF: ${formatarCpf(cadastro.cpf ?? '') || '—'}`, 'margin:0');
    adicionar('p', `Cargo: ${cadastro.cargoNome} · ${cadastro.departamentoNome}`, 'margin:0 0 16px');
  }
  const linhas: [string, string][] = [
    ['Salário bruto', formatarMoeda(holerite.salario)],
    ['Bônus', formatarMoeda(holerite.bonus)],
    ['Descontos', formatarMoeda(holerite.descontos)],
    ['Salário líquido', formatarMoeda(holerite.salarioLiquido)],
    ['Data de pagamento', formatarDataCalendario(holerite.dataPagamento) ?? 'Não informada'],
  ];
  for (const [rotulo, valor] of linhas) {
    adicionar('p', `${rotulo}: ${valor}`, 'margin:4px 0');
  }

  document.body.appendChild(area);
  document.body.classList.add('imprimindo-holerite');
  const limpar = () => {
    document.body.classList.remove('imprimindo-holerite');
    area.remove();
    window.removeEventListener('afterprint', limpar);
  };
  window.addEventListener('afterprint', limpar);
  window.print();
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-sm text-muted-foreground">{rotulo}</p>
      <p className="m-0 mt-1 [overflow-wrap:anywhere]">{children}</p>
    </div>
  );
}

function Carregando({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      {texto}
    </div>
  );
}

function ErroCarga({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm"
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{mensagem}</span>
      <button
        type="button"
        onClick={onTentar}
        className="px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-600 hover:bg-red-50 transition-colors shrink-0"
      >
        Tentar novamente
      </button>
    </div>
  );
}

type CampoSenha = 'atual' | 'nova' | 'confirmacao';

/**
 * Troca da própria senha (qualquer perfil). A API confere a senha atual,
 * derruba as outras sessões e devolve um token novo, que esta aba passa a
 * usar (e as outras abas recebem pelo `storage`), sem voltar ao login.
 */
function AlterarSenha() {
  const { token, atualizarToken } = useAuth();
  const { avisarGlobal } = useAvisos();
  const focarAposEnvio = useFocoAposEnvio();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<{ campo: CampoSenha | null; mensagem: string } | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  // Trava síncrona contra envio duplo (o estado só vale no próximo render).
  const enviandoRef = useRef(false);
  const montadaRef = useRef(true);
  const refs = {
    atual: useRef<HTMLInputElement>(null),
    nova: useRef<HTMLInputElement>(null),
    confirmacao: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    montadaRef.current = true;
    return () => {
      montadaRef.current = false;
    };
  }, []);

  // Sair com algo digitado pergunta antes; durante o envio não, porque o
  // resultado chega pelo aviso global.
  useConfirmarSaida(
    !enviando && (senhaAtual !== '' || novaSenha !== '' || confirmacao !== ''),
    'A troca de senha não foi concluída. Sair e descartar o que foi digitado?'
  );

  function mostrarErro(campo: CampoSenha | null, mensagem: string) {
    setErro({ campo, mensagem });
    if (campo) refs[campo].current?.focus();
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!token || enviandoRef.current) return;
    setSucesso(null);

    // Mesmas regras e mensagens da API: senha atual informada, regras de
    // senha e nova diferente da atual.
    const erroNova = validarSenhaNova(novaSenha, { senhaAtual });
    if (erroNova) {
      mostrarErro(erroNova === MENSAGEM_SENHA_ATUAL_OBRIGATORIA ? 'atual' : 'nova', erroNova);
      return;
    }
    if (confirmacao !== novaSenha) {
      mostrarErro('confirmacao', 'A confirmação não é igual à nova senha.');
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    setErro(null);
    // Os campos ficam desabilitados durante o envio e o foco cai no BODY; ele
    // volta (no campo com erro ou na mensagem de sucesso) só depois de os
    // campos serem reabilitados, no fim.
    let focarDepois: string | null = null;
    try {
      const { token: novoToken } = await api.alterarMinhaSenha(token, { senhaAtual, novaSenha });
      // A troca derruba todos os tokens antigos, inclusive o desta aba.
      atualizarToken(novoToken);
      const texto = 'Senha alterada. As sessões abertas em outros aparelhos foram encerradas.';
      if (!montadaRef.current) {
        avisarGlobal(texto, 'sucesso');
        return;
      }
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmacao('');
      setMostrar(false);
      setSucesso(texto);
      focarDepois = 'sucesso-alterar-senha';
    } catch (falha) {
      const mensagem = falha instanceof ApiError ? falha.message : 'Não foi possível alterar a senha.';
      if (!montadaRef.current) {
        avisarGlobal(`Troca de senha: ${mensagem}`, 'erro');
        return;
      }
      // 400 "Senha atual incorreta." aponta o campo da senha atual; outras
      // recusas de 400 são da nova senha. 429 (tentativas demais) e 403 vêm
      // sem campo.
      const status = falha instanceof ApiError ? falha.status : 0;
      const campo: CampoSenha | null =
        status === 400 ? (/atual/i.test(mensagem) && !/diferente/i.test(mensagem) ? 'atual' : 'nova') : null;
      setErro({ campo, mensagem });
      focarDepois = campo ? `senha-${campo}` : 'erro-alterar-senha';
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
      if (focarDepois) focarAposEnvio(focarDepois);
    }
  }

  const campos: { id: CampoSenha; rotulo: string; valor: string; alterar: (v: string) => void; autoComplete: string }[] = [
    { id: 'atual', rotulo: 'Senha atual', valor: senhaAtual, alterar: setSenhaAtual, autoComplete: 'current-password' },
    { id: 'nova', rotulo: 'Nova senha', valor: novaSenha, alterar: setNovaSenha, autoComplete: 'new-password' },
    {
      id: 'confirmacao',
      rotulo: 'Confirme a nova senha',
      valor: confirmacao,
      alterar: setConfirmacao,
      autoComplete: 'new-password',
    },
  ];

  return (
    <form onSubmit={enviar} noValidate className="space-y-4 max-w-md" aria-labelledby="titulo-alterar-senha">
      <div>
        <h2 id="titulo-alterar-senha" className="text-xl">
          Alterar senha
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          De 6 a {SENHA_APP_MAXIMO} caracteres, sem emoji e sem espaço no começo ou no fim. Ao trocar, as sessões
          abertas em outros aparelhos são encerradas; esta continua.
        </p>
      </div>

      {campos.map((c) => {
        const idCampo = `senha-${c.id}`;
        const comErro = erro?.campo === c.id;
        return (
          <div key={c.id}>
            <label htmlFor={idCampo} className="block text-sm text-gray-700 font-medium mb-1">
              {c.rotulo}
            </label>
            <input
              ref={refs[c.id]}
              id={idCampo}
              type={mostrar ? 'text' : 'password'}
              value={c.valor}
              onChange={(e) => c.alterar(e.target.value)}
              autoComplete={c.autoComplete}
              // O limite real (64 caracteres) é conferido no envio; o
              // maxLength do navegador conta em UTF-16.
              maxLength={SENHA_APP_MAXIMO * 2}
              disabled={enviando}
              aria-invalid={comErro || undefined}
              aria-describedby={comErro ? `erro-${idCampo}` : undefined}
              className={`w-full px-4 py-2 bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary ${
                comErro ? 'border-red-400' : 'border-border'
              }`}
            />
            {/* O erro fica logo abaixo do campo a que se refere. */}
            {comErro && (
              <p id={`erro-${idCampo}`} role="alert" className="m-0 mt-1 text-sm text-red-600 [overflow-wrap:anywhere]">
                {erro.mensagem}
              </p>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setMostrar((v) => !v)}
        aria-pressed={mostrar}
        className="flex items-center gap-2 text-sm text-primary hover:underline"
      >
        {mostrar ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        {mostrar ? 'Ocultar senhas' : 'Mostrar senhas'}
      </button>

      {/* Erros sem campo (429, 403, rede) ficam perto do botão. */}
      {erro && erro.campo === null && (
        <p
          id="erro-alterar-senha"
          role="alert"
          tabIndex={-1}
          className="m-0 text-sm text-red-600 [overflow-wrap:anywhere] focus:outline-none"
        >
          {erro.mensagem}
        </p>
      )}
      {sucesso && (
        <p
          id="sucesso-alterar-senha"
          role="status"
          tabIndex={-1}
          className="m-0 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
        >
          {sucesso}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60 w-full sm:w-auto"
      >
        {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
        Alterar senha
      </button>
    </form>
  );
}

function Cabecalho() {
  return (
    <div className="mb-6 sm:mb-8">
      <h1 className="text-2xl sm:text-3xl mb-2">Meus Dados</h1>
      <p className="text-sm sm:text-base text-muted-foreground">Suas informações pessoais e profissionais</p>
    </div>
  );
}

export function EmployeeProfile() {
  const { usuario: usuarioDaSessao, token } = useAuth();
  // O /auth/me da sessão é de quando a pessoa entrou; busca de novo para o
  // saldo do banco de horas e os demais dados estarem atualizados.
  const [usuarioAtual, setUsuarioAtual] = useState<UsuarioDto | null>(null);
  const usuario = usuarioAtual ?? usuarioDaSessao;

  useEffect(() => {
    if (!token) return;
    // Sair da tela antes da resposta cancela a requisição.
    const controle = new AbortController();
    api
      .me(token, controle.signal)
      .then((dados) => {
        if (!controle.signal.aborted && usuarioValido(dados)) setUsuarioAtual(dados);
      })
      .catch(() => undefined);
    return () => controle.abort();
  }, [token]);

  if (!usuario) return null;

  // Contas de acesso ao sistema (ex.: Admin/RH) podem não estar ligadas a um
  // cadastro de colaborador — aí não existe salário, holerite nem vale.
  if (usuario.funcionarioId === null) return <ContaSemVinculo usuario={usuario} />;
  return <DadosDoColaborador usuario={usuario} />;
}

/** Conta sem cadastro de colaborador: mostra o que o /auth/me tem da própria conta. */
function ContaSemVinculo({ usuario, aviso }: { usuario: UsuarioDto; aviso?: string }) {
  const { perfil } = useAuth();
  const cargo = usuario.cargo?.trim();
  const departamento = usuario.departamento?.trim();
  const mostrarSaldo = perfil === 'Funcionario' || usuario.saldoBancoHorasMinutos !== 0;

  return (
    <div className="w-full max-w-7xl mx-auto animate-fade-in">
      <Cabecalho />
      <div className="hr-card p-4 sm:p-6 space-y-6">
        <h2 className="text-xl">Dados da Conta</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Campo rotulo="Nome">{usuario.nome}</Campo>
          <Campo rotulo="E-mail">
            <span className="break-all">{usuario.email}</span>
          </Campo>
          <Campo rotulo="Perfil de Acesso">{perfil ? NOME_PERFIL[perfil] : 'Não informado'}</Campo>
          {cargo && <Campo rotulo="Cargo">{cargo}</Campo>}
          {departamento && <Campo rotulo="Departamento">{departamento}</Campo>}
          {mostrarSaldo && <Campo rotulo="Saldo do banco de horas">{formatarSaldoBancoHoras(usuario.saldoBancoHorasMinutos)}</Campo>}
        </div>
        <div className="flex gap-3 p-4 bg-primary/5 rounded-lg border border-primary/20">
          <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-muted-foreground m-0">
            {aviso ??
              'Esta conta não está ligada a um cadastro de colaborador. Por isso não há salário, holerite nem vale alimentação para exibir.'}
          </p>
        </div>
      </div>
      <div className="hr-card p-4 sm:p-6 mt-6">
        <AlterarSenha />
      </div>
    </div>
  );
}

function DadosDoColaborador({ usuario }: { usuario: UsuarioDto }) {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('info');
  const [cadastro, setCadastro] = useState<Carga<FuncionarioDto>>({ estado: 'carregando' });
  const [holerites, setHolerites] = useState<Carga<FolhaPagamentoDto[]>>({ estado: 'carregando' });
  const [ajustes, setAjustes] = useState<Carga<AjusteRemuneracaoDto[]>>({ estado: 'carregando' });
  const [tentativa, setTentativa] = useState(0);

  // Tudo vem das rotas /api/me/*, que valem para qualquer perfil com
  // colaborador ligado (antes o Funcionário via "Não informado" no CPF etc.,
  // porque o cadastro só era buscado pela rota de RH).
  useEffect(() => {
    if (!token) return;
    const t = token;
    // Sair da tela (ou "Tentar novamente") cancela as três cargas.
    const controle = new AbortController();
    const { signal } = controle;
    setCadastro({ estado: 'carregando' });
    setHolerites({ estado: 'carregando' });
    setAjustes({ estado: 'carregando' });

    Promise.allSettled([
      api.obterMeuCadastro(t, signal).then((dados) => {
        if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new ApiError(0, MENSAGEM_RESPOSTA_INESPERADA);
        return dados;
      }),
      lista(api.listarMeusHolerites(t, signal)),
      lista(api.listarMeusAjustesRemuneracao(t, signal)),
    ]).then(([resCadastro, resHolerites, resAjustes]) => {
      if (signal.aborted) return;
      setCadastro(cargaDoResultado(resCadastro, 'Não foi possível carregar o seu cadastro.'));
      setHolerites(cargaDoResultado(resHolerites, 'Não foi possível carregar os holerites.'));
      setAjustes(cargaDoResultado(resAjustes, 'Não foi possível carregar o histórico do vale.'));
    });

    return () => controle.abort();
  }, [token, tentativa]);

  const tentarDeNovo = () => setTentativa((n) => n + 1);

  // O vínculo pode ter sido desfeito depois do login.
  if (cadastro.estado === 'erro' && cadastro.status === 404) {
    return <ContaSemVinculo usuario={usuario} aviso={cadastro.mensagem} />;
  }

  const dados = cadastro.estado === 'ok' ? cadastro.dados : null;
  // Enquanto o cadastro carrega (ou se falhar), o que dá vem do /auth/me.
  const valorDoCadastro = (valor: string | null | undefined, vazio = 'Não informado') =>
    cadastro.estado === 'carregando' ? 'Carregando…' : cadastro.estado === 'erro' ? '—' : valor?.trim() || vazio;

  const tabs = [
    { id: 'info' as const, label: 'Informações', icon: User },
    { id: 'salary' as const, label: 'Salário', icon: DollarSign },
    { id: 'position' as const, label: 'Cargo', icon: Briefcase },
    { id: 'timebank' as const, label: 'Banco de Horas', icon: Clock },
    { id: 'payslip' as const, label: 'Holerite', icon: FileText },
    { id: 'foodvoucher' as const, label: 'Vale Alimentação', icon: Utensils },
    { id: 'senha' as const, label: 'Senha', icon: KeyRound },
  ];

  const historicoVale =
    ajustes.estado === 'ok' ? ajustes.dados.filter((a) => a.tipo === TipoAjusteRemuneracao.ValeAlimentacao) : [];
  const holeritesOrdenados =
    holerites.estado === 'ok'
      ? [...holerites.dados].sort((a, b) => (b.competencia ?? '').localeCompare(a.competencia ?? ''))
      : [];

  return (
    <div className="w-full max-w-7xl mx-auto animate-fade-in">
      <Cabecalho />

      {cadastro.estado === 'erro' && (
        <div className="mb-6">
          <ErroCarga mensagem={cadastro.mensagem} onTentar={tentarDeNovo} />
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="mb-6 border-b border-border overflow-x-auto -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
        <div className="flex gap-1 min-w-max" role="group" aria-label="Seções de Meus Dados">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const ativa = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={ativa}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
                  ativa
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="hr-card p-4 sm:p-6 min-w-0">
        {activeTab === 'info' && (
          <div className="space-y-6">
            {/* O total vem do /auth/me e conta todas as justificativas, inclusive
                as que o RH já aprovou ou recusou — por isso não se chama "abertas". */}
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 text-sm text-muted-foreground">Justificativas enviadas pelo app</p>
                <p className="m-0 text-xs text-muted-foreground mt-0.5">Total, incluindo as que o RH já respondeu</p>
              </div>
              <p className="m-0 text-2xl text-primary shrink-0">{usuario.totalSolicitacoesAusencia ?? 0}</p>
            </div>

            <div>
              <h2 className="text-xl mb-4">Informações Pessoais</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <Campo rotulo="Nome Completo">{dados?.nome ?? usuario.nome}</Campo>
                <Campo rotulo="Data de Nascimento">
                  {cadastro.estado === 'ok' ? formatarDataCalendario(dados?.dataNascimento) ?? 'Não informado' : valorDoCadastro(null)}
                </Campo>
                <Campo rotulo="E-mail">
                  <span className="break-all">{usuario.email}</span>
                </Campo>
                <Campo rotulo="Telefone">{valorDoCadastro(dados?.telefone)}</Campo>
                <Campo rotulo="CPF">{valorDoCadastro(dados ? formatarCpf(dados.cpf ?? '') : null)}</Campo>
                <Campo rotulo="Data de Admissão">
                  {formatarDataCalendario(dados?.dataAdmissao ?? usuario.dataAdmissao) ?? 'Não informado'}
                </Campo>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'salary' && (
          <div className="space-y-6">
            <h2 className="text-xl mb-4">Informações Salariais</h2>
            {cadastro.estado === 'carregando' ? (
              <Carregando texto="Carregando salário…" />
            ) : cadastro.estado === 'erro' ? (
              <p className="m-0 text-sm text-muted-foreground">O salário aparece aqui quando o cadastro carregar.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <div className="p-4 sm:p-6 bg-primary/5 rounded-lg border border-primary/20 min-w-0">
                  <p className="text-sm text-muted-foreground mb-2">Salário</p>
                  <p className="text-xl sm:text-2xl text-primary [overflow-wrap:anywhere]">{formatarMoeda(dados?.salario)}</p>
                </div>
                <div className="p-4 sm:p-6 bg-accent/50 rounded-lg border border-border min-w-0">
                  <p className="text-sm text-muted-foreground mb-2">Vale Alimentação</p>
                  <p className="text-xl sm:text-2xl [overflow-wrap:anywhere]">{formatarMoeda(dados?.valeAlimentacao)}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'position' && (
          <div className="space-y-6">
            <h2 className="text-xl mb-4">Informações do Cargo</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div className="p-4 sm:p-6 bg-accent/30 rounded-lg border border-border min-w-0">
                <p className="m-0 text-sm text-muted-foreground">Cargo Atual</p>
                <p className="m-0 text-lg sm:text-xl mt-2 [overflow-wrap:anywhere]">
                  {dados?.cargoNome || usuario.cargo || 'Não informado'}
                </p>
              </div>
              <div className="p-4 sm:p-6 bg-accent/30 rounded-lg border border-border min-w-0">
                <p className="m-0 text-sm text-muted-foreground">Departamento</p>
                <p className="m-0 text-lg sm:text-xl mt-2 [overflow-wrap:anywhere]">
                  {dados?.departamentoNome || usuario.departamento || 'Não informado'}
                </p>
              </div>
            </div>

            <div className="p-4 sm:p-6 bg-accent/30 rounded-lg border border-border min-w-0">
              <p className="m-0 text-sm text-muted-foreground">Gestor Direto</p>
              <p className="m-0 text-lg sm:text-xl mt-2 [overflow-wrap:anywhere]">
                {(dados ? dados.gerenteNome : usuario.gerenteNome) || 'Sem gestor definido'}
              </p>
            </div>
          </div>
        )}

        {activeTab === 'timebank' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
              <div>
                <h2 className="text-xl">Banco de Horas</h2>
                <p className="text-muted-foreground text-sm mt-1">Acompanhe seu saldo de horas</p>
              </div>
              <div className="sm:text-right">
                <p className="text-sm text-muted-foreground">Saldo Atual</p>
                <p className="text-2xl text-primary">{formatarSaldoBancoHoras(usuario.saldoBancoHorasMinutos)}</p>
              </div>
            </div>

            <div className="p-4 sm:p-6 bg-accent/30 rounded-lg border border-border">
              <p className="m-0 text-sm text-muted-foreground">
                O saldo é a soma dos créditos e débitos lançados pelo RH no seu cadastro. Para ver o extrato lançamento
                por lançamento, fale com o RH.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'payslip' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl">Holerites</h2>
              <p className="text-muted-foreground text-sm mt-1">Folhas de pagamento lançadas pelo RH</p>
            </div>

            {holerites.estado === 'carregando' ? (
              <Carregando texto="Carregando holerites…" />
            ) : holerites.estado === 'erro' ? (
              <ErroCarga mensagem={holerites.mensagem} onTentar={tentarDeNovo} />
            ) : holeritesOrdenados.length === 0 ? (
              <div className="p-6 rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
                Nenhum holerite lançado para você ainda.
              </div>
            ) : (
              <div className="space-y-4">
                {holeritesOrdenados.map((h) => (
                  <div key={h.id} className="p-4 sm:p-6 bg-accent/30 rounded-lg border border-border min-w-0">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
                      <div className="min-w-0">
                        <h3 className="text-lg">{formatarCompetencia(h.competencia)}</h3>
                        <p className="m-0 text-sm text-muted-foreground">
                          {h.dataPagamento
                            ? `Pago em ${formatarDataCalendario(h.dataPagamento) ?? '—'}`
                            : 'Data de pagamento não informada'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => imprimirHolerite(h, dados?.nome ?? usuario.nome, dados)}
                        aria-label={`Imprimir holerite de ${formatarCompetencia(h.competencia)}`}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity w-full sm:w-auto"
                      >
                        <Printer className="w-4 h-4" aria-hidden="true" />
                        <span>Imprimir</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <Campo rotulo="Salário Bruto">{formatarMoeda(h.salario)}</Campo>
                      <Campo rotulo="Bônus">{formatarMoeda(h.bonus)}</Campo>
                      <Campo rotulo="Descontos">
                        <span className="text-red-600">{formatarMoeda(h.descontos)}</span>
                      </Campo>
                      <Campo rotulo="Salário Líquido">
                        <span className="text-green-600">{formatarMoeda(h.salarioLiquido)}</span>
                      </Campo>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'foodvoucher' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <h2 className="text-xl">Vale Alimentação</h2>
                <p className="text-muted-foreground text-sm mt-1">Valor atual e histórico de alterações</p>
              </div>
              <div className="sm:text-right">
                <p className="text-sm text-muted-foreground">Valor atual</p>
                <p className="text-2xl text-primary">
                  {cadastro.estado === 'ok' ? formatarMoeda(dados?.valeAlimentacao) : valorDoCadastro(null)}
                </p>
              </div>
            </div>

            {ajustes.estado === 'carregando' ? (
              <Carregando texto="Carregando histórico…" />
            ) : ajustes.estado === 'erro' ? (
              <ErroCarga mensagem={ajustes.mensagem} onTentar={tentarDeNovo} />
            ) : historicoVale.length === 0 ? (
              <div className="p-6 rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
                Nenhuma alteração no vale alimentação foi registrada.
              </div>
            ) : (
              <ul className="m-0 p-0 list-none space-y-3">
                {historicoVale.map((a) => (
                  <li key={a.id} className="p-4 bg-accent/30 rounded-lg border border-border min-w-0">
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-3">
                      <p className="m-0 font-medium [overflow-wrap:anywhere]">
                        {formatarMoeda(a.valorAnterior)} → {formatarMoeda(a.valorNovo)}
                      </p>
                      <p className="m-0 text-sm text-muted-foreground shrink-0">
                        A partir de {formatarDataCalendario(a.dataVigencia) ?? '—'}
                      </p>
                    </div>
                    {a.motivo?.trim() && (
                      <div className="mt-2">
                        <TextoExpansivel texto={a.motivo} alturaMaxima={120} className="m-0 text-sm text-muted-foreground" />
                      </div>
                    )}
                    {/* Nome do responsável longo sem espaço quebra dentro do item. */}
                    <p className="m-0 mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      Registrado em {formatarDataHoraBrasilia(a.criadoEm)}
                      {a.responsavelNome ? ` por ${a.responsavelNome}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'senha' && <AlterarSenha />}
      </div>
    </div>
  );
}
