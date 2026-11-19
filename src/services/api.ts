// Cliente HTTP simples pro backend .NET (SistemaRH.Backend). Usa fetch puro
// (sem axios) e lança um erro com a mensagem amigável que a API devolve em
// `{ mensagem: "..." }` nas respostas de erro (ver ExceptionMiddleware no backend).

import type {
  AjusteRemuneracaoDto,
  AjusteSalarioDto,
  AjusteValeAlimentacaoDto,
  AlterarMinhaSenhaDto,
  AlterarMinhaSenhaRespostaDto,
  AlterarPerfilUsuarioDto,
  ApiErrorBody,
  AusenciaRhDto,
  AuthResponseDto,
  CargoDto,
  DepartamentoCreateDto,
  DepartamentoDto,
  DesligamentoResultadoDto,
  DesligarFuncionarioDto,
  ExtratoBancoHorasDto,
  FolhaPagamentoDto,
  FuncionarioCreateDto,
  FuncionarioDto,
  FuncionarioUpdateDto,
  MensagemRhCreateDto,
  MensagemRhDto,
  PromocaoDto,
  PromocaoResultadoDto,
  RecrutamentoDto,
  ResponderMensagemRhDto,
  StatusAusencia,
  StatusMensagemRh,
  UsuarioDto,
  UsuarioListaDto,
} from '../types/api';

// Backend publicado na Railway (endereço fixo). Pra apontar pro backend
// rodando localmente, troque por http://localhost:5080.
const BASE_URL = 'https://backend-production-b0a758c2.up.railway.app';

// Tempo máximo de espera por uma resposta. Sem ele, um backend travado
// deixava o spinner rodando para sempre (o fetch não tem timeout próprio).
const TEMPO_LIMITE_MS = 20_000;

export class ApiError extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

// Sessão derrubada pelo backend (token vencido, logout em outra aba, troca de
// perfil, desligamento...). Quando o 401 traz `{ mensagem }`, vale a dele.
export const MENSAGEM_SESSAO_ENCERRADA = 'Sua sessão foi encerrada. Entre novamente.';
/** @deprecated Use MENSAGEM_SESSAO_ENCERRADA; mantida para quem ainda importa o nome antigo. */
export const MENSAGEM_SESSAO_EXPIRADA = MENSAGEM_SESSAO_ENCERRADA;
export const MENSAGEM_CONFLITO = 'Este registro foi alterado por outra pessoa. Atualize a tela e tente de novo.';
const MENSAGEM_SEM_CONEXAO = 'Não foi possível conectar ao servidor.';
const MENSAGEM_TEMPO_ESGOTADO = 'O servidor demorou demais para responder. Tente novamente.';
const MENSAGEM_ERRO_SERVIDOR = 'Ocorreu um erro no servidor. Tente novamente.';
const MENSAGEM_SERVIDOR_INDISPONIVEL = 'O servidor está indisponível no momento. Tente novamente em instantes.';
const MENSAGEM_RESPOSTA_INVALIDA = 'O servidor devolveu uma resposta inesperada. Tente novamente.';

// Mensagens usadas quando o backend responde sem o `{ mensagem }` no corpo
// (ex.: a policy "RhOuAdmin" devolve 403 vazio).
const MENSAGEM_POR_STATUS: Record<number, string> = {
  400: 'Não foi possível concluir a operação. Confira os dados e tente novamente.',
  403: 'Você não tem permissão para acessar este recurso.',
  404: 'Registro não encontrado.',
  409: MENSAGEM_CONFLITO,
  413: 'Os dados enviados são grandes demais.',
  415: 'Formato de dados não suportado.',
  429: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
};

/** Um 409 da API: outra pessoa gravou antes (versão) ou o registro já existe. */
export function ehConflito(erro: unknown): erro is ApiError {
  return erro instanceof ApiError && erro.status === 409;
}

// Chamado quando uma requisição autenticada volta 401 (token expirado,
// inválido ou revogado no logout/desligamento/troca de perfil). Quem registra
// é o AuthContext, que encerra a sessão — o módulo da API não conhece o
// React. Recebe o token usado na requisição e a `mensagem` do backend, quando
// houver, para a tela de login dizer o motivo certo (e não sempre "expirou").
type HandlerNaoAutorizado = (tokenUsado: string, mensagem?: string) => void;
let handlerNaoAutorizado: HandlerNaoAutorizado | null = null;

export function definirHandlerNaoAutorizado(handler: HandlerNaoAutorizado | null) {
  handlerNaoAutorizado = handler;
}

function mensagemDoCorpo(data: unknown): string | null {
  if (data && typeof data === 'object') {
    const mensagem = (data as Partial<ApiErrorBody>).mensagem;
    if (typeof mensagem === 'string' && mensagem.trim()) return mensagem;
  }
  return null;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal } = {}
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  // O AbortController cobre o tempo limite e, se quem chamou passar um
  // `signal`, também o cancelamento (ex.: a tela foi trocada no meio).
  const controle = new AbortController();
  let esgotouTempo = false;
  const temporizador = setTimeout(() => {
    esgotouTempo = true;
    controle.abort();
  }, TEMPO_LIMITE_MS);
  const cancelarExterno = () => controle.abort();
  if (options.signal?.aborted) controle.abort();
  options.signal?.addEventListener('abort', cancelarExterno);

  try {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controle.signal,
      });
    } catch (e) {
      if (esgotouTempo) throw new ApiError(0, MENSAGEM_TEMPO_ESGOTADO);
      // Cancelado por quem chamou: repassa o AbortError para a tela ignorar.
      if (options.signal?.aborted) throw e;
      throw new ApiError(0, MENSAGEM_SEM_CONEXAO);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    // O login também responde 401 (senha errada), mas aí a mensagem do backend
    // é a que importa — só derruba a sessão quando havia um token. O corpo é
    // lido para repassar o motivo que o backend deu (ex.: "Seu perfil de acesso
    // mudou").
    if (response.status === 401 && options.token) {
      let mensagem: string | null = null;
      try {
        const corpo = await response.text();
        mensagem = corpo.trim() ? mensagemDoCorpo(JSON.parse(corpo)) : null;
      } catch {
        mensagem = null;
      }
      handlerNaoAutorizado?.(options.token, mensagem ?? undefined);
      throw new ApiError(401, mensagem ?? MENSAGEM_SESSAO_ENCERRADA);
    }

    // Lê como texto e só depois tenta o JSON: assim uma página HTML (túnel
    // fora do ar, proxy) ou um corpo quebrado não vira `undefined` em silêncio.
    let texto = '';
    try {
      texto = await response.text();
    } catch {
      if (esgotouTempo) throw new ApiError(0, MENSAGEM_TEMPO_ESGOTADO);
      if (options.signal?.aborted) throw new DOMException('Requisição cancelada.', 'AbortError');
      throw new ApiError(0, MENSAGEM_SEM_CONEXAO);
    }
    let data: unknown = undefined;
    let jsonValido = true;
    if (texto.trim()) {
      try {
        data = JSON.parse(texto);
      } catch {
        jsonValido = false;
      }
    }

    if (!response.ok) {
      // Sempre que o backend explicou o erro, a mensagem dele é a melhor.
      const mensagem = mensagemDoCorpo(data);
      if (mensagem) throw new ApiError(response.status, mensagem);

      if (response.status >= 500) {
        // 502/503/504 e os 52x do Cloudflare: o backend nem chegou a responder.
        const indisponivel = response.status === 502 || response.status === 503 || response.status === 504 || response.status >= 520;
        throw new ApiError(response.status, indisponivel ? MENSAGEM_SERVIDOR_INDISPONIVEL : MENSAGEM_ERRO_SERVIDOR);
      }
      if (response.status === 401) {
        throw new ApiError(401, 'E-mail ou senha inválidos.');
      }
      throw new ApiError(response.status, MENSAGEM_POR_STATUS[response.status] ?? MENSAGEM_POR_STATUS[400]);
    }

    if (!jsonValido) {
      throw new ApiError(response.status, MENSAGEM_RESPOSTA_INVALIDA);
    }
    return data as T;
  } finally {
    clearTimeout(temporizador);
    options.signal?.removeEventListener('abort', cancelarExterno);
  }
}

// Durante a troca de versão do backend, a rota pode ainda devolver só o
// FuncionarioDto. Aceita os dois formatos para a tela não quebrar.
function ehFuncionarioDto(valor: unknown): valor is FuncionarioDto {
  return !!valor && typeof valor === 'object' && 'id' in valor && 'cpf' in valor;
}

export const api = {
  login: async (email: string, senha: string) => {
    const resposta = await request<AuthResponseDto>('/api/auth/login', { method: 'POST', body: { email, senha } });
    // Sem token não há sessão: uma resposta `{}` não pode "entrar" como Usuário.
    if (!resposta || typeof resposta.token !== 'string' || !resposta.token || !resposta.usuario) {
      throw new ApiError(0, MENSAGEM_RESPOSTA_INVALIDA);
    }
    return resposta;
  },

  /**
   * Troca a própria senha confirmando a atual. Devolve um token novo: os
   * antigos (inclusive o desta requisição) deixam de valer. Senha atual errada
   * dá 400 "Senha atual incorreta." e conta no limite de tentativas do login (429).
   */
  alterarMinhaSenha: async (token: string, dto: AlterarMinhaSenhaDto) => {
    const resposta = await request<AlterarMinhaSenhaRespostaDto>('/api/auth/senha', { method: 'PUT', body: dto, token });
    // Sem token novo a sessão cairia no próximo clique: trata como resposta inválida.
    if (!resposta || typeof resposta.token !== 'string' || !resposta.token) {
      throw new ApiError(0, MENSAGEM_RESPOSTA_INVALIDA);
    }
    return resposta;
  },

  /** Invalida todos os tokens do usuário no backend (responde 204). */
  logout: (token: string) => request<void>('/api/auth/logout', { method: 'POST', body: {}, token }),

  me: (token: string, signal?: AbortSignal) => request<UsuarioDto>('/api/auth/me', { token, signal }),

  // ── Dados do próprio usuário (qualquer perfil) ─────────────────────────

  /** Cadastro do colaborador ligado à conta; 404 se a conta não tiver vínculo. */
  obterMeuCadastro: (token: string, signal?: AbortSignal) =>
    request<FuncionarioDto>('/api/me/cadastro', { token, signal }),

  /** Histórico de remuneração da própria pessoa, mais recentes primeiro. */
  listarMeusAjustesRemuneracao: (token: string, signal?: AbortSignal) =>
    request<AjusteRemuneracaoDto[]>('/api/me/ajustes-remuneracao', { token, signal }),

  /** Holerites da própria pessoa, da competência mais recente para a mais antiga. */
  listarMeusHolerites: (token: string, signal?: AbortSignal) =>
    request<FolhaPagamentoDto[]>('/api/me/holerites', { token, signal }),

  // ── Usuários e perfis de acesso ─────────────────────────────────────────

  /** Contas de acesso (RH ou Admin). */
  listarUsuarios: (token: string, signal?: AbortSignal) => request<UsuarioListaDto[]>('/api/usuarios', { token, signal }),

  /** Troca o perfil de uma conta (só Admin). Devolve o item atualizado. */
  alterarPerfilUsuario: (token: string, usuarioId: number, dto: AlterarPerfilUsuarioDto) =>
    request<UsuarioListaDto>(`/api/usuarios/${usuarioId}/perfil`, { method: 'PUT', body: dto, token }),

  // ── Colaboradores ───────────────────────────────────────────────────────

  listarFuncionarios: (token: string, signal?: AbortSignal) =>
    request<FuncionarioDto[]>('/api/funcionarios', { token, signal }),

  obterFuncionario: (token: string, id: number, signal?: AbortSignal) =>
    request<FuncionarioDto>(`/api/funcionarios/${id}`, { token, signal }),

  // O `signal` opcional cancela o GET quando a tela é fechada antes da resposta.
  listarDepartamentos: (token: string, signal?: AbortSignal) =>
    request<DepartamentoDto[]>('/api/departamentos', { token, signal }),

  listarCargos: (token: string, signal?: AbortSignal) => request<CargoDto[]>('/api/cargos', { token, signal }),

  criarDepartamento: (token: string, dto: DepartamentoCreateDto) =>
    request<DepartamentoDto>('/api/departamentos', { method: 'POST', body: dto, token }),

  criarFuncionario: (token: string, dto: FuncionarioCreateDto) =>
    request<FuncionarioDto>('/api/funcionarios', { method: 'POST', body: dto, token }),

  atualizarFuncionario: (token: string, id: number, dto: FuncionarioUpdateDto) =>
    request<FuncionarioDto>(`/api/funcionarios/${id}`, { method: 'PUT', body: dto, token }),

  // O backend move os subordinados diretos na mesma transação e conta
  // quantos foram; o painel não faz mais PUTs um por um.
  desligarFuncionario: async (token: string, id: number, dto: DesligarFuncionarioDto = {}) => {
    const resposta = await request<DesligamentoResultadoDto | FuncionarioDto>(
      `/api/funcionarios/${id}/desligar`,
      { method: 'POST', body: dto, token }
    );
    if (ehFuncionarioDto(resposta)) {
      return { funcionario: resposta, subordinadosRealocados: 0, novoGestorNome: null } satisfies DesligamentoResultadoDto;
    }
    return resposta;
  },

  obterExtratoBancoHoras: (token: string, funcionarioId: number, signal?: AbortSignal) =>
    request<ExtratoBancoHorasDto>(`/api/funcionarios/${funcionarioId}/banco-horas`, { token, signal }),

  // Cria o login do colaborador no app ou redefine a senha do app. Se já
  // existir outra conta com o mesmo e-mail, a API responde 409.
  definirAcessoApp: (token: string, funcionarioId: number, senha: string) =>
    request<FuncionarioDto>(`/api/funcionarios/${funcionarioId}/acesso-app`, { method: 'POST', body: { senha }, token }),

  // ── Remuneração ─────────────────────────────────────────────────────────
  // Cada rota grava o histórico e devolve o funcionário já atualizado (com a
  // `versao` nova). Mandar a `versao` da tela faz a API recusar com 409 um
  // ajuste feito sobre dados velhos.

  ajustarSalario: (token: string, funcionarioId: number, dto: AjusteSalarioDto) =>
    request<FuncionarioDto>(`/api/funcionarios/${funcionarioId}/salario`, { method: 'PUT', body: dto, token }),

  ajustarValeAlimentacao: (token: string, funcionarioId: number, dto: AjusteValeAlimentacaoDto) =>
    request<FuncionarioDto>(`/api/funcionarios/${funcionarioId}/vale-alimentacao`, { method: 'PUT', body: dto, token }),

  promoverFuncionario: async (token: string, funcionarioId: number, dto: PromocaoDto) => {
    const resposta = await request<PromocaoResultadoDto | (FuncionarioDto & { subordinadosRealocados?: number })>(
      `/api/funcionarios/${funcionarioId}/promocao`,
      { method: 'POST', body: dto, token }
    );
    if (ehFuncionarioDto(resposta)) {
      return { funcionario: resposta, subordinadosRealocados: resposta.subordinadosRealocados ?? 0 } satisfies PromocaoResultadoDto;
    }
    return resposta;
  },

  /** Histórico de ajustes do colaborador, mais recentes primeiro. */
  listarAjustesRemuneracao: (token: string, funcionarioId: number, signal?: AbortSignal) =>
    request<AjusteRemuneracaoDto[]>(`/api/funcionarios/${funcionarioId}/ajustes-remuneracao`, { token, signal }),

  // ── Justificativas de ausência ──────────────────────────────────────────

  listarAusenciasRh: (token: string, status?: StatusAusencia, signal?: AbortSignal) =>
    request<AusenciaRhDto[]>(`/api/rh/ausencias${status !== undefined ? `?status=${status}` : ''}`, { token, signal }),

  // A decisão só vale se a justificativa ainda estiver Enviada/Em análise e
  // na mesma `versao`; senão a API responde 409.
  atualizarStatusAusencia: (token: string, id: number, status: StatusAusencia, versao?: number) =>
    request<AusenciaRhDto | undefined>(`/api/rh/ausencias/${id}/status`, { method: 'PUT', body: { status, versao }, token }),

  // ── Mensagens ao RH ("Falar com o RH" do app) ───────────────────────────

  /** Envia uma mensagem ao RH (conta com colaborador ligado e ativo). */
  enviarMensagemRh: (token: string, dto: MensagemRhCreateDto) =>
    request<MensagemRhDto>('/api/mensagens-rh', { method: 'POST', body: dto, token }),

  /** Mensagens da própria pessoa, das mais novas para as mais antigas. */
  listarMinhasMensagensRh: (token: string, signal?: AbortSignal) =>
    request<MensagemRhDto[]>('/api/mensagens-rh/minhas', { token, signal }),

  /** Todas as mensagens recebidas (RH ou Admin), opcionalmente por status. */
  listarMensagensRh: (token: string, status?: StatusMensagemRh, signal?: AbortSignal) =>
    request<MensagemRhDto[]>(`/api/rh/mensagens${status !== undefined ? `?status=${status}` : ''}`, { token, signal }),

  /** Responde uma mensagem; 409 se ela já foi respondida ou mudou de versão. */
  responderMensagemRh: (token: string, id: number, dto: ResponderMensagemRhDto) =>
    request<MensagemRhDto>(`/api/rh/mensagens/${id}/resposta`, { method: 'PUT', body: dto, token }),

  listarRecrutamentos: (token: string, signal?: AbortSignal) =>
    request<RecrutamentoDto[]>('/api/recrutamento', { token, signal }),
};
