import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, definirHandlerNaoAutorizado } from '../../services/api';
import type { PerfilUsuario, UsuarioDto } from '../../types/api';

const TOKEN_STORAGE_KEY = 'sistemarh.token';

// O api.ts já cancela qualquer requisição depois de 20 s. Este limite é a
// garantia da própria tela de login (e da restauração da sessão ao abrir o
// painel): aconteça o que acontecer com a requisição, o spinner para.
const TEMPO_LIMITE_SESSAO_MS = 25_000;
const MENSAGEM_SEM_RESPOSTA = 'O servidor não respondeu a tempo. Tente novamente.';
const MENSAGEM_RESPOSTA_INVALIDA = 'O servidor devolveu uma resposta inesperada. Tente novamente.';
const MENSAGEM_SAIU_EM_OUTRA_ABA = 'Você saiu da conta em outra aba.';
// Texto genérico de quando a sessão acaba sem um motivo conhecido (o mesmo
// que a API manda no 401 de token revogado).
const MENSAGEM_SESSAO_ENCERRADA = 'Sua sessão foi encerrada. Entre novamente.';

// Por que o token sumiu do storage. As outras abas leem isso no evento
// `storage` para dizer a verdade: "saiu em outra aba" só quando foi um Sair
// de propósito; numa sessão encerrada pela API, a mensagem que ela mandou.
const SAIDA_STORAGE_KEY = 'sistemarh.saida';
// O motivo só explica a remoção que veio logo junto com ele.
const VALIDADE_MOTIVO_SAIDA_MS = 15_000;

type MotivoSaida = { motivo: 'logout' } | { motivo: 'encerrada'; mensagem: string };

function gravarMotivoSaida(motivo: MotivoSaida) {
  try {
    localStorage.setItem(SAIDA_STORAGE_KEY, JSON.stringify({ ...motivo, em: Date.now() }));
  } catch {
    // Sem storage, as outras abas mostram o texto genérico.
  }
}

function mensagemDaSaidaEmOutraAba(): string {
  try {
    const dados = JSON.parse(localStorage.getItem(SAIDA_STORAGE_KEY) ?? 'null') as {
      motivo?: unknown;
      mensagem?: unknown;
      em?: unknown;
    } | null;
    if (!dados || typeof dados.em !== 'number' || Date.now() - dados.em > VALIDADE_MOTIVO_SAIDA_MS) {
      return MENSAGEM_SESSAO_ENCERRADA;
    }
    if (dados.motivo === 'logout') return MENSAGEM_SAIU_EM_OUTRA_ABA;
    if (dados.motivo === 'encerrada' && typeof dados.mensagem === 'string' && dados.mensagem.trim()) return dados.mensagem;
  } catch {
    // JSON inválido no storage: cai no texto genérico.
  }
  return MENSAGEM_SESSAO_ENCERRADA;
}

const PERFIS_VALIDOS: PerfilUsuario[] = ['Funcionario', 'Rh', 'Admin'];

// O localStorage pode lançar erro (modo privativo, armazenamento bloqueado).
// Sem ele a sessão só não sobrevive ao F5; o login continua funcionando.
function lerTokenSalvo(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function salvarToken(token: string) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Ver lerTokenSalvo.
  }
}

function apagarToken() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ver lerTokenSalvo.
  }
}

/** Um JWT tem três partes separadas por ponto. Barra "undefined", "{}" etc. */
function tokenValido(token: unknown): token is string {
  return typeof token === 'string' && /^[\w-]+\.[\w-]+\.[\w-]*$/.test(token);
}

/** Uma resposta `{}` (proxy, backend fora do formato) não pode virar o usuário "Usuário". */
function usuarioValido(usuario: unknown): usuario is UsuarioDto {
  if (!usuario || typeof usuario !== 'object') return false;
  const u = usuario as Partial<UsuarioDto>;
  return typeof u.id === 'number' && typeof u.nome === 'string' && typeof u.email === 'string';
}

function comTempoLimite<T>(promessa: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new ApiError(0, MENSAGEM_SEM_RESPOSTA)), TEMPO_LIMITE_SESSAO_MS);
    promessa.then(
      (valor) => {
        clearTimeout(temporizador);
        resolve(valor);
      },
      (erro) => {
        clearTimeout(temporizador);
        reject(erro);
      }
    );
  });
}

// O token JWT não devolve o perfil (Funcionario/Rh/Admin) no corpo do
// /api/auth/me — mas o próprio token carrega essa informação numa claim
// "perfil" (ver JwtTokenService no backend). Decodificamos o payload do JWT
// no navegador (sem validar assinatura — quem valida é sempre o backend,
// isso aqui é só pra saber o que mostrar na tela).
function lerClaims(token: string): { perfil?: unknown; sub?: unknown } {
  try {
    const payloadBase64 = token.split('.')[1];
    const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson) as unknown;
    return payload && typeof payload === 'object' ? (payload as { perfil?: unknown; sub?: unknown }) : {};
  } catch {
    return {};
  }
}

function decodificarPerfilDoToken(token: string): PerfilUsuario | null {
  const { perfil } = lerClaims(token);
  return PERFIS_VALIDOS.find((p) => p === perfil) ?? null;
}

/** Id da conta dona do token (claim "sub"), para saber se dois tokens são da mesma pessoa. */
function contaDoToken(token: string | null): string | null {
  if (!token) return null;
  const { sub } = lerClaims(token);
  return typeof sub === 'string' && sub ? sub : null;
}

function mensagemDoErro(erro: unknown): string {
  return erro instanceof ApiError ? erro.message : 'Não foi possível conectar ao servidor.';
}

interface AuthContextValue {
  token: string | null;
  usuario: UsuarioDto | null;
  perfil: PerfilUsuario | null;
  isAuthenticated: boolean;
  isRhOuAdmin: boolean;
  loading: boolean;
  erroLogin: string | null;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => void;
  /**
   * Passa a usar um token novo da MESMA conta (ex.: o devolvido pela troca de
   * senha, que derruba os antigos). A sessão continua sem voltar ao login, e
   * as outras abas recebem o token pelo evento `storage`.
   */
  atualizarToken: (novoToken: string) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<UsuarioDto | null>(null);
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [loading, setLoading] = useState(true);
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  // Token que esta aba está usando (ou tentando restaurar), lido de forma
  // síncrona pelo handler de 401 e pelo evento `storage`, que vivem fora do
  // ciclo de render.
  const tokenAtualRef = useRef<string | null>(null);
  // Cada tentativa de abrir sessão (restaurar, adotar a de outra aba, login)
  // ganha um número. Só a mais recente desliga o "carregando": uma resposta
  // atrasada de uma tentativa antiga não mexe nele, e a nova sempre mexe.
  const tentativaRef = useRef(0);

  function iniciarSessao(novoToken: string, novoUsuario: UsuarioDto) {
    tentativaRef.current++;
    tokenAtualRef.current = novoToken;
    setToken(novoToken);
    setUsuario(novoUsuario);
    setPerfil(decodificarPerfilDoToken(novoToken));
    setLoading(false);
  }

  function encerrarSessaoLocal({ apagarStorage }: { apagarStorage: boolean }) {
    tokenAtualRef.current = null;
    if (apagarStorage) apagarToken();
    setToken(null);
    setUsuario(null);
    setPerfil(null);
  }

  // Valida o token no /me e, se estiver tudo certo, passa a usá-lo. Serve
  // para restaurar a sessão ao abrir o painel e para adotar a sessão que
  // outra aba acabou de abrir.
  function adotarToken(novoToken: string) {
    const tentativa = ++tentativaRef.current;
    tokenAtualRef.current = novoToken;
    setLoading(true);
    comTempoLimite(api.me(novoToken))
      .then((usuarioRestaurado) => {
        if (tokenAtualRef.current !== novoToken) return;
        if (!usuarioValido(usuarioRestaurado)) throw new ApiError(0, MENSAGEM_RESPOSTA_INVALIDA);
        iniciarSessao(novoToken, usuarioRestaurado);
      })
      .catch((erro) => {
        // Outro token já assumiu (outra aba, novo login) ou o 401 já foi
        // tratado pelo handler abaixo.
        if (tokenAtualRef.current !== novoToken) return;
        // Servidor fora do ar não invalida o token: ele fica salvo pra
        // próxima tentativa.
        encerrarSessaoLocal({ apagarStorage: false });
        setErroLogin(mensagemDoErro(erro));
      })
      .finally(() => {
        // Antes, se outra aba trocasse o token no meio (com o /me lento), o
        // "carregando" não desligava nunca. Agora a tentativa mais recente
        // sempre desliga; se um login ou outra adoção passou na frente, quem
        // desliga é ela (o iniciarSessao já desliga).
        if (tentativa === tentativaRef.current) setLoading(false);
      });
  }

  // Troca o token desta aba sem desmontar a tela (mesma conta). O /me roda
  // em segundo plano só para atualizar os dados mostrados.
  function trocarTokenDaSessao(novoToken: string) {
    tentativaRef.current++;
    tokenAtualRef.current = novoToken;
    setToken(novoToken);
    setPerfil(decodificarPerfilDoToken(novoToken));
    setLoading(false);
    api
      .me(novoToken)
      .then((dados) => {
        if (tokenAtualRef.current === novoToken && usuarioValido(dados)) setUsuario(dados);
      })
      .catch(() => undefined);
  }

  function atualizarToken(novoToken: string) {
    if (!tokenValido(novoToken)) throw new ApiError(0, MENSAGEM_RESPOSTA_INVALIDA);
    salvarToken(novoToken);
    trocarTokenDaSessao(novoToken);
  }

  function logout() {
    const tokenAntigo = tokenAtualRef.current;
    // Apagar do localStorage avisa as outras abas (evento `storage`), que
    // também voltam para o login. O motivo vai antes, para elas saberem que
    // foi um Sair de propósito.
    gravarMotivoSaida({ motivo: 'logout' });
    encerrarSessaoLocal({ apagarStorage: true });
    setErroLogin(null);
    // Invalida no backend todos os tokens desta conta. Se a rede falhar, a
    // saída local continua valendo.
    if (tokenAntigo) api.logout(tokenAntigo).catch(() => undefined);
  }

  // Qualquer chamada autenticada que volte 401 (token expirado ou revogado
  // por logout, desligamento ou troca de perfil) encerra a sessão e leva pro
  // login com a mensagem que a API mandou ("Sua sessão foi encerrada…",
  // "Seu acesso foi desativado…"); sem ela, um texto genérico.
  useEffect(() => {
    definirHandlerNaoAutorizado((tokenUsado: string, mensagem?: string) => {
      // Uma resposta atrasada de uma sessão antiga (inclusive o próprio
      // POST /logout) não pode derrubar o login novo.
      if (tokenAtualRef.current !== tokenUsado) return;
      // Outra aba desta conta já trocou o token (ex.: trocou a senha, o que
      // derruba os antigos) e o storage ainda não avisou esta: usa o novo
      // em vez de encerrar a sessão de todas as abas.
      const salvo = lerTokenSalvo();
      const conta = contaDoToken(tokenUsado);
      if (salvo && salvo !== tokenUsado && tokenValido(salvo) && conta !== null && contaDoToken(salvo) === conta) {
        trocarTokenDaSessao(salvo);
        return;
      }
      const texto = (typeof mensagem === 'string' && mensagem.trim()) || MENSAGEM_SESSAO_ENCERRADA;
      gravarMotivoSaida({ motivo: 'encerrada', mensagem: texto });
      encerrarSessaoLocal({ apagarStorage: true });
      setErroLogin(texto);
    });
    return () => definirHandlerNaoAutorizado(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ao carregar a página, tenta restaurar a sessão a partir do token salvo.
  useEffect(() => {
    const tokenSalvo = lerTokenSalvo();
    if (!tokenSalvo) {
      setLoading(false);
      return;
    }
    if (!tokenValido(tokenSalvo)) {
      apagarToken();
      setErroLogin(MENSAGEM_SESSAO_ENCERRADA);
      setLoading(false);
      return;
    }
    adotarToken(tokenSalvo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sessão sincronizada entre abas. O evento `storage` só chega às OUTRAS
  // abas do mesmo painel:
  // - token apagado (Sair ou sessão encerrada em outra aba): esta aba também
  //   sai, com o motivo que a outra gravou;
  // - token trocado (outra aba entrou com outra conta): esta aba passa a usar
  //   a mesma sessão, em vez de continuar operando como a pessoa anterior.
  useEffect(() => {
    function aoMudarStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== TOKEN_STORAGE_KEY) return;
      const salvo = lerTokenSalvo();
      if (salvo === tokenAtualRef.current) return;

      if (!salvo || !tokenValido(salvo)) {
        if (tokenAtualRef.current === null) return;
        encerrarSessaoLocal({ apagarStorage: false });
        setErroLogin(mensagemDaSaidaEmOutraAba());
        return;
      }

      // A mesma conta com um token novo (ex.: trocou a senha em outra aba):
      // só troca o token, sem tirar a pessoa da tela em que está.
      const contaAtual = contaDoToken(tokenAtualRef.current);
      if (contaAtual !== null && contaAtual === contaDoToken(salvo)) {
        trocarTokenDaSessao(salvo);
        return;
      }

      // Outra conta: some com os dados da pessoa anterior enquanto o /me
      // confirma a nova.
      encerrarSessaoLocal({ apagarStorage: false });
      setErroLogin(null);
      adotarToken(salvo);
    }
    window.addEventListener('storage', aoMudarStorage);
    return () => window.removeEventListener('storage', aoMudarStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, senha: string) {
    setErroLogin(null);
    try {
      const resposta = await comTempoLimite(api.login(email, senha));
      // Sem token (ou sem usuário) não há sessão: nada é salvo.
      if (!resposta || !tokenValido(resposta.token) || !usuarioValido(resposta.usuario)) {
        throw new ApiError(0, MENSAGEM_RESPOSTA_INVALIDA);
      }
      salvarToken(resposta.token);
      iniciarSessao(resposta.token, resposta.usuario);
    } catch (erro) {
      setErroLogin(mensagemDoErro(erro));
      throw erro;
    }
  }

  const value: AuthContextValue = {
    token,
    usuario,
    perfil,
    isAuthenticated: token !== null && usuario !== null,
    isRhOuAdmin: perfil === 'Rh' || perfil === 'Admin',
    loading,
    erroLogin,
    login,
    logout,
    atualizarToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth precisa ser usado dentro de um <AuthProvider>.');
  }
  return context;
}
